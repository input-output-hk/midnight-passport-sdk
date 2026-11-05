// Explicit opt-in; this runner never starts or stops a retained/default localnet.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
  realpathSync,
  statfsSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { workspaceIdentity, verifyQualificationBinding } from './receipt.mjs';
import { installedTreeIdentity, runtimeTreeIdentity } from '../consumer/host-retained.mjs';
import { nativeLeasePath } from './native-lease.mjs';
import { dedicatedIndexerReadiness } from './indexer-readiness.mjs';
import {
  SESSION_PORTS,
  SESSION_ENDPOINTS,
  sessionProject,
  sessionContainer,
  sessionDependencyIdentity,
} from './session-profile.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const PIN = '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
/** @param {string[]} args */
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
/** Stream large prover keys instead of allocating multi-GB buffers. @param {string} path */
async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
/** A responding listener is a conflict, not permission to reuse it. @param {number} port */
async function freePort(port) {
  await new Promise((ok, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () =>
      server.close((error) => (error ? fail(error) : ok(undefined))),
    );
  });
}
/** @param {()=>Promise<boolean>} test @param {number} ms */
async function wait(test, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return;
    await delay(1000);
  }
  throw Error('Isolated native readiness timed out; preserve this root.');
}
/** @param {NodeJS.ProcessEnv} env */
export async function runNativeSessions(env = process.env) {
  assert.ok(env.IN_NIX_SHELL, 'Run through nix develop.');
  assert.equal(env.PASSPORT_SESSION_NATIVE, '1');
  assert.equal(env.PASSPORT_RC_LOCALNET, '1');
  assert.equal(env.MN_NETWORK_ID, 'undeployed');
  for (const name of [
    'PASSPORT_SPONSOR_SEED',
    'PASSPORT_SPONSOR_SEED_FILE',
    'WALLET_SEED',
    'NODE_OPTIONS',
    'NODE_PATH',
  ])
    assert.equal(env[name], undefined, 'Do not import private sponsor or runtime overrides.');
  const output = env.PASSPORT_SESSION_ROOT ?? '';
  assert.ok(isAbsolute(output) && !existsSync(output));
  const contract = realpathSync(env.PASSPORT_CONTRACT_DIR ?? '');
  const source = await workspaceIdentity(ROOT);
  assert.equal(source.dirty, false, 'Freeze and sign the source before native proving.');
  assert.equal(
    execFileSync('git', ['log', '-1', '--format=%G?'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    'G',
  );
  const free = statfsSync(dirname(output));
  assert.ok(BigInt(free.bavail) * BigInt(free.bsize) >= 15n * 1024n ** 3n);
  assert.ok(Number(docker(['info', '--format', '{{.MemTotal}}'])) >= 24 * 1024 ** 3);
  await Promise.all(Object.values(SESSION_PORTS).map(freePort));
  const binding = await verifyQualificationBinding(ROOT);
  const manifest = join(contract, 'contracts/managed/account/compiler/contract-manifest.json');
  assert.equal(await fileHash(manifest), PIN);
  const keys = JSON.parse(
    readFileSync(join(ROOT, 'packages/contract/resources/acc-s3r1.1.key-manifest.json'), 'utf8'),
  );
  // All installed verifiers, plus the proof paths exercised by this lane.
  const used = new Set([
    'deposit_unshielded',
    'withdraw_unshielded_with_grant_jubjub',
    ...['p256', 'jubjub'].flatMap((arm) =>
      ['activate_initial_device', 'append_inbox', 'issue_grant', 'revoke_grant'].map(
        (base) => `${base}_with_${arm}`,
      ),
    ),
  ]);
  const verifiedKeys = [];
  for (const [circuit, pins] of Object.entries(/** @type {Record<string,any>} */ (keys.circuits))) {
    for (const kind of used.has(circuit) ? ['prover', 'verifier'] : ['verifier']) {
      const hash = await fileHash(
        join(contract, `contracts/managed/account/keys/${circuit}.${kind}`),
      );
      assert.equal(hash, pins[kind].sha256, `Key mismatch: ${circuit}.${kind}`);
      verifiedKeys.push({ circuit, kind, sha256: hash });
    }
  }
  const reference = {
    sources: runtimeTreeIdentity(join(contract, 'src')),
    dependencies: installedTreeIdentity(contract),
    sdkDependencies: sessionDependencyIdentity(ROOT),
    faucet: runtimeTreeIdentity(join(contract, 'contracts/managed/faucet')),
    generated: await fileHash(join(contract, 'contracts/managed/account/contract/index.js')),
    manifestSha256: await fileHash(manifest),
    packageSha256: await fileHash(join(contract, 'package.json')),
    lockSha256: await fileHash(join(contract, 'package-lock.json')),
  };
  const runId = randomBytes(8).toString('hex'),
    project = sessionProject(runId);
  mkdirSync(output, { mode: 0o700 });
  const save = (/** @type {string} */ name, /** @type {unknown} */ value) =>
    writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  const lease = nativeLeasePath();
  const fd = openSync(lease, 'wx', 0o600);
  writeFileSync(fd, JSON.stringify({ runId, pid: process.pid, project, root: output }));
  closeSync(fd);
  const specifications = /** @type {const} */ ([
    ['node', 'midnightntwrk/midnight-node:2.1.0-rc.4'],
    ['indexer', 'ghcr.io/midnightntwrk/indexer-standalone:4.4.0-rc.6-b5e6c809'],
    ['proof-server', 'midnightntwrk/proof-server:9.0.0-rc.8'],
  ]);
  /** @type {Array<{service:'node'|'indexer'|'proof-server',image:string,id:string}>} */ const owned =
    [];
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child;
  let interrupted = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let hardStop, timer;
  const interrupt = () => {
    interrupted = true;
    if (child?.pid)
      try {
        process.kill(-child.pid, 'SIGTERM');
        const pid = child.pid;
        hardStop = setTimeout(() => {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {}
        }, 10000);
        hardStop.unref();
      } catch {}
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let verdict = 'IN_PROGRESS';
  /** @type {any} */ const receipt = {
    schema: 1,
    kind: 'source-isolated-native-sessions',
    source,
    binding,
    reference,
    project,
    endpoints: SESSION_ENDPOINTS,
    verifiedKeys,
    realProviderQualified: false,
    browserNativeCombined: false,
    releaseQualified: false,
    owned,
    verdict,
  };
  save('parent-receipt.private.json', receipt);
  try {
    // Inspection must succeed before creating anything. Never pull a moving tag implicitly.
    const images = specifications.map(([service, image]) => ({
      service,
      image: JSON.parse(docker(['image', 'inspect', image]))[0].Id,
    }));
    for (const name of [project, ...['node', 'indexer'].map((s) => `${project}-${s}-data`)]) {
      const type = name === project ? 'network' : 'volume';
      try {
        docker([type, 'inspect', name]);
      } catch {
        continue;
      }
      throw Error('Fresh isolated resource already exists; retain it and choose a new run.');
    }
    docker(['network', 'create', '--label', `passport.session.project=${project}`, project]);
    for (const service of ['node', 'indexer'])
      docker([
        'volume',
        'create',
        '--label',
        `passport.session.project=${project}`,
        `${project}-${service}-data`,
      ]);
    for (const { service, image } of images) {
      assert.match(image, /^sha256:[a-f0-9]{64}$/);
      const port =
        service === 'node'
          ? `${SESSION_PORTS.node}:9944`
          : service === 'indexer'
            ? `${SESSION_PORTS.indexer}:8088`
            : `${SESSION_PORTS.prover}:6300`;
      const args = [
        'create',
        '--name',
        `${project}-${service}`,
        '--label',
        `passport.session.project=${project}`,
        '--label',
        `passport.session.service=${service}`,
        '--network',
        project,
        '--network-alias',
        service,
        '--cap-drop',
        'ALL',
        '-p',
        `127.0.0.1:${port}`,
      ];
      if (service !== 'proof-server') args.push('-v', `${project}-${service}-data:/data`);
      if (service === 'node')
        args.push(
          '--cap-add',
          'CHOWN',
          '--cap-add',
          'DAC_OVERRIDE',
          '--cap-add',
          'FOWNER',
          '-e',
          'CFG_PRESET=dev',
          '-e',
          'SIDECHAIN_BLOCK_BENEFICIARY=04bcf7ad3be7a5c790460be82a713af570f22e0f801f6659ab8e84a52be6969e',
        );
      if (service === 'indexer')
        args.push(
          '-e',
          'APP__INFRA__NODE__URL=ws://node:9944',
          '-e',
          'APP__INFRA__SPO_NODE__URL=ws://node:9944',
          '-e',
          'APP__APPLICATION__NETWORK_ID=undeployed',
          '-e',
          'APP__INFRA__SPO_NODE__BLOCKFROST_ID=dummy-not-using-spo',
          '-e',
          `APP__INFRA__SECRET=${randomBytes(32).toString('hex')}`,
        );
      args.push(image);
      const id = docker(args);
      assert.match(id, /^[a-f0-9]{64}$/);
      owned.push({ service, image, id });
      save('parent-receipt.private.json', receipt);
    }
    const verify = () => {
      for (const c of owned)
        sessionContainer(JSON.parse(docker(['inspect', c.id]))[0], project, c.service, c.image);
    };
    const node = owned.find((c) => c.service === 'node');
    assert.ok(node);
    docker(['start', node.id]);
    await wait(async () => {
      if (interrupted) throw Error('Interrupted');
      try {
        const response = await fetch(SESSION_ENDPOINTS.nodeUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getHeader', params: [] }),
          signal: AbortSignal.timeout(2000),
        });
        const value = /** @type {any} */ (await response.json());
        return (
          response.ok &&
          /^0x[0-9a-f]+$/.test(value.result?.number ?? '') &&
          BigInt(value.result.number) >= 1n
        );
      } catch {
        return false;
      }
    }, 120000);
    for (const c of owned.filter((c) => c.service !== 'node')) docker(['start', c.id]);
    await wait(async () => {
      if (interrupted) throw Error('Interrupted');
      verify();
      const ready = await dedicatedIndexerReadiness(SESSION_ENDPOINTS);
      if (ready.ready) receipt.readiness = ready;
      return ready.ready;
    }, 180000);
    verify();
    save('parent-receipt.private.json', receipt);
    const log = openSync(join(output, 'worker.private.log'), 'wx', 0o600);
    child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        join(ROOT, 'apps/passport-service/qualification/session-worker.ts'),
        output,
      ],
      {
        cwd: join(ROOT, 'apps/passport-service'),
        detached: true,
        stdio: ['ignore', log, log],
        env: {
          ...env,
          MIDNIGHT_NETWORK: 'local',
          MN_NODE_URL: SESSION_ENDPOINTS.nodeUrl,
          MN_INDEXER_URL: SESSION_ENDPOINTS.indexerUrl,
          MN_INDEXER_WS_URL: SESSION_ENDPOINTS.indexerWsUrl,
          MN_PROOF_SERVER_URL: SESSION_ENDPOINTS.proverUrl,
          PASSPORT_SESSION_PROJECT: project,
        },
      },
    );
    closeSync(log);
    timer = setTimeout(interrupt, 65 * 60000);
    const worker = child;
    const exit = await new Promise((done, fail) => {
      worker.once('error', fail);
      worker.once('close', (code, signal) => done({ code, signal }));
    });
    clearTimeout(timer);
    assert.deepEqual(
      exit,
      { code: 0, signal: null },
      'Worker failed/unknown; inspect retained private evidence, never replay.',
    );
    assert.equal(interrupted, false);
    const result = JSON.parse(readFileSync(join(output, 'session-receipt.json'), 'utf8'));
    assert.equal(result.verdict, 'PASS');
    assert.deepEqual(result.arms.map((/** @type {any} */ a) => a.arm).sort(), ['jubjub', 'p256']);
    assert.deepEqual(
      await workspaceIdentity(ROOT),
      source,
      'Source/runtime drifted during qualification.',
    );
    assert.deepEqual(installedTreeIdentity(contract), reference.dependencies);
    assert.deepEqual(sessionDependencyIdentity(ROOT), reference.sdkDependencies);
    assert.deepEqual(
      runtimeTreeIdentity(join(contract, 'contracts/managed/faucet')),
      reference.faucet,
    );
    assert.deepEqual(runtimeTreeIdentity(join(contract, 'src')), reference.sources);
    for (const pin of verifiedKeys)
      assert.equal(
        await fileHash(join(contract, `contracts/managed/account/keys/${pin.circuit}.${pin.kind}`)),
        pin.sha256,
      );
    assert.equal(
      await fileHash(join(contract, 'contracts/managed/account/contract/index.js')),
      reference.generated,
    );
    assert.equal(await fileHash(manifest), reference.manifestSha256);
    assert.equal(await fileHash(join(contract, 'package.json')), reference.packageSha256);
    assert.equal(await fileHash(join(contract, 'package-lock.json')), reference.lockSha256);
    receipt.resultSha256 = await fileHash(join(output, 'session-receipt.json'));
    verdict = 'PASS';
  } catch (error) {
    verdict = 'FAIL';
    receipt.errorSha256 = createHash('sha256').update(String(error)).digest('hex');
    throw error;
  } finally {
    clearTimeout(timer);
    clearTimeout(hardStop);
    receipt.verdict = verdict;
    receipt.cleanup = { stopped: [], retainedVolumes: true, unrelatedResourcesChanged: false };
    for (const c of [...owned].reverse()) {
      try {
        const current = JSON.parse(docker(['inspect', c.id]))[0];
        sessionContainer(current, project, c.service, c.image, current.State.Running);
        if (current.State.Running) docker(['stop', '--time', '20', c.id]);
        assert.equal(JSON.parse(docker(['inspect', c.id]))[0].State.Running, false);
        receipt.cleanup.stopped.push(c.id);
      } catch {
        receipt.cleanup.incomplete = true;
      }
    }
    const lock = JSON.parse(readFileSync(lease, 'utf8'));
    assert.equal(lock.runId, runId);
    if (!receipt.cleanup.incomplete) {
      unlinkSync(lease);
      receipt.cleanup.leaseReleased = true;
    }
    save('parent-receipt.private.json', receipt);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runNativeSessions();
}
