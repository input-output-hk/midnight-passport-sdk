// Opt-in, synthetic-identity LOCALNET qualification. Never import from the service entrypoint.
import assert from 'node:assert/strict';
import { x25519 } from '@noble/curves/ed25519.js';
import { jubjub } from '@noble/curves/misc.js';
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
  readdirSync,
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
  createHostMutationJobs,
  encryptedHostJobStore,
  hostJobRoute,
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
  sealInboxCoin,
  openGrantView,
} from '../../../packages/keys/dist/index.js';
import {
  fetchCheckedV1Config,
  remoteHostMutationPorts,
  remoteHostJobPorts,
  remoteHostJobs,
  remoteV1Prover,
  remoteV1Sponsor,
  remoteDirectory,
} from '../../../packages/adapter-service/dist/index.js';
import {
  createMidnightChain,
  createHostedAccChain,
  createMidnightHoldingSource,
  createGraphqlHoldingIndexer,
  createMidnightGrantSource,
} from '../../../packages/adapter-midnight-js/dist/index.js';
import { resolveBinding } from '../../../packages/contract/dist/index.js';
import * as binding from '../../../packages/contract/generated/acc-s3r1.1/index.js';
import type { PassportPorts } from '../../../packages/account/dist/ports/index.js';
import type { MutationIntent } from '../../../packages/account/dist/index.js';
import {
  createSoftwareIdentity,
  softwareParticipant,
} from '../../../scripts/qualification/identities.mjs';

import {
  crashesAfterSubmit,
  emitCrashAndExit,
} from '../../../scripts/qualification/lifecycle-stages.mjs';
import { confirmedReplyLossProbe } from '../../../scripts/qualification/job-lifecycle-spec.mjs';
import { observeImageJobReplies } from '../../../scripts/qualification/image-job-observer.mjs';
import { isNativeJobPendingError } from '../../../scripts/qualification/native-job-evidence.mjs';
import { requireNoCurrentKey } from '../../../scripts/qualification/live-expectations.mjs';

const [mode, root, arm, operation = 'create', fault = 'none'] = process.argv.slice(2);
assert.ok(
  root && ['host', 'owner', 'resume', 'probe', 'inspect', 'populate', 'prepare'].includes(mode!),
);
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
const hostJobs = process.env.PASSPORT_LIVE_HOST_JOBS === '1';
const grantRecovery = process.env.PASSPORT_LIVE_PROFILE === 'grants';
const lifecycle = process.env.PASSPORT_LIVE_PROFILE === 'lifecycle' || grantRecovery;
const combined = lifecycle || process.env.PASSPORT_LIVE_PROFILE === 'combined';
const referenceImport = (path: string) =>
  import(pathToFileURL(join(process.env.PASSPORT_CONTRACT_DIR!, path)).href);
const proofBoundary = async (boundary: string) => {
  emit({ proverBoundary: boundary });
  const until = Date.now() + 30000;
  while (!existsSync(join(root, `prover-down-${boundary}`))) {
    assert.ok(Date.now() < until, 'Owned prover outage handshake expired.');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
const pins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  scheme: arm === 'p256' ? ('p256-webauthn' as const) : ('jubjub-schnorr' as const),
};
if (!existsSync(join(root, 'fixture.json'))) {
  assert.ok(mode === 'host' || (hostJobs && mode === 'prepare'));
  save('fixture.json', {
    seed: randomBytes(32),
    device: randomBytes(32),
    credential: randomBytes(16),
    hostKey: randomBytes(32),
    token: randomBytes(32),
    ...(hostJobs && { jobKey: randomBytes(32), jobToken: randomBytes(32) }),
    grantSecret: randomBytes(32),
    ...(grantRecovery && { readGrantSecrets: [randomBytes(32), randomBytes(32)] }),
    ...(lifecycle && {
      participants: Object.fromEntries(
        await Promise.all(
          ['owner', 'survivor', 'target'].map(async (role) => [
            role,
            await createSoftwareIdentity(),
          ]),
        ),
      ),
    }),
    ids: {
      create: hex(randomBytes(16)),
      rotate: hex(randomBytes(16)),
      'rotate-prover': hex(randomBytes(16)),
      ...Object.fromEntries(
        ['add-survivor', 'add-target', 'remove-target', 'survivor-rotate'].map((op) => [
          op,
          hex(randomBytes(16)),
        ]),
      ),
    },
  });
}
const fixture = read('fixture.json');
if (hostJobs)
  assert.ok(
    fixture.jobKey && fixture.jobToken,
    'Use a fresh job fixture; never retrofit historical state.',
  );
if (mode === 'prepare') {
  for (const [name, value] of Object.entries({
    'host-key': fixture.hostKey,
    'host-token': fixture.token,
    'job-key': fixture.jobKey,
    'job-token': fixture.jobToken,
  })) {
    writeFileSync(join(root, name), hex(value as Uint8Array) + '\n', { flag: 'wx', mode: 0o600 });
  }
  emit({ prepared: true, hostJobs: true });
  await new Promise<void>((resolve, reject) =>
    process.stdout.write('', (error) => (error ? reject(error) : resolve())),
  );
  process.exit(0);
}
const jobStore = hostJobs
  ? encryptedHostJobStore(join(root, 'job-journal'), fixture.jobKey)
  : undefined;
const jobRecords = async () => {
  if (!jobStore || !existsSync(join(root, 'job-journal'))) return [];
  const ids = [
    ...new Set(
      readdirSync(join(root, 'job-journal')).flatMap((name) => {
        const found = /^([0-9a-f]{32})\.r[0-9]+\.json$/.exec(name);
        return found && found[1] !== '0'.repeat(32) ? [found[1]!] : [];
      }),
    ),
  ];
  return Promise.all(
    ids.map(async (id) => {
      const record = await jobStore.read(id);
      assert.ok(record);
      return record;
    }),
  );
};
const jobSummaries = async () =>
  (await jobRecords()).map((r) => ({
    jobId: r.id,
    state: r.state,
    revision: r.revision,
    descriptorSha256: r.descriptorSha256,
    identity: r.descriptor.identity,
    inputSha256: hostHash(r.descriptor.input),
    milestones: r.milestones,
  }));
const closeStores = () => {
  jobStore?.close();
  store.close();
};
async function finishWorker(code: number): Promise<never> {
  closeStores();
  await new Promise<void>((resolve, reject) =>
    process.stdout.write('', (error) => (error ? reject(error) : resolve())),
  );
  process.exit(code);
}
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
  for (const id of hostJobs
    ? (await jobRecords()).map((r) => r.descriptor.identity)
    : identities()) {
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
    for (const identity of hostJobs
      ? (await jobRecords()).map((r) => r.descriptor.identity)
      : identities()) {
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
  emit({ records: await publicRecords(), ...(hostJobs && { jobs: await jobSummaries() }) });
  await finishWorker(0);
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
    prepareStep: async (record: HostMutationRecord, index: number) => {
      if (fault === 'before-deploy-proof' && record.identity.kind === 'deploy' && index === 1)
        await proofBoundary('deploy');
      return diagnose('prepareStep', () => original.prepareStep(record, index));
    },
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
      if (crashesAfterSubmit(fault, current)) {
        await emitCrashAndExit(fault);
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
  const durableJobs = jobStore
    ? createHostMutationJobs(
        jobStore,
        {
          ...engine,
          execute: async (...args: Parameters<typeof engine.execute>) => {
            if (args[0].kind === 'deploy' && !(await engine.inspect(args[0]))) budget.accept();
            return engine.execute(...args);
          },
        },
        {
          pins: {
            networkId: pins.networkId,
            bindingId: pins.bindingId,
            manifestSha256: pins.manifestSha256,
          },
          runExclusive: queue,
          completedTtlMs: 86400000,
        },
      )
    : undefined;
  const server = createServer(config, [
    async (_req, res, url) => {
      if (url.pathname !== '/healthz') return false;
      json(res, 200, { status: 'ready', hostMutations: true, hostJobs: durableJobs !== undefined });
      return true;
    },
    configRoute(config, () => backend.sponsorKeys()),
    artifacts,
    directoryRoute({
      networkId: pins.networkId,
      store: createFileDirectoryStore(directoryFile(config.registryFile)),
    }),
    jobsRoute(jobs),
    ...(durableJobs ? [hostJobRoute({ jobs: durableJobs, pins, token: fixture.jobToken })] : []),
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
  const config =
    mode === 'populate'
      ? {
          indexerUri: process.env.MN_INDEXER_URL!,
          indexerWsUri: process.env.MN_INDEXER_WS_URL!,
          nodeUri: process.env.MN_NODE_URL!,
          zkBaseUrl: `${base}/v1/zk/acc-s3r1.1`,
          coinPublicKey: '',
          encryptionPublicKey: '',
        }
      : await fetchCheckedV1Config(base, {
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
  const role =
    operation === 'survivor-rotate'
      ? 'survivor'
      : operation === 'verify-removed'
        ? 'target'
        : 'owner';
  const participant = lifecycle ? softwareParticipant(fixture.participants[role], arm) : undefined;
  const source = participant?.source ?? {
    withSession: async <T>(work: () => Promise<T>) => work(),
    deviceSecret: async () => new Uint8Array(fixture.device),
    deriveSecret: async (p: Parameters<typeof deriveSymmetricSecret>[1]) =>
      deriveSymmetricSecret(fixture.seed, p),
  };
  const authoriser =
    participant?.authoriser ??
    (arm === 'p256'
      ? {
          ...fakeAuthoriser({ credentialId: fixture.credential }),
          // Explicit software test session, never a browser/provider approval claim.
          withKeySession: async <T>(work: () => Promise<T>) => work(),
        }
      : recipeJubjubAuthoriser(source, binding.pureCircuits));
  const viewingKey = participant?.keyring ?? recipeDeviceKeyring(source);
  const recordFile = role === 'owner' ? 'record.json' : `${role}-record.json`;
  // The suite includes rotation: refuse an incomplete fixture before deploying anything.
  assert.equal(typeof authoriser.withKeySession, 'function');
  assert.equal(typeof viewingKey.decodeDevicePublicKey, 'function');
  assert.equal(typeof viewingKey.decodeP256DevicePublicKey, 'function');
  const imageReplyCircuit = fault.startsWith('image-reply:') ? fault.slice(12) : undefined;
  if (imageReplyCircuit)
    assert.ok(
      hostJobs && lifecycle && mode === 'owner' && /^[a-z][a-z0-9_]+$/.test(imageReplyCircuit),
    );
  const imageReplyProbe = imageReplyCircuit
    ? confirmedReplyLossProbe(imageReplyCircuit, emit)
    : undefined;
  const rawHost = (hostJobs ? remoteHostJobPorts : remoteHostMutationPorts)(base, {
    pins,
    token: hex(hostJobs ? fixture.jobToken : fixture.token),
    timeoutMs: 600000,
    pollIntervalMs: 500,
    ...(imageReplyProbe && { onSnapshot: imageReplyProbe.observe }),
  });
  const host = imageReplyProbe
    ? observeImageJobReplies(
        rawHost,
        remoteHostJobs(base, { pins, token: hex(fixture.jobToken), timeoutMs: 600000 }),
        imageReplyProbe,
        pins,
      )
    : rawHost;
  const sponsor = remoteV1Sponsor(base);
  const actualProver = remoteV1Prover(base);
  const prover = {
    proveTx: async (...args: Parameters<typeof actualProver.proveTx>) => {
      if (fault === 'before-owner-proof') await proofBoundary('owner');
      return actualProver.proveTx(...args);
    },
  };
  let chain = createMidnightChain({
    network,
    binding: binding as any,
    prover,
    sponsor,
    sponsorKeys: config,
    submitter: host.submitter,
  });
  let setupContext: any, setupModule: any;
  if (mode === 'populate') {
    // Directory transport only: no second wallet or prover host during setup.
    const local = loadConfig(process.env);
    const directoryServer = createServer(local, [
      directoryRoute({
        networkId: pins.networkId,
        store: createFileDirectoryStore(directoryFile(local.registryFile)),
      }),
    ]);
    await new Promise<void>((resolve, reject) => {
      directoryServer.once('error', reject);
      directoryServer.listen(local.port, local.host, resolve);
    });
    setupModule = await referenceImport('src/node/setup.ts');
    setupContext = await setupModule.setupWallet('0'.repeat(63) + '1');
    const account = read('result-create.json').account;
    const handle = await setupModule.connectAccount(setupContext, account);
    chain = createHostedAccChain({
      network,
      binding: { id: pins.bindingId, ...resolveBinding(pins.bindingId) },
      readLedger: async (address) => {
        assert.equal(address, account);
        // Decode with the handle's own physical runtime; native ChargedState is branded.
        return handle.ledgerState();
      },
      connectHandle: async (address) => {
        assert.equal(address, account);
        return { callTx: handle.callTx };
      },
    });
  }
  const grantSource = createMidnightGrantSource({
    network,
    binding,
    openings: {
      readReadPublicKey: async (_account, grantId) =>
        existsSync(join(root, 'grants.json'))
          ? read('grants.json')[grantId]?.bookkeeping.readPublicKey
          : undefined,
    },
  });
  const holdingSource = createMidnightHoldingSource(
    createGraphqlHoldingIndexer({
      networkId: network.networkId,
      url: network.indexerUrl,
      wsUrl: network.indexerWsUrl,
    }),
  );
  const ports: PassportPorts = {
    network,
    binding,
    chain,
    deployer: host.deployer,
    directory: remoteDirectory(base),
    authoriser,
    credentials: participant?.credentials ?? fakeCredentials({ authoriser }),
    viewingKey,
    encryptionKey: {
      publicKey: async () => {
        throw new Error('Sealed key flow required.');
      },
    },
    records: {
      read: async () => (existsSync(join(root, recordFile)) ? read(recordFile) : undefined),
      exists: async () => existsSync(join(root, recordFile)),
      write: async (value) => save(recordFile, value),
    },
    holdings: combined ? holdingSource : { selectHeldEntries: async () => [] },
    readGrants: combined
      ? grantSource
      : {
          readActiveReadGrantTargets: async (address) => ({
            authNonce: (await chain.readAccount(address))!.authNonce,
            targets: [],
          }),
        },
    grants: grantSource,
    grantCommitments: grantSource,
    grantDetails: grantSource,
    grantRoster: grantSource,
    grantOrigin: 'localhost',
    grantJournal: {
      stage: async (opening) => {
        const grants = existsSync(join(root, 'grants.json')) ? read('grants.json') : {};
        assert.equal(grants[opening.bookkeeping.grantId], undefined);
        grants[opening.bookkeeping.grantId] = opening;
        save('grants.json', grants);
      },
      load: async (_account, id) =>
        existsSync(join(root, 'grants.json')) ? read('grants.json')[id] : undefined,
      pending: async () =>
        Object.keys(existsSync(join(root, 'grants.json')) ? read('grants.json') : {}).filter(
          (id) =>
            !(existsSync(join(root, 'published.json')) ? read('published.json') : []).includes(id),
        ),
      markPublished: async (_account, id) =>
        save('published.json', [
          ...(existsSync(join(root, 'published.json')) ? read('published.json') : []),
          id,
        ]),
    },
    random: (length) => new Uint8Array(randomBytes(length)),
  };
  const assertPopulated = async (
    account: string,
    readerKeyring = viewingKey,
    grantPublisherKeyring = readerKeyring,
  ) => {
    if (!combined || !existsSync(join(root, 'coin.json'))) return undefined;
    const live = (await chain.readAccount(account, { includeDevices: true, includeInbox: true }))!;
    const ring = { account, encKey: live.encKey!, envelopes: live.inboxEntries! };
    const opened = await readerKeyring.openInbox(pins.networkId, ring, live.inboxEntries!);
    const held = await holdingSource.selectQualifiedHeldCoins(account, live.inboxEntries!, opened);
    assert.equal(held.length, 1);
    const expected = read('coin.json');
    assert.deepEqual(held[0]!.coin.color, expected.color);
    assert.deepEqual(held[0]!.coin.nonce, expected.nonce);
    assert.equal(held[0]!.coin.value, expected.value);
    const targets = await grantSource.readActiveReadGrantTargets(account);
    // Grant bookkeeping is encrypted to the publishing device's reader key, not
    // the shared ACC viewing secret. A different enrolled reader can still open
    // the holding; the grantee's current seal must be obtained from its publisher.
    const grantEntries =
      grantPublisherKeyring === readerKeyring
        ? opened
        : await grantPublisherKeyring.openInbox(pins.networkId, ring, live.inboxEntries!);
    const secrets: Uint8Array[] = grantRecovery ? fixture.readGrantSecrets : [fixture.grantSecret];
    assert.equal(targets.targets.length, secrets.length);
    for (const readSecret of secrets) {
      const target = targets.targets.find(
        (t) => t.readPublicKey === hex(x25519.getPublicKey(readSecret)),
      );
      assert.ok(target, 'Every independent read key must match a live target.');
      let current = false;
      for (const entry of grantEntries)
        if (
          entry?.kind === 'grant' &&
          entry.record.part === 'view' &&
          entry.record.grantId === target.grantId
        ) {
          const secret = await openGrantView(readSecret, {
            account,
            grantId: target.grantId,
            seal: unhex(entry.record.seal),
            expectedEncKey: live.encKey!,
          });
          if (secret) {
            current = true;
            secret.fill(0);
          }
        }
      assert.ok(current, 'Independent grantee must open the current viewing secret.');
    }
    return {
      heldCoins: 1,
      activeReadGrants: targets.targets.length,
      grantOpenedCurrentKey: true,
      value: expected.value.toString(),
      merkleIndex: held[0]!.coin.mt_index.toString(),
    };
  };
  if (mode === 'populate') {
    assert.ok(combined);
    assert.equal(
      existsSync(join(root, 'coin.json')),
      false,
      'Never repeat an uncertain setup deposit.',
    );
    const account = read('result-create.json').account;
    const api = await createPassportAccounts(ports).openAccountAt!(account);
    const grantIds: string[] = [];
    const readSecrets: Uint8Array[] = grantRecovery
      ? fixture.readGrantSecrets
      : [fixture.grantSecret];
    for (const [index, readSecret] of readSecrets.entries()) {
      const granted = await api.issueGrant!({
        grantee: {
          scheme: 'jubjub-schnorr',
          publicKey: hex(
            jubjub.Point.fromAffine(
              binding.pureCircuits.compute_public_point_with_jubjub(11n + 2n * BigInt(index)),
            ).toBytes(),
          ),
        },
        operations: ['withdraw-unshielded'],
        color: '34'.repeat(32),
        recipient: { kind: 'any' },
        maxCoinValue: '100',
        perCallCap: '10',
        cap: '100',
        expiresAt: null,
        read: true,
        rpId: 'localhost',
        readPublicKey: hex(x25519.getPublicKey(readSecret)),
      });
      assert.equal(granted.status, 'active');
      grantIds.push(granted.grantId);
    }
    const faucet = await setupModule.deployFaucet(setupContext.walletCtx);
    const { mintToUser } = await referenceImport('src/tests/flow.ts');
    const coin = await mintToUser(setupContext, faucet, hex(randomBytes(32)), 7n);
    // Save write-ahead setup intent before value submission. No automatic retry after uncertainty.
    save('coin.json', coin);
    const view = (await chain.readAccount(account))!;
    const deposited = await chain.call({
      address: account,
      circuit: 'deposit_shielded',
      args: [
        { nonce: coin.nonce, color: coin.color, value: coin.value },
        await sealInboxCoin(view.encKey!, coin),
      ],
    });
    save('setup-receipt.json', {
      grantId: grantIds[0],
      ...(grantRecovery && { grantIds }),
      depositTxHash: deposited.txHash,
      faucetAddress: faucet.address,
    });
    emit({ completed: 'populate', account, populated: await assertPopulated(account) });
    await finishWorker(0);
  }
  if (lifecycle && operation === 'verify-removed') {
    const account = read('result-create.json').account;
    const before = await publicRecords();
    const jobsBefore = await jobSummaries();
    assert.equal((await fetch(base + '/healthz')).ok, true);
    let mutationAttempts = 0;
    const forbidden = async (): Promise<never> => {
      mutationAttempts++;
      throw new Error('Removed identity attempted a mutation.');
    };
    const guarded: PassportPorts = {
      ...ports,
      chain: { ...chain, call: forbidden },
      directory: { ...ports.directory!, put: forbidden },
      deployer: { ...ports.deployer, deploy: forbidden },
      records: { ...ports.records!, write: forbidden },
    };
    await assert.rejects(createPassportAccounts(guarded).openAccountAt!(account), {
      code: arm === 'p256' ? 'AccountNotFound' : 'NotAuthorised',
    });
    const live = (await chain.readAccount(account, { includeInbox: true, includeDevices: true }))!;
    const owner = softwareParticipant(fixture.participants.owner, arm);
    await owner.keyring.openInbox(
      pins.networkId,
      { account, encKey: live.encKey!, envelopes: live.inboxEntries! },
      live.inboxEntries!,
    );
    const priorTargetKey = unhex(read('view-add-target.json').encKey);
    await viewingKey.openInbox(
      pins.networkId,
      { account, encKey: priorTargetKey, envelopes: live.inboxEntries! },
      live.inboxEntries!,
    );
    await requireNoCurrentKey(() =>
      viewingKey.openInbox(
        pins.networkId,
        { account, encKey: live.encKey!, envelopes: live.inboxEntries! },
        live.inboxEntries!,
      ),
    );
    assert.deepEqual(
      await publicRecords(),
      before,
      'Removed identity must not register or send a call.',
    );
    assert.equal(mutationAttempts, 0);
    assert.deepEqual(await jobSummaries(), jobsBefore);
    emit({
      completed: operation,
      removedIdentityRefused: true,
      hostRecordsUnchanged: true,
      hostReachable: true,
      originalTargetKeyStillWorks: true,
      mutationAttempts,
      hostJobsUnchanged: true,
      populated: await assertPopulated(
        account,
        owner.keyring,
        softwareParticipant(fixture.participants.survivor, arm).keyring,
      ),
      grantSealPublisher: 'survivor',
    });
    await finishWorker(0);
  }
  const coordinator = createDurablePassportMutations({
    ports,
    journal: encryptedMutationJournal(
      pins,
      source,
      fileMutationByteStore(join(root, role === 'owner' ? 'owner-journal' : `${role}-journal`)),
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
      : operation === 'add-survivor' || operation === 'add-target'
        ? {
            kind: 'add-device',
            account: read('result-create.json').account,
            reader: await softwareParticipant(
              fixture.participants[operation === 'add-survivor' ? 'survivor' : 'target'],
              arm,
            ).reader(),
          }
        : operation === 'remove-target'
          ? {
              kind: 'remove-device',
              account: read('result-create.json').account,
              commitmentHex: read('result-add-target.json').result.commitmentHex,
            }
          : { kind: 'rotate', account: read('result-create.json').account };
  if (operation !== 'create' && !existsSync(join(root, `before-${operation}.json`))) {
    const view = (await chain.readAccount(read('result-create.json').account))!;
    save(`before-${operation}.json`, { encKey: hex(view.encKey!), authNonce: view.authNonce });
  }
  try {
    let result;
    const deadline = Date.now() + (hostJobs && lifecycle ? 30 : 10) * 60000;
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
        if (
          (fault !== 'none' && (!imageReplyProbe || imageReplyProbe.lost)) ||
          !(hostJobs
            ? isNativeJobPendingError(error, await coordinator.inspect(id))
            : (error as any)?.code === 'MutationUnsettled') ||
          !available ||
          Date.now() >= deadline
        )
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
    const expectedEntries =
      !lifecycle || operation === 'create' ? 1 : operation === 'add-target' ? 3 : 2;
    assert.equal(state.entryCount, expectedEntries);
    const live = (await chain.readAccount(result.account, {
      includeDevices: true,
      includeInbox: true,
    }))!;
    assert.ok(live.encKey && live.deviceEntries?.length === expectedEntries);
    if (operation !== 'create') {
      const before = read(`before-${operation}.json`);
      assert.notEqual(
        hex(live.encKey),
        before.encKey,
        'Rotation must actually switch the ACC viewing key.',
      );
      assert.ok(state.authNonce > before.authNonce);
    }
    let readers: object | undefined;
    if (lifecycle) {
      const names =
        operation === 'create'
          ? ['owner']
          : operation === 'add-target'
            ? ['owner', 'survivor', 'target']
            : ['owner', 'survivor'];
      for (const name of names) {
        const reader = softwareParticipant(fixture.participants[name], arm);
        const entries = await reader.keyring.openInbox(
          pins.networkId,
          { account: result.account, encKey: live.encKey!, envelopes: live.inboxEntries! },
          live.inboxEntries!,
        );
        if (existsSync(join(root, 'coin.json')))
          assert.equal(
            (
              await holdingSource.selectQualifiedHeldCoins(
                result.account,
                live.inboxEntries!,
                entries,
              )
            ).length,
            1,
          );
      }
      if (operation === 'remove-target' || operation === 'survivor-rotate') {
        const target = softwareParticipant(fixture.participants.target, arm);
        await requireNoCurrentKey(() =>
          target.keyring.openInbox(
            pins.networkId,
            { account: result.account, encKey: live.encKey!, envelopes: live.inboxEntries! },
            live.inboxEntries!,
          ),
        );
        assert.ok(
          !live.deviceEntries!.some(
            (v) => hex(v) === read('result-add-target.json').result.commitmentHex,
          ),
        );
      }
      readers = {
        currentReaders: names,
        removedTargetCannotOpenCurrentKey:
          operation === 'remove-target' || operation === 'survivor-rotate',
        actor: role,
      };
    }
    save(`view-${operation}.json`, { encKey: hex(live.encKey), authNonce: state.authNonce });
    emit({
      completed: operation,
      account: result.account,
      audit: await coordinator.inspect(id),
      authNonce: state.authNonce.toString(),
      populated: await assertPopulated(result.account),
      ...(readers && { readers }),
      records: await publicRecords(),
      ...(hostJobs && { jobs: await jobSummaries() }),
    });
    await finishWorker(0);
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
    await finishWorker(2);
  }
}
