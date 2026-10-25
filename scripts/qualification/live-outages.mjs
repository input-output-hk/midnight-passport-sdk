// Dedicated-stack proof qualification. Software credentials only; never a real provider pass.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, cp, lstat } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { workspaceIdentity, verifyQualificationBinding } from './receipt.mjs';
import { runWalletReconnect } from './wallet-reconnect.mjs';
import { lifecycleStages } from './lifecycle-stages.mjs';
import { liveProfileOptions, requireExpectedFailure } from './live-expectations.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const PROJECT = 'mn-passport-qual-20261023';
const CONTAINERS = ['node', 'indexer', 'proof-server'].map((s) => `${PROJECT}-${s}-1`);
const hash = (/** @type {string | Uint8Array} */ x) => createHash('sha256').update(x).digest('hex');
/** @param {string[]} args */
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/** Explicitly refuse the default/shared demo project or any unowned indexer.
 * @param {any} c @param {string} name */
export function requireOwnedContainer(c, name) {
  const service = name.replace(`${PROJECT}-`, '').replace(/-1$/, '');
  if (
    !CONTAINERS.includes(name) ||
    c.Name !== `/${name}` ||
    c.Config?.Labels?.['com.docker.compose.project'] !== PROJECT ||
    c.Config?.Labels?.['com.docker.compose.service'] !== service ||
    !/^[a-f0-9]{64}$/.test(c.Id)
  )
    throw new Error('Refusing to control a container outside the dedicated qualification project.');
  const ports = {
    node: ['9944/tcp', '19954'],
    indexer: ['8088/tcp', '18098'],
    'proof-server': ['6300/tcp', '16310'],
  };
  const [containerPort, hostPort] = /** @type {[string,string]} */ (
    /** @type {any} */ (ports)[service]
  );
  const bindings = c.NetworkSettings?.Ports?.[containerPort];
  if (
    !Array.isArray(bindings) ||
    bindings.length !== 1 ||
    bindings[0].HostIp !== '127.0.0.1' ||
    bindings[0].HostPort !== hostPort ||
    !Array.isArray(c.Mounts) ||
    c.Mounts.some(
      (/** @type {any} */ m) => m.Type === 'volume' && !m.Name.startsWith(PROJECT + '_'),
    )
  )
    throw new Error('Refusing mismatched qualification ports or non-owned volumes.');
  return c.Id;
}

/** @param {()=>Promise<boolean>} test @param {number} timeoutMs @param {()=>boolean} [terminal] */
async function waitFor(test, timeoutMs, terminal = () => false) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (terminal()) throw new Error('Worker exited before readiness; inspect its protected log.');
    try {
      if (await test()) return;
    } catch {
      /* readiness is bounded, never evidence of no-send */
    }
    await delay(500);
  }
  throw new Error('Bounded qualification readiness expired.');
}
async function indexerReady() {
  try {
    const r = await fetch('http://127.0.0.1:18098/api/v4/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ block(offset:{height:1}) { hash height } }' }),
      signal: AbortSignal.timeout(3000),
    });
    const v = /** @type {any} */ (await r.json());
    return r.ok && !!v.data?.block?.hash;
  } catch {
    return false;
  }
}

/** Fingerprint ignored reference code/deps separately from the workspace. @param {string} contract */
export async function referenceFingerprint(contract) {
  const files = [
    'package.json',
    'package-lock.json',
    'src/node/setup.ts',
    'src/node/wallet.ts',
    'src/wallet/wave-deploy.ts',
    'src/wallet/signer.ts',
    'src/wallet/witnesses.ts',
    'src/wallet/account.ts',
    'src/wallet/inbox.ts',
    'src/tests/flow.ts',
    'src/tests/runner.ts',
    'contracts/managed/faucet/contract/index.js',
    'contracts/managed/faucet/compiler/contract-manifest.json',
    'contracts/managed/faucet/keys/mint_shielded.prover',
    'contracts/managed/faucet/keys/mint_shielded.verifier',
    'contracts/managed/faucet/zkir/mint_shielded.zkir',
    'contracts/managed/account/contract/index.js',
    'contracts/managed/account/compiler/contract-manifest.json',
  ];
  const sources = Object.fromEntries(
    await Promise.all(
      files.map(async (name) => [name, hash(await readFile(join(contract, name)))]),
    ),
  );
  const require = createRequire(join(contract, 'package.json'));
  const lock = JSON.parse(await readFile(join(contract, 'package-lock.json'), 'utf8'));
  const packages = [];
  for (const name of [
    '@midnight-ntwrk/compact-js',
    '@midnight-ntwrk/compact-runtime',
    '@midnight-ntwrk/midnight-js-contracts',
    '@midnight-ntwrk/midnight-js-protocol',
    '@midnight-ntwrk/midnight-js-indexer-public-data-provider',
    '@midnight-ntwrk/midnight-js-http-client-proof-provider',
    '@midnightntwrk/ledger-v9',
    '@midnightntwrk/wallet-sdk-facade',
    '@midnightntwrk/wallet-sdk-address-format',
  ]) {
    const info = lock.packages['node_modules/' + name];
    let entry;
    try {
      entry = require.resolve(name);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED')
        throw error;
      const packageRoot = join(contract, 'node_modules', name);
      const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
      const imported = manifest.exports?.['.']?.import;
      assert.ok(
        typeof imported === 'string' && imported.startsWith('./'),
        'Explicit ESM entry required.',
      );
      entry = join(packageRoot, imported);
    }
    packages.push({
      name,
      version: info.version,
      integrity: info.integrity,
      entrySha256: hash(await readFile(entry)),
    });
  }
  return { sources, packages };
}

/** @param {'baseline'|'combined'|'lifecycle'|'wallet'|'removed-recheck'} [requestedProfile] */
export async function runLiveOutages(requestedProfile = 'baseline') {
  assert.equal(process.env.PASSPORT_RC_LOCALNET, '1', 'Explicit localnet opt-in required.');
  assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
  const output = process.env.PASSPORT_LIVE_ROOT ?? '';
  assert.ok(
    isAbsolute(output),
    'Set a fresh absolute PASSPORT_LIVE_ROOT (protected evidence/state).',
  );
  const contract = process.env.PASSPORT_CONTRACT_DIR ?? '';
  assert.ok(isAbsolute(contract));
  assert.equal(
    hash(
      await readFile(join(contract, 'contracts/managed/account/compiler/contract-manifest.json')),
    ),
    '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  );
  const { profile, lifecycle, walletOnly, combined, removedOnly } =
    liveProfileOptions(requestedProfile);
  const rounds = Number(process.env.PASSPORT_LIVE_ROUNDS ?? '1');
  assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 3);
  const source = await workspaceIdentity(ROOT),
    binding = await verifyQualificationBinding(ROOT),
    reference = await referenceFingerprint(contract);
  /** Historical qualification receipt; local fixture shape is checked before use. @type {any} */
  let prior;
  /** @type {string|undefined} */
  let priorSha;
  const priorRoot = process.env.PASSPORT_SURVIVOR_FIXTURE_ROOT ?? '';
  if (removedOnly) {
    assert.ok(
      isAbsolute(priorRoot) &&
        !output.startsWith(priorRoot + '/') &&
        !priorRoot.startsWith(output + '/') &&
        output !== priorRoot,
    );
    assert.equal((await lstat(priorRoot)).isSymbolicLink(), false);
    const priorBytes = await readFile(join(priorRoot, 'receipt.json'));
    priorSha = hash(priorBytes);
    prior = JSON.parse(priorBytes.toString('utf8'));
    assert.equal(prior.verdict, 'PASS');
    assert.equal(prior.profile, 'lifecycle');
    assert.deepEqual(prior.binding, binding);
    assert.ok(rounds <= prior.roundsRequested);
  }
  const inspection = JSON.parse(docker(['inspect', ...CONTAINERS]));
  const ids = inspection.map((/** @type {any} */ c, /** @type {number} */ i) =>
    requireOwnedContainer(c, /** @type {string} */ (CONTAINERS[i])),
  );
  assert.ok(inspection.every((/** @type {any} */ c) => c.State.Running));
  await mkdir(output, { mode: 0o700 }); // Existing uncertain evidence is never overwritten.
  const images = inspection.map((/** @type {any} */ c) => {
    const image = JSON.parse(docker(['image', 'inspect', c.Image]))[0];
    return {
      service: c.Config.Labels['com.docker.compose.service'],
      imageId: image.Id,
      repoDigests: image.RepoDigests,
      architecture: image.Architecture,
      containerId: c.Id,
      mounts: c.Mounts.filter((/** @type {any} */ m) => m.Type === 'volume').map(
        (/** @type {any} */ m) => m.Name,
      ),
    };
  });
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    PASSPORT_RC_LOCALNET: '1',
    PASSPORT_LIVE_PROFILE: removedOnly ? 'lifecycle' : profile,
    MN_NETWORK_ID: 'undeployed',
    MIDNIGHT_NETWORK: 'local',
    MN_NODE_URL: 'http://127.0.0.1:19954',
    MN_INDEXER_URL: 'http://127.0.0.1:18098/api/v4/graphql',
    MN_INDEXER_WS_URL: 'ws://127.0.0.1:18098/api/v4/graphql/ws',
    MN_PROOF_SERVER_URL: 'http://127.0.0.1:16310',
    PASSPORT_SERVICE_HOST: '127.0.0.1',
    PASSPORT_SERVICE_PORT: '18797',
    PASSPORT_MANIFEST_SHA256: binding.compilerManifestSha256,
  };
  for (const k of ['PASSPORT_SPONSOR_SEED', 'PASSPORT_SPONSOR_SEED_FILE'])
    assert.equal(env[k], undefined);
  for (const k of Object.keys(env)) if (k.startsWith('PASSPORT_PUBLIC_')) delete env[k];
  /** @type {Set<import('node:child_process').ChildProcess>} */ const children = new Set();
  /** @type {any[]} */ const evidence = [];
  let verdict = 'IN_PROGRESS';
  const save = async () =>
    writeFile(
      join(output, 'receipt.json'),
      JSON.stringify(
        {
          schema: 1,
          scope: removedOnly
            ? 'source-live-read-only-removed-access-recheck'
            : walletOnly
              ? 'source-live-wallet-indexer-reconnect'
              : lifecycle
                ? 'source-live-enrollment-survivor-removal-and-wallet-reconnect'
                : combined
                  ? 'source-live-combined-grants-holdings-prover-outages'
                  : 'source-live-proof-process-and-indexer-outages',
          profile,
          verdict,
          source,
          binding,
          reference,
          nodeVersion: process.version,
          images,
          softwareCredentials: true,
          realProviderQualified: false,
          releaseQualified: false,
          roundsRequested: rounds,
          ...(removedOnly && {
            priorReceiptSha256: priorSha,
            noHistoricalMutationsReplayed: true,
          }),
          cases: evidence,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
  /** @param {import('node:child_process').ChildProcess} child */
  const stop = (child) => {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* exact owned group already exited */
      }
    }
  };
  let interrupted = false;
  const cleanup = () => {
    for (const child of children) stop(child);
  };
  const interrupt = () => {
    interrupted = true;
    cleanup();
    process.exitCode = 130;
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  /** @param {string} mode @param {string} root @param {string} arm @param {string} op @param {string} fault */
  const worker = (mode, root, arm, op, fault) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        resolve(
          ROOT,
          mode === 'wallet-observer'
            ? 'apps/passport-dapp/e2e/wallet-reconnect.e2e.ts'
            : mode === 'wallet-producer'
              ? 'apps/passport-service/qualification/wallet-transfer.ts'
              : 'apps/passport-service/qualification/live-worker.ts',
        ),
        mode,
        root,
        arm,
        op,
        fault,
      ],
      {
        cwd: join(
          ROOT,
          mode === 'wallet-observer' ? 'apps/passport-dapp' : 'apps/passport-service',
        ),
        detached: true,
        env: { ...env, PASSPORT_REGISTRY_FILE: join(root, 'registry.json') },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    children.add(child);
    /** @type {any[]} */ const messages = [];
    let text = '',
      log = '',
      exceeded = false;
    const collect = (/** @type {Buffer} */ chunk) => {
      if (log.length + chunk.length > 8 * 1024 * 1024) {
        exceeded = true;
        stop(child);
        return;
      }
      log += chunk.toString();
      text += chunk.toString();
      const lines = text.split('\n');
      text = lines.pop() ?? '';
      for (const line of lines)
        if (line.startsWith('PASSPORT_LIVE ')) {
          try {
            const message = JSON.parse(line.slice(14));
            messages.push(message);
            if (
              message.proverBoundary ||
              message.ready ||
              message.diagnosticStage ||
              message.crash ||
              message.failed ||
              message.completed ||
              message.walletReady ||
              message.walletDisconnected ||
              message.walletTransferPrepared ||
              message.walletSubmitted
            )
              console.log(
                'live worker:',
                JSON.stringify({
                  ready: message.ready,
                  proverBoundary: message.proverBoundary,
                  stage: message.diagnosticStage,
                  crash: message.crash,
                  failed: message.failed,
                  completed: message.completed,
                  walletReady: message.walletReady,
                  walletDisconnected: message.walletDisconnected,
                  walletTransferPrepared: message.walletTransferPrepared,
                  walletSubmitted: message.walletSubmitted,
                }),
              );
          } catch {
            /* no unparsed output exported */
          }
        }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const done = new Promise((resolveDone) =>
      child.once('close', async (code, signal) => {
        children.delete(child);
        await writeFile(join(output, `worker-${arm}-${op}-${mode}-${Date.now()}.log`), log, {
          mode: 0o600,
        });
        resolveDone({ code, signal, exceeded, messages, logHash: hash(log) });
      }),
    );
    return { child, messages, done };
  };
  /** @param {ReturnType<typeof worker>} w @param {number} ms */
  const finished = async (w, ms) => {
    const timer = setTimeout(() => stop(w.child), ms);
    try {
      return /** @type {any} */ (await w.done);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    await waitFor(indexerReady, 60000);
    await save();
    for (let round = 1; round <= rounds; round++) {
      for (const arm of walletOnly ? [] : ['jubjub', 'p256']) {
        const root = join(output, `round-${round}-${arm}`);
        if (!removedOnly) await mkdir(root, { mode: 0o700 });
        if (removedOnly) {
          // Read-only requalification in a separate private copy. Never mutate/delete
          // the accepted source fixture or replay its already-complete operations.
          // cp must create the destination: errorOnExist also rejects an empty directory.
          await cp(join(priorRoot, `round-${round}-${arm}`), root, {
            recursive: true,
            dereference: false,
            errorOnExist: true,
            force: false,
          });
          assert.equal((await lstat(join(root, 'fixture.json'))).isFile(), true);
        }
        const stages = removedOnly
          ? [['verify-removed', 'none', 'verify']]
          : lifecycle
            ? lifecycleStages(/** @type {'p256'|'jubjub'} */ (arm))
            : combined
              ? [
                  ['create', 'before-deploy-proof', 'owner'],
                  ['create', 'none', 'resume'],
                  ['populate', 'none', 'populate'],
                  ['rotate', 'call:0:after-submit', 'owner'],
                  ['rotate', 'none', 'resume'],
                  ['rotate-prover', 'before-owner-proof', 'owner'],
                  ['rotate-prover', 'assert-unknown', 'resume'],
                ]
              : [
                  ['create', 'deploy:0:after-submit', 'owner'],
                  ['create', 'call:0:after-submit', 'resume'],
                  ['create', 'none', 'resume'],
                  ['rotate', 'call:0:after-submit', 'owner'],
                  ['rotate', 'none', 'resume'],
                ];
        let beforeProverUnknown;
        for (const [operation, fault, mode] of /** @type {Array<[string,string,string]>} */ (
          stages
        )) {
          if (mode === 'verify') {
            const host = worker('host', root, arm, operation, 'none');
            await waitFor(
              async () => host.messages.some((m) => m.ready),
              180000,
              () => host.child.exitCode !== null || host.child.signalCode !== null,
            );
            const checked = await finished(worker('owner', root, arm, operation, 'none'), 30000);
            assert.equal(checked.code, 0);
            assert.ok(
              checked.messages.some(
                (/** @type {any} */ m) =>
                  m.removedIdentityRefused &&
                  m.hostRecordsUnchanged &&
                  m.hostReachable &&
                  m.originalTargetKeyStillWorks &&
                  m.mutationAttempts === 0,
              ),
            );
            stop(host.child);
            await finished(host, 10000);
            evidence.push({ round, arm, operation, verdict: 'PASS', owner: checked });
            await save();
            continue;
          }
          if (mode === 'populate') {
            const populated = await finished(
              worker(mode, root, arm, operation, 'none'),
              15 * 60000,
            );
            assert.equal(
              populated.code,
              0,
              'Live grant issue, mint and shielded deposit must settle.',
            );
            assert.ok(
              populated.messages.some(
                (/** @type {any} */ m) =>
                  m.populated?.heldCoins === 1 && m.populated?.grantOpenedCurrentKey === true,
              ),
            );
            evidence.push({ round, arm, operation, verdict: 'PASS', owner: populated });
            await save();
            continue;
          }
          assert.equal(interrupted, false, 'Qualification interrupted.');
          console.log(`live qualification: round ${round} ${arm} ${operation} ${fault}`);
          const started = Date.now(),
            host = worker('host', root, arm, operation, fault);
          await waitFor(
            async () => {
              return host.messages.some((m) => m.ready);
            },
            180000,
            () => host.child.exitCode !== null || host.child.signalCode !== null,
          );
          const proofOutage = fault.startsWith('before-');
          const owner = worker(
            mode,
            root,
            arm,
            operation,
            proofOutage || fault === 'assert-unknown' ? fault : 'none',
          );
          if (proofOutage) {
            const target = fault === 'before-deploy-proof' ? host : owner;
            await waitFor(
              async () => target.messages.some((m) => m.proverBoundary),
              180000,
              () => target.child.exitCode !== null || target.child.signalCode !== null,
            );
            docker(['stop', '--time', '1', /** @type {string} */ (ids[2])]);
            assert.equal(
              JSON.parse(docker(['inspect', /** @type {string} */ (ids[2])]))[0].State.Running,
              false,
            );
            await writeFile(
              join(root, `prover-down-${fault === 'before-deploy-proof' ? 'deploy' : 'owner'}`),
              'owned prover stopped\n',
              { flag: 'wx', mode: 0o600 },
            );
          }
          const result = await finished(owner, 12 * 60000);
          const c = {
            round,
            arm,
            operation,
            fault,
            durationMs: Date.now() - started,
            owner: result,
            verdict: 'IN_PROGRESS',
          };
          evidence.push(c);
          await save();
          if (proofOutage || fault === 'assert-unknown') {
            requireExpectedFailure(result, operation, fault);
            assert.equal(result.code, 2, 'Outage/unknown outcome must retain the mutation.');
            assert.ok(
              result.messages.some((/** @type {any} */ m) => m.audit?.unresolvedEffects === 1),
            );
            stop(host.child);
            await finished(host, 10000);
            const inspect = await finished(worker('inspect', root, arm, operation, 'none'), 15000);
            assert.equal(inspect.code, 0);
            const records = inspect.messages.find((/** @type {any} */ m) => m.records).records;
            if (fault === 'before-deploy-proof') {
              assert.equal(records.length, 1);
              assert.equal(records[0].phase, 'active');
              assert.equal(records[0].steps.length, 1);
              assert.equal(records[0].steps[0].phase, 'confirmed');
              assert.ok(records[0].planHash);
            }
            if (fault === 'before-owner-proof') beforeProverUnknown = records;
            if (fault === 'assert-unknown')
              assert.deepEqual(
                records,
                beforeProverUnknown,
                'Unregistered owner outcome must not prepare or send a replacement.',
              );
            c.owner.proverRecords = records;
            if (proofOutage) {
              docker(['start', /** @type {string} */ (ids[2])]);
              await waitFor(
                async () =>
                  fetch('http://127.0.0.1:16310/health', {
                    signal: AbortSignal.timeout(2000),
                  }).then(
                    () => true,
                    () => false,
                  ),
                60000,
              );
            }
          } else if (fault !== 'none') {
            const died = await finished(host, 10000);
            assert.equal(died.code, 86, 'Expected exact host crash boundary.');
            requireExpectedFailure(result, operation, fault);
            assert.equal(result.code, 2, 'Owner must retain an unresolved mutation.');
            assert.ok(
              result.messages.some((/** @type {any} */ m) => m.audit?.unresolvedEffects === 1),
            );
            // Control only the exact inspected owned indexer. Same container and volume survive.
            docker(['stop', '--time', '1', /** @type {string} */ (ids[1])]);
            await waitFor(async () => !(await indexerReady()), 10000);
            const probe = await finished(worker('probe', root, arm, operation, 'none'), 15000);
            assert.equal(
              probe.code,
              0,
              'Outage lookup must remain unknown without a journal change.',
            );
            c.owner.probe = probe;
            docker(['start', /** @type {string} */ (ids[1])]);
            await waitFor(indexerReady, 60000);
          } else {
            assert.equal(result.code, 0, 'Original mutation must complete.');
            if (lifecycle) {
              const completed = result.messages.find(
                (/** @type {any} */ m) => m.completed === operation,
              );
              assert.ok(completed?.readers, 'Require the actual reader checks, not only exit 0.');
              assert.equal(
                completed.readers.actor,
                operation === 'survivor-rotate' ? 'survivor' : 'owner',
              );
              assert.deepEqual(
                completed.readers.currentReaders,
                operation === 'create'
                  ? ['owner']
                  : operation === 'add-target'
                    ? ['owner', 'survivor', 'target']
                    : ['owner', 'survivor'],
              );
              assert.equal(
                completed.readers.removedTargetCannotOpenCurrentKey,
                operation === 'remove-target' || operation === 'survivor-rotate',
              );
            }
            if (combined && (operation === 'rotate' || (lifecycle && operation !== 'create')))
              assert.ok(
                result.messages.some(
                  (/** @type {any} */ m) =>
                    m.populated?.heldCoins === 1 && m.populated?.grantOpenedCurrentKey === true,
                ),
              );
            stop(host.child);
            await finished(host, 10000);
          }
          c.verdict = 'PASS';
          await save();
        }
        const final = await finished(worker('inspect', root, arm, 'create', 'none'), 15000);
        assert.equal(final.code, 0);
        const records = final.messages.find((/** @type {any} */ m) => m.records)?.records;
        assert.ok(
          records?.length > 4 && records.every((/** @type {any} */ r) => r.phase === 'complete'),
        );
        const sends = JSON.parse(await readFile(join(root, 'events.json'), 'utf8')).filter(
          (/** @type {any} */ e) => e.stage === 'send-enter',
        );
        const idsSent = sends.map((/** @type {any} */ e) => e.ids.join(','));
        assert.equal(
          new Set(idsSent).size,
          sends.length,
          'No prepared transaction may be sent twice.',
        );
        assert.equal(
          records.filter((/** @type {any} */ r) => r.identity.kind === 'deploy').length,
          1,
        );
        assert.equal(
          records.find((/** @type {any} */ r) => r.identity.kind === 'deploy').retireAuthority,
          true,
        );
        for (const prior of evidence.filter(
          (e) =>
            e.round === round &&
            e.arm === arm &&
            (e.owner?.probe || e.fault === 'before-deploy-proof'),
        )) {
          const priorRecords =
            prior.owner.proverRecords ??
            prior.owner.probe.messages.find((/** @type {any} */ m) => m.records).records;
          for (const before of priorRecords) {
            const after = records.find(
              (/** @type {any} */ r) => r.identity.requestId === before.identity.requestId,
            );
            assert.equal(
              after.planHash,
              before.planHash,
              'Original deployment/owner plan must survive restart.',
            );
            for (const [i, step] of before.steps.entries())
              assert.equal(
                after.steps[i].bytesSha256,
                step.bytesSha256,
                'Prepared bytes must not be replaced.',
              );
          }
        }
        if (removedOnly) {
          /** @type {{finalRecords:unknown,sends:number}|undefined} */
          const previous = prior.cases.find(
            (/** @type {any} */ c) => c.round === round && c.arm === arm && c.finalRecords,
          );
          assert.ok(previous);
          assert.deepEqual(records, previous.finalRecords, 'No historical host record may change.');
          assert.equal(sends.length, previous.sends, 'No historical intent may be sent again.');
        }
        evidence.push({
          round,
          arm,
          verdict: 'PASS',
          finalRecords: records,
          ...(removedOnly
            ? { historicalSends: sends.length, currentSends: 0, verifiedReadOnly: true }
            : { sends: sends.length }),
          ...(lifecycle &&
            !removedOnly && { enrolledSurvivorAuthorized: true, targetRemoved: true }),
          ...(combined &&
            !lifecycle && {
              ownerPreRegistrationProverFailure: 'safely-unresolved-no-resend',
              populatedHoldingsAndGrant: true,
            }),
        });
        await save();
      }
      if ((lifecycle && !removedOnly) || walletOnly) {
        const wallet = await runWalletReconnect({
          root: join(output, `round-${round}-wallet`),
          worker,
          finished,
          waitFor,
          docker,
          indexerId: /** @type {string} */ (ids[1]),
          indexerReady,
        });
        evidence.push({ round, ...wallet });
        await save();
      }
    }
    if (removedOnly)
      assert.equal(
        hash(await readFile(join(priorRoot, 'receipt.json'))),
        priorSha,
        'Prior receipt changed during recheck.',
      );
    assert.deepEqual(await workspaceIdentity(ROOT), source, 'Source changed during qualification.');
    assert.deepEqual(
      await referenceFingerprint(contract),
      reference,
      'Reference runtime changed during qualification.',
    );
    verdict = 'PASS';
    console.log(`Live ${profile} qualification: PASS (software identities; scoped suite).`);
  } catch (error) {
    verdict = 'FAIL';
    throw error;
  } finally {
    cleanup();
    // Restore an indexer interrupted by a failed probe, retaining all volumes and evidence.
    if (!JSON.parse(docker(['inspect', /** @type {string} */ (ids[1])]))[0].State.Running)
      docker(['start', /** @type {string} */ (ids[1])]);
    if (!JSON.parse(docker(['inspect', /** @type {string} */ (ids[2])]))[0].State.Running)
      docker(['start', /** @type {string} */ (ids[2])]);
    await save();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) await runLiveOutages();
