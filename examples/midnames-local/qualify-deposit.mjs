import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, statfsSync } from 'node:fs';
import { isIPv4 } from 'node:net';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { nativeLeasePath } from '../../scripts/qualification/native-lease.mjs';
import {
  claimIsolationLease,
  releaseIsolationLease,
  saveIsolationReceipt,
} from '../../scripts/qualification/native-isolation-files.mjs';
import {
  assertIsolationOverrides,
  isolationEnvironment,
  isolationProfile,
  ISOLATED_PORTS,
} from '../../scripts/qualification/native-isolation-profile.mjs';
import {
  isolatedImages,
  isolatedStack,
} from '../../scripts/qualification/native-isolated-stack.mjs';
import { isolatedInputs } from '../../scripts/qualification/native-isolation-inputs.mjs';
import { isolatedFreePort } from '../../scripts/qualification/live-isolated-job-lifecycle.mjs';
import {
  isolatedProcesses,
  isolationDeadline,
} from '../../scripts/qualification/native-isolation-control.mjs';
import { dedicatedIndexerReadiness } from '../../scripts/qualification/indexer-readiness.mjs';
import { verifyPreparedRegistry } from './verify-prepared.mjs';

assert.ok(process.env.IN_NIX_SHELL);
assert.equal(process.env.PASSPORT_MIDNAMES_NATIVE, '1');
assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
assertIsolationOverrides(process.env);
const [out, prepared, ref, subnet] = process.argv.slice(2);
assert.ok(prepared && ref && isAbsolute(prepared) && isAbsolute(ref));
if (subnet !== undefined) {
  const [address, prefix] = subnet.split('/');
  assert.ok(address?.startsWith('10.') && isIPv4(address) && /^2[4-9]$/.test(prefix ?? ''));
  assert.equal(subnet, `${address}/${prefix}`);
}
const root = realpathSync(new URL('../..', import.meta.url).pathname);
const disk = statfsSync(root);
assert.ok(BigInt(disk.bavail) * BigInt(disk.bsize) >= 15n * 1024n ** 3n);
const docker = (args) =>
  execFileSync(
    'docker',
    subnet && args[0] === 'network' && args[1] === 'create'
      ? [...args.slice(0, 2), '--subnet', subnet, ...args.slice(2)]
      : args,
    { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
const info = JSON.parse(docker(['info', '--format', '{{json .}}']));
assert.ok(info.MemTotal >= 24 * 1024 ** 3);
const images = isolatedImages(docker, info.Architecture === 'aarch64' ? 'arm64' : 'amd64');
assert.match(
  out ?? '',
  /^midnames-(?:deposit|night-send|claim-handoff|claim-browser|claim-owner-browser|named-open-(?:p256|jubjub)|registry-authority)-[a-z0-9-]{1,48}$/,
);
const namedMode = /^midnames-(named-open-(?:p256|jubjub)|registry-authority)-/.exec(out)?.[1];
const fixtureMode =
  namedMode ??
  (out.startsWith('midnames-claim-browser-')
    ? 'claim-browser'
    : out.startsWith('midnames-claim-owner-browser-')
      ? 'claim-owner-browser'
      : out.startsWith('midnames-claim-handoff-')
        ? 'claim-handoff'
        : out.startsWith('midnames-night-send-')
          ? 'named-night-send'
          : 'named-shielded-deposit');
const review = join(root, 'review');
mkdirSync(review, { recursive: true, mode: 0o700 });
assert.equal(realpathSync(review), review);
const output = join(review, out);
mkdirSync(output, { mode: 0o700 });
const profile = isolationProfile(randomBytes(8).toString('hex'), output);
const receipt = { profile, images, status: 'RUNNING' };
const save = () => saveIsolationReceipt(join(output, 'parent.json'), receipt);
const deadline = isolationDeadline(performance.now());
const stack = isolatedStack(profile, docker, save, deadline.check);
const processes = isolatedProcesses();
receipt.resources = stack.inventory;
const lease = nativeLeasePath(),
  owner = { runId: profile.runId, pid: process.pid, project: profile.project, root: output };
let claimed = false,
  pin,
  inputs;
const interrupt = () => deadline.abort('Native qualification interrupted');
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
const wait = async (check, ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    deadline.check();
    if (await check()) return;
    await delay(500);
  }
  throw Error('Native readiness timeout');
};
try {
  claimIsolationLease(lease, owner);
  claimed = true;
  const s = lstatSync(lease);
  pin = {
    dev: s.dev,
    ino: s.ino,
    sha256: createHash('sha256').update(readFileSync(lease)).digest('hex'),
  };
  receipt.leasePin = pin;
  save();
  await verifyPreparedRegistry(prepared, deadline.check);
  inputs = await isolatedInputs(root, ref, deadline.check);
  receipt.source = inputs.frozen.source;
  await Promise.all(Object.values(ISOLATED_PORTS).map(isolatedFreePort));
  if (fixtureMode === 'claim-browser') await isolatedFreePort(15189);
  try {
    stack.create(images);
  } catch (error) {
    if (
      stack.inventory.pending === 'network-create' &&
      /address pools have been fully subnetted|Pool overlaps/.test(String(error)) &&
      docker(['network', 'ls', '--filter', `name=^${profile.project}$`, '--format', '{{.ID}}']) ===
        '' &&
      docker([
        'network',
        'ls',
        '--filter',
        `label=passport.native.project=${profile.project}`,
        '-q',
      ]) === ''
    ) {
      stack.inventory.pending = '';
      receipt.networkCreateRefused = true;
      save();
    }
    throw error;
  }
  stack.transition('start', stack.find('node'));
  await wait(async () => {
    try {
      const response = await fetch(profile.endpoints.nodeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getHeader', params: [] }),
        signal: AbortSignal.timeout(2000),
      });
      const body = await response.json();
      return response.ok && BigInt(body.result.number) >= 2n;
    } catch {
      return false;
    }
  }, 120_000);
  for (const role of ['indexer', 'proof-server']) stack.transition('start', stack.find(role));
  await wait(async () => (await dedicatedIndexerReadiness(profile.endpoints)).ready, 180_000);
  await wait(
    async () =>
      fetch(profile.endpoints.proverUrl + '/health', { signal: AbortSignal.timeout(2000) })
        .then((r) => r.ok)
        .catch(() => false),
    120_000,
  );
  const env = {
    ...process.env,
    ...isolationEnvironment(profile),
    MN_NETWORK_ID: 'undeployed',
    MIDNIGHT_NETWORK: 'local',
    PASSPORT_MIDNAMES_FIXTURE_MODE: fixtureMode,
  };
  const worker = spawn(
    process.execPath,
    [
      '--experimental-import-meta-resolve',
      '--import',
      'tsx',
      join(import.meta.dirname, 'deposit-fixture.mjs'),
      output,
      prepared,
      ref,
    ],
    {
      cwd: join(root, 'apps/passport-dapp'),
      env,
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  processes.register(worker);
  const exit = await Promise.race([
    new Promise((resolve, reject) => {
      worker.once('exit', (code, signal) => resolve({ code, signal }));
      worker.once('error', reject);
    }),
    deadline.aborted,
  ]);
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.equal(JSON.parse(readFileSync(join(output, 'worker.json'))).passed, true);
  receipt.status = 'PASS';
} catch (error) {
  receipt.status = 'FAIL';
  receipt.error = String(error);
  console.error(error);
} finally {
  deadline.abort('Native qualification finalizing');
  const children = await processes.stop(10_000);
  const cleanup = stack.cleanup();
  receipt.cleanup = { children, ...cleanup };
  try {
    if (inputs) {
      const check = () => assert.ok(deadline.cleanupRemaining() > 0);
      await inputs.verify(check);
      await verifyPreparedRegistry(prepared, check);
      receipt.inputsUnchanged = true;
    }
  } catch (error) {
    receipt.status = 'FAIL';
    receipt.verificationError = String(error);
  }
  try {
    if (claimed) {
      releaseIsolationLease(lease, owner, !children.incomplete && !cleanup.incomplete, pin);
      receipt.leaseReleased = true;
    }
  } catch (error) {
    receipt.status = 'FAIL';
    receipt.cleanupError = String(error);
  }
  save();
}
assert.equal(receipt.status, 'PASS');
