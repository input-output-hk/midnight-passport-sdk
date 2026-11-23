import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statfsSync } from 'node:fs';
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
  MIDNAMES_900_PROVER_IMAGES,
  MIDNAMES_901_PROVER_IMAGES,
  MIDNAMES_RC_PROVER_IMAGES,
  MIDNAMES_RELEASE_IMAGES,
} from '../../scripts/qualification/native-isolated-stack.mjs';
import { isolatedInputs } from '../../scripts/qualification/native-isolation-inputs.mjs';
import { isolatedFreePort } from '../../scripts/qualification/live-isolated-job-lifecycle.mjs';
import {
  isolatedProcesses,
  isolationDeadline,
} from '../../scripts/qualification/native-isolation-control.mjs';
import { dedicatedIndexerReadiness } from '../../scripts/qualification/indexer-readiness.mjs';
import { verifyPreparedRegistry } from './verify-prepared.mjs';
import { verifyArtefacts } from '../../packages/service/dist/artefacts.js';
import { assertReviewTerminal, interactiveReviewRequested } from './terminal-review.mjs';

assert.ok(process.env.IN_NIX_SHELL);
assert.equal(process.env.PASSPORT_MIDNAMES_NATIVE, '1');
assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
assertIsolationOverrides(process.env);
const interactive = interactiveReviewRequested();
if (interactive) assertReviewTerminal();
const [out, prepared, ref, subnet] = process.argv.slice(2);
assert.ok(ref && isAbsolute(ref));
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
assert.match(
  out ?? '',
  /^midnames-(?:acc-candidate|night-candidate|claim-candidate|deposit|deposit-browser|night-send|night-browser|claim-handoff|claim-browser|claim-preproof|claim-owner-browser|claim-partial-probe|claim-retry|claim-page-retry)-[a-z0-9-]{1,48}$/,
);
const candidateAccount = out.startsWith('midnames-acc-candidate-');
const candidateNight = out.startsWith('midnames-night-candidate-');
const candidateClaim = out.startsWith('midnames-claim-candidate-');
const candidateProfile = candidateAccount || candidateNight || candidateClaim;
const registryProfile = candidateProfile ? 'standalone-0.36.1' : 'standalone-0.35';
assert.ok(candidateAccount ? prepared === '-' : prepared && isAbsolute(prepared));
const candidateAssets = process.env.PASSPORT_MIDNAMES_CANDIDATE_ASSETS;
assert.equal(
  Boolean(candidateAssets),
  candidateProfile,
  'Candidate ACC assets require their own lane',
);
if (candidateProfile) {
  assert.ok(candidateAssets && isAbsolute(candidateAssets));
  assert.equal(realpathSync(candidateAssets), candidateAssets);
  assert.ok(BigInt(disk.bavail) * BigInt(disk.bsize) >= 50n * 1024n ** 3n);
  verifyArtefacts(
    candidateAssets,
    '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f',
  );
}
const browserReview =
  out.startsWith('midnames-deposit-browser-') || out.startsWith('midnames-night-browser-');
const keyProbe = out.startsWith('midnames-night-browser-keyprobe-');
const hybridVerifier = out.startsWith('midnames-night-browser-hybrid-');
const fullVerifier = out.startsWith('midnames-night-browser-full036-');
const keyProbeDirectory = process.env.PASSPORT_MIDNAMES_DIAG_KEY_DIR;
assert.equal(
  Boolean(keyProbeDirectory),
  keyProbe || hybridVerifier || fullVerifier,
  'Alternate key input is limited to its diagnostic lanes',
);
if (keyProbeDirectory) assert.ok(isAbsolute(keyProbeDirectory));
const browserDecline = out.startsWith('midnames-night-browser-decline-');
const browserRepoint = out.startsWith('midnames-night-browser-repoint-');
const manualBrowserReview = process.env.PASSPORT_MIDNAMES_BROWSER_MANUAL === '1';
assert.ok(
  process.env.PASSPORT_MIDNAMES_BROWSER_MANUAL === undefined ||
    ['0', '1'].includes(process.env.PASSPORT_MIDNAMES_BROWSER_MANUAL),
);
assert.ok(!manualBrowserReview || browserReview);
assert.ok(!browserDecline || !manualBrowserReview);
assert.ok(!browserRepoint || !manualBrowserReview);
assert.ok(!hybridVerifier || (!manualBrowserReview && !browserRepoint));
assert.ok(!fullVerifier || (!manualBrowserReview && !browserRepoint));
const fixtureMode = candidateAccount
  ? 'acc-candidate'
  : candidateNight
    ? 'named-night-send'
    : candidateClaim
      ? 'claim-page-retry'
      : out.startsWith('midnames-claim-browser-')
        ? 'claim-browser'
        : out.startsWith('midnames-claim-preproof-')
          ? 'claim-preproof'
          : out.startsWith('midnames-claim-owner-browser-')
            ? 'claim-owner-browser'
            : out.startsWith('midnames-claim-partial-probe-')
              ? 'claim-partial-probe'
              : out.startsWith('midnames-claim-page-retry-')
                ? 'claim-page-retry'
                : out.startsWith('midnames-claim-retry-')
                  ? 'claim-retry'
                  : out.startsWith('midnames-claim-handoff-')
                    ? 'claim-handoff'
                    : out.startsWith('midnames-night-send-') ||
                        out.startsWith('midnames-night-browser-')
                      ? 'named-night-send'
                      : 'named-shielded-deposit';
if (interactive)
  assert.ok(
    !browserReview &&
      (fixtureMode === 'named-shielded-deposit' || fixtureMode === 'named-night-send'),
    'Terminal review supports only named value fixtures.',
  );
const info = JSON.parse(docker(['info', '--format', '{{json .}}']));
assert.ok(info.MemTotal >= 24 * 1024 ** 3);
const legacyRcSelection = process.env.PASSPORT_MIDNAMES_DIAG_RC_PROVER;
assert.ok(legacyRcSelection === undefined || legacyRcSelection === '1');
const selectedProver =
  process.env.PASSPORT_MIDNAMES_DIAG_PROVER ?? (legacyRcSelection === '1' ? 'rc.8' : 'release');
assert.ok(['release', 'rc.8', '9.0.0', '9.0.1'].includes(selectedProver));
assert.ok(legacyRcSelection === undefined || selectedProver === 'rc.8');
assert.ok(selectedProver === 'release' || fixtureMode === 'named-night-send');
const proverImages = {
  release: MIDNAMES_RELEASE_IMAGES,
  'rc.8': MIDNAMES_RC_PROVER_IMAGES,
  '9.0.0': MIDNAMES_900_PROVER_IMAGES,
  '9.0.1': MIDNAMES_901_PROVER_IMAGES,
};
const images = isolatedImages(
  docker,
  info.Architecture === 'aarch64' ? 'arm64' : 'amd64',
  proverImages[selectedProver],
);
const probeKeyHashes = {
  'withdraw_unshielded_with_jubjub.prover':
    'e4b273724feacdaacb4a842ac51ce4c0a9a51de96cc182fe67cc089fa05b33ab',
  'withdraw_unshielded_with_jubjub.verifier':
    '0d379e75fc29bb44de21a263a1f3bd941658aed71ccaa41cf445b29b104715a4',
};
const fullVerifierInventory = fullVerifier
  ? JSON.parse(
      readFileSync(
        join(root, 'examples/midnames-local/evidence/compact036-acc-key-inventory-20261122.json'),
        'utf8',
      ),
    )
  : undefined;
if (fullVerifier) {
  assert.equal(fullVerifierInventory.result, 'complete');
  assert.equal(fullVerifierInventory.circuitsCompared, 52);
  assert.equal(fullVerifierInventory.changedVerifierCount, 48);
  assert.equal(Object.keys(fullVerifierInventory.circuits).length, 52);
}
const verifyProbeKeys = () => {
  if (!keyProbeDirectory) return;
  assert.equal(realpathSync(keyProbeDirectory), keyProbeDirectory);
  const hashes = fullVerifier
    ? {
        'withdraw_unshielded_with_jubjub.prover':
          probeKeyHashes['withdraw_unshielded_with_jubjub.prover'],
        ...Object.fromEntries(
          Object.entries(fullVerifierInventory.circuits).map(([name, pin]) => [
            `${name}.verifier`,
            pin.newVerifierSha256,
          ]),
        ),
      }
    : probeKeyHashes;
  if (fullVerifier)
    assert.deepEqual(readdirSync(keyProbeDirectory).sort(), Object.keys(hashes).sort());
  for (const [name, expected] of Object.entries(hashes)) {
    const path = join(keyProbeDirectory, name);
    const stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink());
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), expected);
  }
};
verifyProbeKeys();
const review = join(root, 'review');
mkdirSync(review, { recursive: true, mode: 0o700 });
assert.equal(realpathSync(review), review);
const output = join(review, out);
mkdirSync(output, { mode: 0o700 });
const profile = isolationProfile(randomBytes(8).toString('hex'), output);
const receipt = {
  profile,
  images,
  status: 'RUNNING',
  reviewMode: browserReview
    ? manualBrowserReview
      ? 'browser-manual'
      : 'browser-automated'
    : interactive
      ? 'terminal'
      : 'synthetic',
};
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
  if (!candidateAccount) await verifyPreparedRegistry(prepared, deadline.check, registryProfile);
  inputs = await isolatedInputs(root, ref, deadline.check);
  receipt.source = inputs.frozen.source;
  await Promise.all(Object.values(ISOLATED_PORTS).map(isolatedFreePort));
  if (fixtureMode === 'claim-browser' || fixtureMode === 'claim-preproof')
    await isolatedFreePort(15189);
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
    PASSPORT_MIDNAMES_BROWSER_REVIEW: browserReview ? '1' : '0',
    PASSPORT_MIDNAMES_BROWSER_MANUAL: manualBrowserReview ? '1' : '0',
    PASSPORT_MIDNAMES_BROWSER_DECISION: browserDecline ? 'decline' : 'approve',
    PASSPORT_MIDNAMES_BROWSER_REPOINT: browserRepoint ? '1' : '0',
    PASSPORT_MIDNAMES_DIAG_KEY_DIR: keyProbeDirectory,
    PASSPORT_MIDNAMES_CANDIDATE_ASSETS: candidateAssets,
  };
  const worker = spawn(
    process.execPath,
    [
      '--experimental-import-meta-resolve',
      '--import',
      'tsx',
      join(
        import.meta.dirname,
        candidateAccount ? 'candidate-account-fixture.mjs' : 'deposit-fixture.mjs',
      ),
      output,
      prepared,
      ref,
    ],
    {
      cwd: join(root, 'apps/passport-dapp'),
      env,
      detached: true,
      stdio: [interactive ? 'inherit' : 'ignore', 'inherit', 'inherit'],
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
      if (!candidateAccount) await verifyPreparedRegistry(prepared, check, registryProfile);
      verifyProbeKeys();
      if (candidateProfile) {
        assert.ok(candidateAssets);
        verifyArtefacts(
          candidateAssets,
          '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f',
        );
      }
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
