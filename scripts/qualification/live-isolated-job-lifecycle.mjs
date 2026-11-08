// Explicit opt-in source-native lane. Importing this file starts no process or network.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync, existsSync, realpathSync, statfsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  claimIsolationLease,
  releaseIsolationLease,
  saveIsolationReceipt,
} from './native-isolation-files.mjs';
import { nativeLeasePath } from './native-lease.mjs';
import { sessionOutputPath } from './session-profile.mjs';
import {
  isolationProfile,
  isolationEnvironment,
  isolationObject,
  assertIsolationOverrides,
  ISOLATED_PORTS,
} from './native-isolation-profile.mjs';
import { isolatedStack, isolatedImages } from './native-isolated-stack.mjs';
import { isolationDeadline, isolatedProcesses } from './native-isolation-control.mjs';
import { isolatedInputs } from './native-isolation-inputs.mjs';
import { dedicatedIndexerReadiness } from './indexer-readiness.mjs';
import { runNativeHostJobs } from './live-host-jobs.mjs';
const ROOT = realpathSync(resolve(import.meta.dirname, '../..'));
/** @param {string[]} args @param {number} timeout */
const runDocker = (args, timeout) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
/** Probe only; a race losing the subsequent bind must refuse, never adopt the listener.
 * @param {number} port */
export async function isolatedFreePort(port) {
  await new Promise((ok, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () =>
      server.close((error) => (error ? fail(error) : ok(undefined))),
    );
  });
}
/** @param {ReturnType<typeof import('./native-isolation-control.mjs').isolationDeadline>} deadline */
function boundedWait(deadline) {
  return async (
    /** @type {()=>Promise<boolean>} */ test,
    /** @type {number} */ ms,
    terminal = () => false,
  ) => {
    const end = performance.now() + deadline.remaining(ms);
    while (performance.now() < end) {
      deadline.check();
      assert.equal(terminal(), false, 'Owned child stopped before readiness');
      if (await test()) return;
      await delay(Math.min(500, Math.max(0, end - performance.now())));
    }
    throw new Error('Isolated readiness/deadline expired; preserve original state');
  };
}
/** @param {NodeJS.ProcessEnv} env @param {import('./native-isolation-profile.mjs').IsolationProfile} profile
 * @param {ReturnType<typeof import('./native-isolated-stack.mjs').isolatedStack>} stack @param {ReturnType<typeof import('./native-isolation-control.mjs').isolationDeadline>} deadline
 * @param {ReturnType<typeof isolatedProcesses>} processes @param {(args:string[])=>string} docker */
async function executeIsolatedLifecycle(env, profile, stack, deadline, processes, docker) {
  const info = isolationObject(JSON.parse(docker(['info', '--format', '{{json .}}'])));
  assert.ok(typeof info.MemTotal === 'number' && info.MemTotal >= 24 * 1024 ** 3);
  const arch =
    info.Architecture === 'aarch64'
      ? 'arm64'
      : info.Architecture === 'x86_64'
        ? 'amd64'
        : String(info.Architecture);
  const images = isolatedImages(docker, arch);
  await Promise.all(Object.values(ISOLATED_PORTS).map(isolatedFreePort));
  deadline.check();
  stack.create(images);
  const wait = boundedWait(deadline);
  stack.transition('start', stack.find('node'));
  await wait(async () => {
    try {
      const r = await fetch(profile.endpoints.nodeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getHeader', params: [] }),
        signal: AbortSignal.timeout(2000),
      });
      const v = isolationObject(await r.json());
      const result = isolationObject(v.result);
      return (
        r.ok &&
        typeof result.number === 'string' &&
        /^0x[0-9a-f]+$/.test(result.number) &&
        BigInt(result.number) >= 1n
      );
    } catch {
      return false;
    }
  }, 120000);
  for (const service of ['indexer', 'proof-server']) {
    assert.ok(service === 'indexer' || service === 'proof-server');
    stack.transition('start', stack.find(service));
  }
  let initialReadiness = await dedicatedIndexerReadiness(profile.endpoints);
  await wait(async () => {
    initialReadiness = await dedicatedIndexerReadiness(profile.endpoints);
    return initialReadiness.ready;
  }, 180000);
  await wait(async () => {
    try {
      return (
        await fetch(profile.endpoints.proverUrl + '/health', {
          signal: AbortSignal.timeout(2000),
        })
      ).ok;
    } catch {
      return false;
    }
  }, 120000);
  const context = {
    profile,
    env: { ...env, ...isolationEnvironment(profile), PASSPORT_LIVE_ROOT: profile.outputRoot },
    ids: stack.inventory.containers.map((c) => c.id),
    docker: stack.control,
    check: () => {
      deadline.check();
      processes.check();
    },
    remaining: deadline.remaining,
    wait,
    register: processes.register,
    kill: (/** @type {import('node:child_process').ChildProcess} */ child) =>
      processes.send(child, 'SIGKILL'),
    beforeHost: async () => {
      deadline.check();
      processes.check();
      await isolatedFreePort(ISOLATED_PORTS.service);
    },
  };
  const work = runNativeHostJobs('source', 'lifecycle', context);
  work.catch(() => {});
  await Promise.race([work, deadline.aborted]);
  deadline.check();
  const finalReadiness = await dedicatedIndexerReadiness(profile.endpoints);
  assert.equal(finalReadiness.ready, true, 'Isolated final indexer readiness failed');
  deadline.check();
  return { images, initialReadiness, finalReadiness };
}

/** @param {NodeJS.ProcessEnv} [env] */
export async function runIsolatedJobLifecycle(env = process.env) {
  const started = performance.now(),
    deadline = isolationDeadline(started),
    processes = isolatedProcesses();
  assert.ok(env.IN_NIX_SHELL);
  assert.equal(env.PASSPORT_ISOLATED_LIFECYCLE_NATIVE, '1');
  assert.equal(env.PASSPORT_RC_LOCALNET, '1');
  assert.equal(env.MN_NETWORK_ID, 'undeployed');
  assertIsolationOverrides(env);
  for (const key of Object.keys(env))
    assert.ok(
      !key.startsWith('PASSPORT_NATIVE_ISOLATION'),
      'Do not adopt an existing isolated run',
    );
  assert.equal(env.PASSPORT_WALLET_OWNER_FIXTURE, undefined);
  const contract = realpathSync(env.PASSPORT_CONTRACT_DIR ?? '');
  const output = sessionOutputPath(env.PASSPORT_LIVE_ROOT ?? '', [ROOT, contract]);
  assert.equal(existsSync(output), false, 'Preserve every prior native attempt');
  const fs = statfsSync(dirname(output));
  assert.ok(BigInt(fs.bavail) * BigInt(fs.bsize) >= 15n * 1024n ** 3n);
  const profile = isolationProfile(randomBytes(8).toString('hex'), output);
  mkdirSync(output, { mode: 0o700 });
  /** @type {Record<string,unknown> & {verdict:string,endInputsUnchanged:boolean,leaseReleased:boolean}} */
  const receipt = {
    schema: 1,
    kind: profile.kind,
    profile,
    softwareCredentials: true,
    realProviderQualified: false,
    browserNativeCombined: false,
    releaseQualified: false,
    verdict: 'IN_PROGRESS',
    /** @type {unknown} */ inputs: undefined,
    /** @type {unknown} */ resources: undefined,
    /** @type {unknown} */ cleanup: undefined,
    endInputsUnchanged: false,
    leaseReleased: false,
    /** @type {string|undefined} */ failureSha256: undefined,
  };
  const save = () => saveIsolationReceipt(join(output, 'parent-receipt.private.json'), receipt);
  save();
  writeFileSync(join(output, 'isolation.json'), JSON.stringify(profile) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  const lease = nativeLeasePath(),
    owner = { runId: profile.runId, pid: process.pid, project: profile.project, root: output };
  let acquired = false,
    cleanupEnd = Infinity;
  const docker = (/** @type {string[]} */ args) => {
    const remaining = Math.min(deadline.cleanupRemaining(), cleanupEnd - performance.now());
    assert.ok(remaining > 0, 'Isolated resource control deadline expired');
    return runDocker(args, Math.max(1, Math.min(30000, remaining)));
  };
  const stack = isolatedStack(profile, docker, save, deadline.check);
  receipt.resources = stack.inventory;
  /** @type {Awaited<ReturnType<typeof isolatedInputs>>|undefined} */ let inputs;
  const interrupt = () => deadline.abort('Isolated lifecycle signal received');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    claimIsolationLease(lease, owner);
    acquired = true;
    save();
    inputs = await isolatedInputs(ROOT, contract, deadline.check);
    receipt.inputs = { ...inputs.frozen, keys: inputs.keys };
    save();
    receipt.execution = await executeIsolatedLifecycle(
      { ...env, PASSPORT_CONTRACT_DIR: contract },
      profile,
      stack,
      deadline,
      processes,
      docker,
    );
    receipt.verdict = 'PASS';
  } catch (error) {
    receipt.verdict = 'FAIL';
    receipt.failureSha256 = createHash('sha256').update(String(error)).digest('hex');
  } finally {
    deadline.abort('Isolated lifecycle finalizing');
    cleanupEnd = performance.now() + Math.min(130000, deadline.cleanupRemaining());
    const childCleanup = await processes.stop(Math.min(10000, deadline.cleanupRemaining()));
    const resourceCleanup = stack.cleanup();
    receipt.cleanup = { ...resourceCleanup, children: childCleanup };
    if (resourceCleanup.incomplete || childCleanup.incomplete) receipt.verdict = 'FAIL';
    try {
      if (inputs) {
        await inputs.verify(() =>
          assert.ok(
            deadline.cleanupRemaining() > 0 && performance.now() < cleanupEnd,
            'End-input deadline expired',
          ),
        );
        receipt.endInputsUnchanged = true;
      } else receipt.verdict = 'FAIL';
    } catch {
      receipt.verdict = 'FAIL';
    }
    if (acquired && !resourceCleanup.incomplete && !childCleanup.incomplete) {
      try {
        releaseIsolationLease(lease, owner, true);
        receipt.leaseReleased = true;
      } catch {
        receipt.verdict = 'FAIL';
      }
    }
    save();
    deadline.clear();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
  assert.equal(
    receipt.verdict,
    'PASS',
    'Isolated native lifecycle failed; preserve original evidence',
  );
  assert.equal(receipt.leaseReleased, true, 'Owned cleanup/lease remains unresolved');
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename)
  await runIsolatedJobLifecycle();
