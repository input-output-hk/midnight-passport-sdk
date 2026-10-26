// Opt-in, synthetic-identity LOCALNET qualification. Never import from the service entrypoint.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, isAbsolute } from 'node:path';
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  existsSync,
} from 'node:fs';
import { loadConfig } from '../src/config.ts';
import { assertPinnedBinding } from '../src/binding-pin.ts';
import { loadReferenceBackend } from '../src/reference-backend.ts';
import { configRoute, pinnedZkRoute } from '../src/routes/zk.ts';
import { directoryFile } from '../src/deployments.ts';
import { readHostConfirmation } from '../src/host-driver.ts';
import {
  createServer,
  json,
  createFileDirectoryStore,
  directoryRoute,
  createMemoryJobStore,
  jobsRoute,
  serial,
  createDeploymentBudget,
  v1ChainRoute,
  createHostMutationExecutor,
  encryptedHostMutationStore,
  hostMutationRoute,
  hostHash,
  fileMutationByteStore,
  type HostMutationRecord,
  type HostMutationIdentity,
} from '../../../packages/service/dist/index.js';
import {
  createPassportAccounts,
  createDurablePassportMutations,
  encodeMutationValue,
  decodeMutationValue,
} from '../../../packages/account/dist/index.js';
import { fakeAuthoriser, fakeCredentials } from '../../../packages/account/dist/testing/index.js';
import {
  encryptedMutationJournal,
  deriveSymmetricSecret,
  recipeDeviceKeyring,
  recipeJubjubAuthoriser,
} from '../../../packages/keys/dist/index.js';
import {
  fetchCheckedV1Config,
  remoteHostMutationPorts,
  remoteV1Prover,
  remoteV1Sponsor,
  remoteDirectory,
} from '../../../packages/adapter-service/dist/index.js';
import { createMidnightChain } from '../../../packages/adapter-midnight-js/dist/index.js';
import * as binding from '../../../packages/contract/generated/acc-s3r1.1/index.js';
import type { PassportPorts } from '../../../packages/account/dist/ports/index.js';
import type { MutationIntent } from '../../../packages/account/dist/index.js';

const [mode, root, arm, operation = 'create', fault = 'none'] = process.argv.slice(2);
assert.ok(root && ['host', 'owner', 'resume', 'probe', 'inspect'].includes(mode!));
assert.ok(arm === 'p256' || arm === 'jubjub');
assert.ok(isAbsolute(root));
assert.equal(process.env.MN_INDEXER_WS_URL, 'ws://127.0.0.1:18098/api/v4/graphql/ws');
assert.equal(process.env.PASSPORT_SERVICE_PORT, '18797');
assert.equal(process.env.PASSPORT_REGISTRY_FILE, join(root, 'registry.json'));
assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
assert.equal(process.env.MN_NODE_URL, 'http://127.0.0.1:19954');
assert.equal(process.env.MN_INDEXER_URL, 'http://127.0.0.1:18098/api/v4/graphql');
assert.equal(process.env.MN_PROOF_SERVER_URL, 'http://127.0.0.1:16310');
assert.equal(process.env.PASSPORT_SPONSOR_SEED, undefined);
assert.equal(process.env.PASSPORT_SPONSOR_SEED_FILE, undefined);
mkdirSync(root, { recursive: true, mode: 0o700 });
process.chdir(root); // Reference LevelDB and diagnostic-only wallet state stay in owned scratch.
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const unhex = (s: string) => new Uint8Array(Buffer.from(s, 'hex'));
const hash = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');
const read = (name: string) =>
  decodeMutationValue(JSON.parse(readFileSync(join(root, name), 'utf8'))) as any;
const save = (name: string, value: unknown) => {
  const path = join(root, name),
    tmp = path + '.pending';
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeFileSync(fd, JSON.stringify(encodeMutationValue(value)) + '\n');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  const dir = openSync(root, 'r');
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
};
const emit = (value: object) => console.log('PASSPORT_LIVE ' + JSON.stringify(value));
const pins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  scheme: arm === 'p256' ? ('p256-webauthn' as const) : ('jubjub-schnorr' as const),
};
if (!existsSync(join(root, 'fixture.json'))) {
  assert.equal(mode, 'host');
  save('fixture.json', {
    seed: randomBytes(32),
    device: randomBytes(32),
    credential: randomBytes(16),
    hostKey: randomBytes(32),
    token: randomBytes(32),
    ids: { create: hex(randomBytes(16)), rotate: hex(randomBytes(16)) },
  });
}
const fixture = read('fixture.json');
const identities = () =>
  existsSync(join(root, 'identities.json'))
    ? (read('identities.json') as HostMutationIdentity[])
    : [];
const store = encryptedHostMutationStore(join(root, 'host-journal'), fixture.hostKey);
const event = (e: object) => {
  const events = existsSync(join(root, 'events.json')) ? read('events.json') : [];
  events.push(e);
  save('events.json', events);
  emit(e);
};
const publicRecords = async () => {
  const records = [];
  for (const id of identities()) {
    const r = await store.read(id);
    assert.ok(r);
    records.push({
      identity: id,
      phase: r.phase,
      address: r.plan?.address,
      planHash: r.plan && hostHash(r.plan),
      retireAuthority: (r.plan?.context as any)?.retireAuthority,
      steps: r.steps.map((s) => ({
        phase: s.phase,
        bytesSha256: hash(unhex(s.tx)),
        identifiers: s.identifiers,
        submissionId: s.submissionId,
        confirmation: s.confirmation,
      })),
    });
  }
  return records;
};

if (mode === 'probe' || mode === 'inspect') {
  if (mode === 'probe') {
    const require = createRequire(join(process.env.PASSPORT_CONTRACT_DIR!, 'package.json'));
    const ledger = await import(pathToFileURL(require.resolve('@midnightntwrk/ledger-v9')).href);
    const { versionOfRecord } = await import(
      pathToFileURL(require.resolve('@midnight-ntwrk/midnight-js-protocol')).href
    );
    const before = await publicRecords();
    let checked = 0;
    for (const identity of identities()) {
      const r = (await store.read(identity))!;
      for (const step of r.steps.filter(
        (s) => s.phase === 'dispatching' || s.phase === 'submitted',
      )) {
        assert.equal(
          await readHostConfirmation(step, {
            ledger,
            versionOfRecord,
            indexerUrl: process.env.MN_INDEXER_URL!,
          }),
          undefined,
        );
        checked++;
      }
    }
    assert.ok(checked > 0);
    assert.deepEqual(await publicRecords(), before);
    emit({ probe: 'unknown-during-real-indexer-outage', checked });
  }
  emit({ records: await publicRecords() });
  store.close();
  process.exit(0);
}

if (mode === 'host') {
  const config = loadConfig(process.env);
  assertPinnedBinding(config);
  const artifacts = pinnedZkRoute(config);
  const backend = await loadReferenceBackend(config);
  assert.ok(backend.hostMutations);
  const original = backend.hostMutations;
  let current: HostMutationRecord;
  const traced = {
    read: store.read,
    compareAndSwap: async (expected: number | undefined, record: HostMutationRecord) => {
      let ok;
      try {
        ok = await store.compareAndSwap(expected, record);
      } catch (error) {
        console.error('store', error instanceof Error ? error.stack : 'refused');
        throw error;
      }
      if (ok) {
        current = record;
        const ids = identities();
        if (!ids.some((i) => i.requestId === record.identity.requestId)) {
          ids.push(record.identity);
          save('identities.json', ids);
        }
      }
      return ok;
    },
  };
  const diagnose = async <T>(label: string, work: () => Promise<T>) => {
    try {
      const result = await work();
      emit({
        diagnosticStage: label,
        completed: true,
        ...(typeof result === 'boolean' && { accepted: result }),
      });
      if (label === 'prepareStep') {
        const prepared = result as any;
        emit({
          preparedShape: {
            txType: typeof prepared.tx,
            txLength: prepared.tx?.length,
            ids: prepared.identifiers?.map((x: unknown) => ({
              type: typeof x,
              length: String(x).length,
              hex: /^[a-f0-9]+$/.test(String(x)),
            })),
          },
        });
      }
      return result;
    } catch (error) {
      // Protected diagnostic log only. HTTP errors and exported receipts stay redacted.
      console.error(label, error instanceof Error ? error.stack : 'driver refused');
      throw error;
    }
  };
  const driver = {
    ...original,
    prepare: (identity: HostMutationIdentity, input: Parameters<typeof original.prepare>[1]) =>
      diagnose('prepare', () => original.prepare(identity, input)),
    prepareStep: (record: HostMutationRecord, index: number) =>
      diagnose('prepareStep', () => original.prepareStep(record, index)),
    check: (record: HostMutationRecord, count: number) =>
      diagnose('check', () => original.check(record, count)),
    submit: async (tx: Parameters<typeof original.submit>[0]) => {
      const boundary = `${current.identity.kind}:${current.steps.length - 1}`;
      event({
        stage: 'send-enter',
        requestId: current.identity.requestId,
        boundary,
        ids: tx.identifiers,
        bytesSha256: hash(unhex(tx.tx)),
      });
      const id = await original.submit(tx);
      event({ stage: 'send-return', requestId: current.identity.requestId, boundary, id });
      if (fault === `${boundary}:after-submit`) {
        emit({ crash: fault });
        process.exit(86);
      }
      return id;
    },
  };
  const rawEngine = createHostMutationExecutor(traced, driver);
  const engine = {
    ...rawEngine,
    execute: (...args: Parameters<typeof rawEngine.execute>) =>
      diagnose('execute', () => rawEngine.execute(...args)),
    resume: (...args: Parameters<typeof rawEngine.resume>) =>
      diagnose('resume', () => rawEngine.resume(...args)),
  };
  const queue = serial(8),
    budget = createDeploymentBudget(3),
    jobs = createMemoryJobStore();
  const server = createServer(config, [
    async (_req, res, url) => {
      if (url.pathname !== '/healthz') return false;
      json(res, 200, { status: 'ready', hostMutations: true });
      return true;
    },
    configRoute(config, () => backend.sponsorKeys()),
    artifacts,
    directoryRoute({
      networkId: pins.networkId,
      store: createFileDirectoryStore(directoryFile(config.registryFile)),
    }),
    jobsRoute(jobs),
    hostMutationRoute({
      executor: engine,
      pins,
      token: fixture.token,
      runExclusive: queue,
      acceptDeployment: () => budget.accept(),
    }),
    v1ChainRoute(backend, { jobs, deploymentBudget: budget, runExclusive: queue }),
  ]);
  server.listen(config.port, config.host, () => emit({ ready: true, pid: process.pid }));
} else {
  const base = `http://127.0.0.1:${process.env.PASSPORT_SERVICE_PORT}`;
  const config = await fetchCheckedV1Config(base, {
    ...pins,
    artefactUrl: `${base}/v1/zk/acc-s3r1.1`,
  });
  const network = {
    ...pins,
    indexerUrl: config.indexerUri,
    indexerWsUrl: config.indexerWsUri,
    nodeUrl: config.nodeUri,
    artefactUrl: config.zkBaseUrl,
  };
  const source = {
    withSession: async <T>(work: () => Promise<T>) => work(),
    deviceSecret: async () => new Uint8Array(fixture.device),
    deriveSecret: async (p: Parameters<typeof deriveSymmetricSecret>[1]) =>
      deriveSymmetricSecret(fixture.seed, p),
  };
  const authoriser =
    arm === 'p256'
      ? {
          ...fakeAuthoriser({ credentialId: fixture.credential }),
          // Explicit software test session, never a browser/provider approval claim.
          withKeySession: async <T>(work: () => Promise<T>) => work(),
        }
      : recipeJubjubAuthoriser(source, binding.pureCircuits);
  const viewingKey = recipeDeviceKeyring(source);
  // The suite includes rotation: refuse an incomplete fixture before deploying anything.
  assert.equal(typeof authoriser.withKeySession, 'function');
  assert.equal(typeof viewingKey.decodeDevicePublicKey, 'function');
  assert.equal(typeof viewingKey.decodeP256DevicePublicKey, 'function');
  const host = remoteHostMutationPorts(base, {
    pins,
    token: hex(fixture.token),
    timeoutMs: 600000,
    pollIntervalMs: 500,
  });
  const sponsor = remoteV1Sponsor(base);
  const chain = createMidnightChain({
    network,
    binding: binding as any,
    prover: remoteV1Prover(base),
    sponsor,
    sponsorKeys: config,
    submitter: host.submitter,
  });
  const ports: PassportPorts = {
    network,
    binding,
    chain,
    deployer: host.deployer,
    directory: remoteDirectory(base),
    authoriser,
    credentials: fakeCredentials({ authoriser }),
    viewingKey,
    encryptionKey: {
      publicKey: async () => {
        throw new Error('Sealed key flow required.');
      },
    },
    records: {
      read: async () => (existsSync(join(root, 'record.json')) ? read('record.json') : undefined),
      exists: async () => existsSync(join(root, 'record.json')),
      write: async (value) => save('record.json', value),
    },
    holdings: { selectHeldEntries: async () => [] },
    readGrants: {
      readActiveReadGrantTargets: async (address) => ({
        authNonce: (await chain.readAccount(address))!.authNonce,
        targets: [],
      }),
    },
    random: (length) => new Uint8Array(randomBytes(length)),
  };
  const coordinator = createDurablePassportMutations({
    ports,
    journal: encryptedMutationJournal(
      pins,
      source,
      fileMutationByteStore(join(root, 'owner-journal')),
    ),
    outcomes: host.outcomes,
    consent: {
      approve: async (v) =>
        event({ stage: 'consent', id: v.id, kind: v.intent.kind, resuming: v.resuming }),
    },
  });
  const id = fixture.ids[operation];
  assert.ok(id);
  const intent: MutationIntent =
    operation === 'create'
      ? { kind: 'create', userName: 'live-durability-software-identity', retireAuthority: true }
      : { kind: 'rotate', account: read('result-create.json').account };
  try {
    let result;
    const deadline = Date.now() + 10 * 60000;
    let continuing = mode === 'resume';
    while (!result) {
      try {
        result = continuing
          ? await coordinator.resume({ id })
          : await coordinator.run(intent, { id });
      } catch (error) {
        const available = await fetch(base + '/healthz', {
          signal: AbortSignal.timeout(2000),
        }).then(
          (r) => r.ok,
          () => false,
        );
        if ((error as any)?.code !== 'MutationUnsettled' || !available || Date.now() >= deadline)
          throw error;
        // Test host re-approves the same original synthetic intent. Never create a new ID.
        continuing = true;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    save(`result-${operation}.json`, result);
    const opened = await createPassportAccounts(ports).openAccountAt!(result.account);
    const state = await opened.state();
    assert.equal(state.booted, true);
    assert.equal(state.entryCount, 1);
    const live = (await chain.readAccount(result.account, {
      includeDevices: true,
      includeInbox: true,
    }))!;
    assert.ok(live.encKey && live.deviceEntries?.length === 1);
    if (operation === 'rotate') {
      const before = read('view-create.json');
      assert.notEqual(
        hex(live.encKey),
        before.encKey,
        'Rotation must actually switch the ACC viewing key.',
      );
      assert.ok(state.authNonce > before.authNonce);
    }
    save(`view-${operation}.json`, { encKey: hex(live.encKey), authNonce: state.authNonce });
    emit({
      completed: operation,
      account: result.account,
      audit: await coordinator.inspect(id),
      authNonce: state.authNonce.toString(),
      records: await publicRecords(),
    });
    store.close();
    process.exit(0);
  } catch (error) {
    console.error(
      'protected owner diagnostic',
      error instanceof Error ? error.stack : 'owner refused',
    );
    emit({
      failed: operation,
      code: (error as any)?.code ?? 'Error',
      messageSha256: hash(String(error)),
      audit: await coordinator.inspect(id),
    });
    store.close();
    process.exit(2);
  }
}
