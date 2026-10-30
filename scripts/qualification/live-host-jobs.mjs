// Native proof + service restart runner. Only the dedicated retained project is controllable.
import { dedicatedIndexerReadiness } from './indexer-readiness.mjs';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { join, resolve, isAbsolute, basename, dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { workspaceIdentity, verifyQualificationBinding } from './receipt.mjs';
import { requireOwnedContainer, referenceFingerprint } from './live-outages.mjs';
import { requireExpectedHostCrash, requireExpectedFailure } from './live-expectations.mjs';
import {
  nativeJobHash,
  nativeJobSnapshot,
  assertNativeJobContinuation,
  requireNativeJobFailure,
} from './native-job-evidence.mjs';
import {
  imageStateNames,
  IMAGE_JOURNAL_MANIFEST,
  mirrorImageJournals,
  nativeWorkerStopped,
} from './image-journal-mirror.mjs';
import { nativeJobProfile } from './job-lifecycle-spec.mjs';
import { runJobBackedLifecycle } from './job-lifecycle-run.mjs';

const ROOT = resolve(import.meta.dirname, '../..'),
  PROJECT = 'mn-passport-qual-20261023';
/** @param {string[]} args */
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
/** @param {()=>Promise<boolean>} check @param {number} ms @param {()=>boolean} [terminal] */
async function wait(check, ms, terminal = () => false) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (terminal()) throw new Error('Owned worker stopped before required boundary.');
    if (await check()) return;
    await delay(250);
  }
  throw new Error('Native job qualification boundary deadline expired.');
}
/** @param {string} path */
async function ready(path) {
  try {
    const r = await fetch(path, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}
async function indexerReady() {
  return (await dedicatedIndexerReadiness()).ready;
}
/** @param {'source'|'image'} [lane] @param {'creation'|'lifecycle'} [profile] */
export async function runNativeHostJobs(lane = 'source', profile = 'creation') {
  const options = nativeJobProfile(profile),
    lifecycle = profile === 'lifecycle';
  assert.ok(['source', 'image'].includes(lane));
  assert.equal(process.env.IN_NIX_SHELL !== undefined, true);
  assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
  assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
  const output = process.env.PASSPORT_LIVE_ROOT ?? '',
    contract = process.env.PASSPORT_CONTRACT_DIR ?? '';
  assert.ok(isAbsolute(output) && isAbsolute(contract));
  assert.equal((await lstat(contract)).isSymbolicLink(), false);
  const source = await workspaceIdentity(ROOT);
  assert.equal(source.dirty, false, 'Commit/sign source before native execution.');
  const binding = await verifyQualificationBinding(ROOT),
    reference = await referenceFingerprint(contract);
  assert.equal(
    nativeJobHash(
      await readFile(join(contract, 'contracts/managed/account/compiler/contract-manifest.json')),
    ),
    binding.compilerManifestSha256,
  );
  const names = ['node', 'indexer', 'proof-server'].map((s) => `${PROJECT}-${s}-1`),
    inspected = JSON.parse(docker(['inspect', ...names]));
  const ids = inspected.map((/** @type {any} */ c, /** @type {number} */ n) =>
    requireOwnedContainer(c, /** @type {string} */ (names[n])),
  );
  assert.ok(inspected.every((/** @type {any} */ c) => c.State.Running));
  const imageId = process.env.PASSPORT_NATIVE_JOB_IMAGE ?? '',
    depsVolume = process.env.PASSPORT_NATIVE_JOB_DEPS_VOLUME ?? '';
  if (lane === 'image') {
    assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
    assert.equal(depsVolume, options.depsVolume);
    const image = JSON.parse(docker(['image', 'inspect', imageId]))[0];
    assert.equal(image.Config.Labels['org.opencontainers.image.revision'], source.commit);
    assert.equal(image.Architecture, options.arch);
    assert.deepEqual(image.Config.Entrypoint, [
      '/opt/passport/apps/passport-service/image-entrypoint.sh',
    ]);
  }
  let linuxReference;
  if (lane === 'image') {
    const volume = JSON.parse(docker(['volume', 'inspect', depsVolume]))[0];
    assert.equal(volume.Labels['passport.qualification'], options.depsLabel);
    const script = `const fs=require('node:fs'),c=require('node:crypto'),p=require('node:path'),m=require('node:module');const dir='/data/contract';const lock=JSON.parse(fs.readFileSync(p.join(dir,'package-lock.json'),'utf8'));const req=m.createRequire(p.join(dir,'package.json'));const names=${JSON.stringify(reference.packages.map((p) => p.name))};const hash=(b)=>c.createHash('sha256').update(b).digest('hex');const packages=names.map(name=>{let entry;try{entry=req.resolve(name);}catch(error){if(error.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')throw error;const root=p.join(dir,'node_modules',name),manifest=JSON.parse(fs.readFileSync(p.join(root,'package.json'),'utf8'));entry=p.join(root,manifest.exports['.'].import);}const info=lock.packages['node_modules/'+name];return {name,version:info.version,integrity:info.integrity,entrySha256:hash(fs.readFileSync(entry))};});console.log(JSON.stringify({platform:process.platform,arch:process.arch,node:process.version,lockSha256:hash(fs.readFileSync(p.join(dir,'package-lock.json'))),packages}));`;
    linuxReference = JSON.parse(
      docker([
        'run',
        '--rm',
        '--platform',
        options.platform,
        '--network',
        'none',
        '--user',
        `${process.getuid?.()}:${process.getgid?.()}`,
        '--mount',
        `type=bind,src=${contract},dst=/data/contract,readonly`,
        '--mount',
        `type=volume,src=${depsVolume},dst=/data/contract/node_modules,readonly,volume-nocopy`,
        '--entrypoint',
        'node',
        imageId,
        '-e',
        script,
      ]),
    );
    assert.equal(linuxReference.platform, 'linux');
    assert.equal(linuxReference.arch, options.arch === 'amd64' ? 'x64' : options.arch);
    assert.equal(linuxReference.lockSha256, reference.sources['package-lock.json']);
    assert.deepEqual(linuxReference.packages, reference.packages);
  }
  await mkdir(output, { mode: 0o700 });
  /** @type {NodeJS.ProcessEnv} */ const env = {
    ...process.env,
    PASSPORT_LIVE_HOST_JOBS: '1',
    PASSPORT_LIVE_PROFILE: lifecycle ? 'lifecycle' : 'baseline',
    PASSPORT_RC_LOCALNET: '1',
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
  for (const k of Object.keys(env))
    if (
      k.startsWith('PASSPORT_PUBLIC_') ||
      k.startsWith('PASSPORT_HOST_MUTATION_') ||
      k.startsWith('PASSPORT_HOST_JOB_')
    )
      delete env[k];
  delete env.PASSPORT_WALLET_OWNER_FIXTURE;
  /** @type {Set<import('node:child_process').ChildProcess>} */ const children = new Set();
  /** @type {Array<Record<string,any>>} */ const cases = [];
  /** @type {string[]} */ const ownedContainers = [];
  /** @type {Array<Record<string,any>>} */ const imageStates = [];
  let verdict = 'IN_PROGRESS';
  /** @type {string|undefined} */ let failureSha256;
  const receipt = {
    schema: 1,
    profile,
    scope: lifecycle
      ? `job-backed-populated-lifecycle-${lane}`
      : lane === 'source'
        ? 'source-native-host-job-proof-process-outages'
        : 'local-production-image-native-host-job-restarts',
    lane,
    source,
    binding,
    reference,
    softwareCredentials: true,
    realProviderQualified: false,
    releaseQualified: false,
    attemptsInstrumented: lane === 'source',
    ...(lane === 'image'
      ? {
          imageId,
          platform: options.platform,
          dockerHostPlatform: 'linux/arm64',
          depsVolume,
          linuxReference,
          imageStates,
        }
      : {}),
    localnet: inspected.map((/** @type {any} */ c) => ({
      id: c.Id,
      imageId: c.Image,
      name: c.Name,
    })),
    cases,
  };
  const save = async () =>
    writeFile(
      join(output, 'receipt.json'),
      JSON.stringify({ ...receipt, verdict, ...(failureSha256 && { failureSha256 }) }, null, 2) +
        '\n',
      { mode: 0o600 },
    );
  /** @param {import('node:child_process').ChildProcess} c */ const kill = (c) => {
    if (c.pid && c.exitCode === null && c.signalCode === null)
      try {
        process.kill(-c.pid, 'SIGKILL');
      } catch {
        /* exact owned group exited */
      }
  };
  /** @param {string} mode @param {string} root @param {string} arm @param {string} operation @param {string} [fault] */
  const worker = (mode, root, arm, operation, fault = 'none') => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        join(
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
        operation,
        fault,
      ],
      {
        cwd: join(
          ROOT,
          mode === 'wallet-observer' ? 'apps/passport-dapp' : 'apps/passport-service',
        ),
        env: {
          ...env,
          PASSPORT_REGISTRY_FILE: join(root, 'registry.json'),
          ...(lifecycle &&
            mode === 'wallet-observer' && {
              PASSPORT_WALLET_OWNER_FIXTURE: join(dirname(root), 'fixture.json'),
            }),
        },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    children.add(child);
    /** @type {Array<Record<string,any>>} */ const messages = [];
    let pending = '',
      log = '',
      exceeded = false;
    const collect = (/** @type {Buffer} */ chunk) => {
      if (Buffer.byteLength(log) + chunk.length > 8 * 1024 * 1024) {
        exceeded = true;
        kill(child);
        return;
      }
      log += String(chunk);
      pending += String(chunk);
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines)
        if (line.startsWith('PASSPORT_LIVE ')) {
          try {
            const m = JSON.parse(line.slice(14));
            messages.push(m);
            if (
              m.ready ||
              m.crash ||
              m.proverBoundary ||
              m.failed ||
              m.completed ||
              m.imageReplyLost ||
              m.walletReady ||
              m.walletDisconnected ||
              m.walletSubmitted
            )
              console.log(
                'native jobs:',
                JSON.stringify({
                  lane,
                  arm,
                  operation,
                  ready: m.ready,
                  crash: m.crash,
                  proverBoundary: m.proverBoundary,
                  failed: m.failed,
                  code: m.code,
                  imageReplyLost: m.imageReplyLost,
                  walletReady: m.walletReady,
                  walletDisconnected: m.walletDisconnected,
                  walletSubmitted: m.walletSubmitted,
                  completed: typeof m.completed === 'string' ? m.completed : undefined,
                }),
              );
          } catch {
            /* raw diagnostics stay private */
          }
        }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const done = new Promise((resolveDone, reject) => {
      child.once('error', reject);
      child.once('close', async (code, signal) => {
        children.delete(child);
        await writeFile(
          join(output, `worker-${arm}-${mode}-${operation}-${Date.now()}.private.log`),
          log,
          { mode: 0o600 },
        );
        resolveDone({ code, signal, exceeded, messages, logSha256: nativeJobHash(log) });
      });
    });
    return { child, messages, done };
  };
  /** @param {ReturnType<typeof worker>} w @param {number} [ms] */
  const finished = async (w, ms = 12 * 60000) => {
    const timer = setTimeout(() => kill(w.child), ms);
    try {
      const r =
        /** @type {{code:number|null,signal:NodeJS.Signals|null,exceeded:boolean,messages:Array<Record<string,any>>,logSha256:string}} */ (
          await w.done
        );
      assert.equal(r.exceeded, false);
      return r;
    } finally {
      clearTimeout(timer);
    }
  };
  /** @param {string} root @param {string} arm @param {string} fault @param {string} [operation] */
  const host = async (root, arm, fault, operation = 'create') => {
    const w = worker('host', root, arm, operation, fault);
    await wait(
      async () => w.messages.some((m) => m.ready),
      240000,
      () => w.child.exitCode !== null || w.child.signalCode !== null,
    );
    assert.equal(await ready('http://127.0.0.1:18797/healthz'), true);
    return w;
  };
  /** @param {string} root @param {string} arm */
  const probe = async (root, arm) => {
    docker(['stop', '--time', '1', ids[1]]);
    try {
      await wait(async () => !(await indexerReady()), 10000);
      const checked = await finished(worker('probe', root, arm, 'create'), 15000);
      assert.equal(checked.code, 0);
      assert.ok(
        checked.messages.some(
          (m) => m.probe === 'unknown-during-real-indexer-outage' && m.checked > 0,
        ),
      );
      return checked;
    } finally {
      docker(['start', ids[1]]);
      await wait(indexerReady, 120000);
    }
  };
  /** @param {string} root @param {string} arm */
  const imageContainer = (root, arm) => {
    const { container: name, volume } = imageStateNames(basename(output), arm, profile);
    assert.equal(
      docker(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.ID}}']).trim(),
      '',
      'Never overwrite an old uncertain image fixture.',
    );
    const uid = process.getuid?.(),
      gid = process.getgid?.();
    assert.ok(uid && gid && uid !== 0);
    assert.equal(
      docker(['volume', 'ls', '--filter', `name=^${volume}$`, '--format', '{{.Name}}']).trim(),
      '',
    );
    docker(['volume', 'create', '--label', 'passport.qualification=' + options.label, volume]);
    // Provision only this fresh Linux volume. The service itself always runs non-root.
    const filesystem = JSON.parse(
      docker([
        'run',
        '--rm',
        '--platform',
        options.platform,
        '--network',
        'none',
        '--user',
        '0:0',
        '--mount',
        `type=volume,src=${volume},dst=/data/state,volume-nocopy`,
        '--entrypoint',
        'node',
        imageId,
        '-e',
        `const fs=require('node:fs');fs.chownSync('/data/state',${uid},${gid});fs.chmodSync('/data/state',448);const s=fs.statfsSync('/data/state');console.log(JSON.stringify({type:s.type,nativeLinuxVolume:true}));`,
      ]),
    );
    assert.equal(filesystem.type, 0xef53, 'State must be on the Docker-managed ext filesystem.');
    const probe = JSON.parse(
      docker([
        'run',
        '--rm',
        '--platform',
        options.platform,
        '--network',
        'none',
        '--user',
        `${uid}:${gid}`,
        '--mount',
        `type=volume,src=${volume},dst=/data/state,volume-nocopy`,
        '--entrypoint',
        'node',
        imageId,
        '--input-type=module',
        '-e',
        `import {fileMutationByteStore} from '/opt/passport/packages/service/dist/index.js';const b=fileMutationByteStore('/data/state/fs-probe'),id='1'.repeat(32),bytes=new Uint8Array(32);const first=await b.compareAndSwap(id,undefined,{revision:0,bytes});const second=await b.compareAndSwap(id,0,{revision:1,bytes});console.log(JSON.stringify({first,second,head:(await b.read(id)).revision,uid:process.getuid()}));`,
      ]),
    );
    assert.deepEqual(probe, { first: true, second: true, head: 1, uid });
    imageStates.push({ arm, volume, filesystem, probe });
    const args = [
      'create',
      '--name',
      name,
      '--label',
      'passport.qualification=' + options.label,
      '--platform',
      options.platform,
      '--network',
      `${PROJECT}_midnight`,
      '--user',
      `${uid}:${gid}`,
      '--publish',
      '127.0.0.1:18797:18797',
      '--mount',
      `type=bind,src=${contract},dst=/data/contract,readonly`,
      '--mount',
      `type=volume,src=${depsVolume},dst=/data/contract/node_modules,readonly,volume-nocopy`,
      '--mount',
      `type=volume,src=${volume},dst=/data/state,volume-nocopy`,
    ];
    for (const key of ['host-key', 'host-token', 'job-key', 'job-token'])
      args.push('--mount', `type=bind,src=${join(root, key)},dst=/private/${key},readonly`);
    const settings = {
      MN_NETWORK_ID: 'undeployed',
      MIDNIGHT_NETWORK: 'local',
      MN_NODE_URL: 'http://node:9944',
      MN_INDEXER_URL: 'http://indexer:8088/api/v4/graphql',
      MN_INDEXER_WS_URL: 'ws://indexer:8088/api/v4/graphql/ws',
      MN_PROOF_SERVER_URL: 'http://proof-server:6300',
      PASSPORT_SERVICE_HOST: '0.0.0.0',
      PASSPORT_SERVICE_PORT: '18797',
      PASSPORT_MANIFEST_SHA256: binding.compilerManifestSha256,
      PASSPORT_HOST_MUTATION_DIR: '/data/state/host-journal',
      PASSPORT_HOST_MUTATION_KEY_FILE: '/private/host-key',
      PASSPORT_HOST_MUTATION_TOKEN_FILE: '/private/host-token',
      PASSPORT_HOST_JOB_DIR: '/data/state/job-journal',
      PASSPORT_HOST_JOB_KEY_FILE: '/private/job-key',
      PASSPORT_HOST_JOB_TOKEN_FILE: '/private/job-token',
      PASSPORT_HOST_JOB_COMPLETED_TTL_MS: '86400000',
      PASSPORT_PUBLIC_NODE_URL: env.MN_NODE_URL,
      PASSPORT_PUBLIC_INDEXER_URL: env.MN_INDEXER_URL,
      PASSPORT_PUBLIC_INDEXER_WS_URL: env.MN_INDEXER_WS_URL,
      PASSPORT_PUBLIC_PROOF_SERVER_URL: env.MN_PROOF_SERVER_URL,
    };
    for (const [k, v] of Object.entries(settings)) {
      assert.ok(v);
      args.push('--env', k + '=' + v);
    }
    args.push(imageId);
    const id = docker(args).trim();
    assert.match(id, /^[a-f0-9]{64}$/);
    ownedContainers.push(id);
    return id;
  };
  /** Only immutable encrypted revisions leave Linux; no execution or key export.
   * @param {string} id @param {string} root @param {{history?:boolean}} [options] */
  const imageSnapshot = async (id, root, options) => {
    const manifest = JSON.parse(docker(['exec', id, 'node', '-e', IMAGE_JOURNAL_MANIFEST]));
    await mirrorImageJournals(root, manifest, async (journal, name, destination) => {
      docker(['cp', `${id}:/data/state/${journal}/${name}`, destination]);
    });
    return nativeJobSnapshot(root, options);
  };
  const onInterrupt = () => {
    for (const c of children) kill(c);
    process.exitCode = 130;
  };
  process.once('SIGINT', onInterrupt);
  process.once('SIGTERM', onInterrupt);
  try {
    await wait(indexerReady, 120000);
    await save();
    for (const arm of ['jubjub', 'p256']) {
      const root = join(output, arm);
      await mkdir(root, { mode: 0o700 });
      const prepared = await finished(worker('prepare', root, arm, 'create'), 30000);
      assert.equal(prepared.code, 0);
      assert.ok(prepared.messages.some((m) => m.prepared && m.hostJobs));
      console.log(`native jobs: ${lane} ${arm} fresh fixture prepared`);
      if (lifecycle) {
        await runJobBackedLifecycle({
          lane,
          root,
          arm,
          worker,
          host,
          finished,
          kill,
          probe,
          docker,
          ids,
          imageContainer,
          imageSnapshot,
          indexerReady,
          wait,
          ready,
          cases,
          save,
          imageId,
          options,
        });
      } else if (lane === 'source') {
        /** @type {Awaited<ReturnType<typeof nativeJobSnapshot>>|undefined} */ let previous;
        for (const fault of [
          'deploy:0:after-submit',
          'before-deploy-proof',
          'call:0:after-submit',
          'none',
        ]) {
          const started = Date.now(),
            h = await host(root, arm, fault),
            owner = worker(
              fault === 'deploy:0:after-submit' ? 'owner' : 'resume',
              root,
              arm,
              'create',
              fault === 'before-deploy-proof' ? fault : 'none',
            );
          if (fault === 'before-deploy-proof') {
            await wait(
              async () => h.messages.some((m) => m.proverBoundary === 'deploy'),
              180000,
              () => nativeWorkerStopped(h.child),
            );
            docker(['stop', '--time', '1', ids[2]]);
            await writeFile(join(root, 'prover-down-deploy'), 'owned prover stopped\n', {
              flag: 'wx',
              mode: 0o600,
            });
          }
          const result = await finished(owner);
          if (fault === 'none') {
            assert.equal(result.code, 0);
            assert.ok(
              result.messages.some(
                (m) => m.completed === 'create' && m.audit?.phase === 'complete',
              ),
            );
          } else
            requireExpectedFailure(result, 'create', fault, /** @type {'jubjub'|'p256'} */ (arm));
          if (fault === 'deploy:0:after-submit' || fault === 'call:0:after-submit') {
            requireExpectedHostCrash(await finished(h, 15000), fault);
            await probe(root, arm);
          } else {
            kill(h.child);
            await finished(h, 15000);
          }
          if (fault === 'before-deploy-proof') {
            docker(['start', ids[2]]);
            await wait(async () => ready('http://127.0.0.1:16310/health'), 120000);
          }
          const snapshot = await nativeJobSnapshot(root);
          if (previous) assertNativeJobContinuation(previous, snapshot);
          previous = snapshot;
          cases.push({
            arm,
            operation: 'create',
            fault,
            durationMs: Date.now() - started,
            verdict: 'PASS',
            owner: result,
            snapshot,
          });
          await save();
        }
        // Owner proof fails before registration. Missing job/host state cannot justify replacement.
        const h = await host(root, arm, 'none'),
          owner = worker('owner', root, arm, 'rotate-prover', 'before-owner-proof');
        await wait(
          async () => owner.messages.some((m) => m.proverBoundary === 'owner'),
          180000,
          () => nativeWorkerStopped(owner.child),
        );
        docker(['stop', '--time', '1', ids[2]]);
        await writeFile(join(root, 'prover-down-owner'), 'owned prover stopped\n', {
          flag: 'wx',
          mode: 0o600,
        });
        const failed = await finished(owner);
        requireExpectedFailure(
          failed,
          'rotate-prover',
          'before-owner-proof',
          /** @type {'jubjub'|'p256'} */ (arm),
        );
        kill(h.child);
        await finished(h, 15000);
        const before = await nativeJobSnapshot(root);
        docker(['start', ids[2]]);
        await wait(async () => ready('http://127.0.0.1:16310/health'), 120000);
        const live = await host(root, arm, 'none');
        const unknown = await finished(
          worker('resume', root, arm, 'rotate-prover', 'assert-unknown'),
          60000,
        );
        requireExpectedFailure(
          unknown,
          'rotate-prover',
          'assert-unknown',
          /** @type {'jubjub'|'p256'} */ (arm),
        );
        kill(live.child);
        await finished(live, 15000);
        const after = await nativeJobSnapshot(root);
        assert.deepEqual(after, before);
        cases.push({
          arm,
          operation: 'rotate-prover',
          verdict: 'PASS',
          safeUnknown: true,
          owner: unknown,
          snapshot: after,
        });
        await save();
      } else {
        const id = imageContainer(root, arm);
        docker(['start', id]);
        await wait(
          async () => ready('http://127.0.0.1:18797/healthz'),
          600000,
          () => !JSON.parse(docker(['inspect', id]))[0].State.Running,
        );
        const config = /** @type {any} */ (
          await (await fetch('http://127.0.0.1:18797/healthz')).json()
        );
        assert.equal(config.hostJobs, true);
        let previous;
        for (const [n, kind] of ['deploy', 'call'].entries()) {
          const started = Date.now(),
            owner = worker(n === 0 ? 'owner' : 'resume', root, arm, 'create', 'none');
          await wait(
            async () => {
              const s = await imageSnapshot(id, root, { history: false });
              return s.jobs.some(
                (j) =>
                  j.identity.kind === kind &&
                  j.host?.steps.some((step, index) =>
                    kind === 'deploy'
                      ? index === 0 && step.phase === 'confirmed'
                      : step.phase === 'dispatching' || step.phase === 'submitted',
                  ),
              );
            },
            12 * 60000,
            () => nativeWorkerStopped(owner.child),
          );
          const before = await imageSnapshot(id, root);
          docker(['kill', '--signal', 'KILL', id]);
          const interrupted = await finished(owner, 60000);
          requireNativeJobFailure(
            interrupted,
            'create',
            kind === 'deploy' ? 'MutationUnsettled' : 'InternalError',
          );
          // Restart the SAME container/volume before read-only journal copying.
          docker(['start', id]);
          const retained = await imageSnapshot(id, root);
          assertNativeJobContinuation(before, retained);
          if (previous) assertNativeJobContinuation(previous, retained);
          previous = retained;
          cases.push({
            arm,
            operation: 'create',
            boundary: kind,
            verdict: 'PASS',
            durationMs: Date.now() - started,
            owner: interrupted,
            snapshot: retained,
            containerId: id,
          });
          await save();
          await wait(
            async () => ready('http://127.0.0.1:18797/healthz'),
            600000,
            () => !JSON.parse(docker(['inspect', id]))[0].State.Running,
          );
        }
        const completed = await finished(worker('resume', root, arm, 'create'), 15 * 60000);
        assert.equal(completed.code, 0);
        assert.ok(
          completed.messages.some((m) => m.completed === 'create' && m.audit?.phase === 'complete'),
        );
        const final = await imageSnapshot(id, root);
        assert.ok(previous);
        assertNativeJobContinuation(previous, final);
        assert.ok(final.jobs.every((j) => j.state === 'done'));
        assert.equal(final.dispatchClaims, final.confirmed);
        const inspection = JSON.parse(docker(['inspect', id]))[0];
        assert.equal(inspection.Image, imageId);
        assert.equal(inspection.Config.User, `${process.getuid?.()}:${process.getgid?.()}`);
        assert.deepEqual(inspection.Config.Entrypoint, [
          '/opt/passport/apps/passport-service/image-entrypoint.sh',
        ]);
        assert.equal(inspection.Mounts.filter((/** @type {any} */ m) => m.RW).length, 1);
        assert.ok(
          inspection.Mounts.some(
            (/** @type {any} */ m) =>
              m.Destination === '/data/state' &&
              m.RW &&
              m.Type === 'volume' &&
              m.Name === imageStateNames(basename(output), arm, profile).volume,
          ),
        );
        for (const path of [
          '/data/contract',
          '/data/contract/node_modules',
          '/private/host-key',
          '/private/host-token',
          '/private/job-key',
          '/private/job-token',
        ])
          assert.ok(
            inspection.Mounts.some((/** @type {any} */ m) => m.Destination === path && !m.RW),
          );
        cases.push({
          arm,
          operation: 'create',
          verdict: 'PASS',
          owner: completed,
          snapshot: final,
          containerId: id,
          mounts: inspection.Mounts.map((/** @type {any} */ m) => ({
            type: m.Type,
            destination: m.Destination,
            readOnly: !m.RW,
            ...(m.Type === 'volume' ? { volume: m.Name } : {}),
          })),
        });
        docker(['stop', '--time', '35', id]);
        await writeFile(join(output, `image-${arm}.private.log`), docker(['logs', id]), {
          mode: 0o600,
        });
        await save();
      }
      const summary = await nativeJobSnapshot(root);
      assert.equal(summary.dispatchClaims, summary.confirmed);
      assert.ok(summary.jobs.every((j) => j.state === 'done'));
      if (lane === 'source') {
        const encoded = JSON.parse(await readFile(join(root, 'events.json'), 'utf8'));
        const events = /** @type {Array<Record<string,any>>} */ (encoded); // events are scalar JSON; no tagged values.
        const sends = events.filter((e) => e.stage === 'send-enter');
        assert.equal(sends.length, summary.dispatchClaims);
        assert.equal(new Set(sends.map((e) => e.bytesSha256)).size, sends.length);
        cases.push({
          arm,
          operation: 'send-audit',
          verdict: 'PASS',
          hostSendAttempts: sends.length,
          duplicateSendAttempts: 0,
          snapshot: summary,
        });
      }
    }
    assert.deepEqual(
      await workspaceIdentity(ROOT),
      source,
      'Native source/runtime changed during execution.',
    );
    assert.deepEqual(
      await referenceFingerprint(contract),
      reference,
      'Reference inputs changed during execution.',
    );
    verdict = 'PASS';
    await save();
    console.log('native jobs qualification: PASS ' + lane);
  } catch (error) {
    const diagnostic = error instanceof Error ? (error.stack ?? error.message) : String(error);
    failureSha256 = nativeJobHash(diagnostic);
    await writeFile(join(output, 'failure.private.log'), diagnostic, { mode: 0o600 });
    verdict = 'FAIL';
    await save();
    throw error;
  } finally {
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);
    for (const child of children) kill(child);
    await Promise.allSettled([...children].map((c) => new Promise((r) => c.once('close', r))));
    for (const id of ownedContainers) {
      const c = JSON.parse(docker(['inspect', id]))[0];
      assert.equal(c.Config.Labels['passport.qualification'], options.label);
      if (c.State.Running) docker(['stop', '--time', '35', id]);
    }
    for (const id of [ids[1], ids[2]])
      if (!JSON.parse(docker(['inspect', id]))[0].State.Running) docker(['start', id]);
  }
}
if (process.argv[1] === import.meta.filename)
  await runNativeHostJobs(/** @type {'source'|'image'} */ (process.argv[2] ?? 'source'));
