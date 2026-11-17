// One independent sender deposits a synthetic shielded asset to an existing named ACC.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statfsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claimName } from '../../apps/passport-dapp/src/midnames/claim-receipt.ts';
import {
  createMidnamesIndexer,
  createMidnamesLedgerReads,
} from '../../apps/passport-dapp/src/midnames/ledger-reader.ts';
import { dedicatedIndexerReadiness } from '../../scripts/qualification/indexer-readiness.mjs';
import { isolatedInputs } from '../../scripts/qualification/native-isolation-inputs.mjs';
import {
  claimIsolationLease,
  releaseIsolationLease,
  saveIsolationReceipt,
} from '../../scripts/qualification/native-isolation-files.mjs';
import { nativeLeasePath } from '../../scripts/qualification/native-lease.mjs';
import {
  isolatedProcesses,
  isolationDeadline,
} from '../../scripts/qualification/native-isolation-control.mjs';
import { verifyPreparedRegistry } from './verify-prepared.mjs';

const [output, prepared, reference, registryAddress, accountAddress, name] = process.argv.slice(2);
assert.ok(process.env.IN_NIX_SHELL && process.env.COMPACT_DIRECTORY);
assert.equal(process.env.PASSPORT_MIDNAMES_SHARED_DEPOSIT, '1');
assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
assert.equal(process.env.MIDNIGHT_NETWORK, 'local');
assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
assert.equal(process.env.MN_NODE_URL, 'http://127.0.0.1:9944');
assert.equal(process.env.MN_INDEXER_URL, 'http://127.0.0.1:8088/api/v4/graphql');
assert.equal(process.env.MN_INDEXER_WS_URL, 'ws://127.0.0.1:8088/api/v4/graphql/ws');
assert.equal(process.env.MN_PROOF_SERVER_URL, 'http://127.0.0.1:16320');
assert.equal(process.env.PASSPORT_MIDNAMES_APPROVED_NAME, name);
assert.ok(claimName(name));
for (const address of [registryAddress, accountAddress])
  assert.match(address ?? '', /^[a-f0-9]{64}$/);
const root = fileURLToPath(new URL('../..', import.meta.url));
const review = join(root, 'review');
mkdirSync(review, { recursive: true, mode: 0o700 });
assert.equal(realpathSync(review), review);
for (const path of [output, prepared, reference])
  assert.ok(path && isAbsolute(path) && resolve(path) === path);
assert.equal(dirname(output), review);
assert.match(basename(output), /^midnames-shared-deposit-[a-z0-9-]{1,40}$/);
assert.ok(!existsSync(output), 'Choose a fresh receipt directory.');
const disk = statfsSync(root);
assert.ok(BigInt(disk.bavail) * BigInt(disk.bsize) >= 15n * 1024n ** 3n);
assert.equal(
  execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  '',
  'Commit and verify source before a native deposit.',
);
assert.equal(
  execFileSync('git', ['log', '-1', '--format=%G?'], { cwd: root, encoding: 'utf8' }).trim(),
  'G',
);
const lease = nativeLeasePath();
assert.ok(!existsSync(lease), 'Reconcile the occupied native lease first.');
const endpoints = {
  nodeUrl: process.env.MN_NODE_URL,
  indexerUrl: process.env.MN_INDEXER_URL,
};
const initial = await dedicatedIndexerReadiness(endpoints);
assert.ok(initial.ready, 'Shared node and v4 indexer do not agree at finality.');
const rpc = async (method, params = []) => {
  const response = await fetch(endpoints.nodeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
  assert.ok(response.ok);
  const value = await response.json();
  assert.equal(value.error, undefined);
  return value.result;
};
assert.equal(
  await rpc('chain_getBlockHash', [0]),
  '0x823383ec0302be8417cfcbcc62f21df08f4047bca37aaea89e3f54b550ebae1d',
);
const proofVersion = await fetch(process.env.MN_PROOF_SERVER_URL + '/version', {
  signal: AbortSignal.timeout(5_000),
}).then((response) => response.text());
assert.equal(proofVersion, '9.0.0-rc.8');
await verifyPreparedRegistry(prepared);
const indexer = createMidnamesIndexer(
  'undeployed',
  process.env.MN_INDEXER_URL,
  process.env.MN_INDEXER_WS_URL,
);
const reads = createMidnamesLedgerReads(indexer, 'undeployed', 'acc-s3r1.1', 'standalone-0.35');
const profile = { networkId: 'undeployed', namespace: 'night', registryAddress };
const claim = await reads.readClaim(name, profile);
assert.ok(claim && claim.target.kind === 'contract');
assert.equal(claim.target.address, accountAddress);
assert.ok(await reads.isSupportedAccount(accountAddress, 'undeployed'));

mkdirSync(output, { mode: 0o700 });
assert.equal(lstatSync(output).mode & 0o077, 0);
const owner = {
  runId: randomBytes(8).toString('hex'),
  pid: process.pid,
  project: 'shared-ledger9-midnames-deposit',
  root: output,
};
const receipt = {
  status: 'RUNNING',
  scope: 'shared-ledger9',
  name,
  registryAddress,
  accountAddress,
  ownerCommitment: claim.ownerCommitment,
  finalizedBefore: initial.finalizedHash,
  proofVersion,
  preparedManifestSha256: createHash('sha256')
    .update(readFileSync(join(prepared, 'prepared.json')))
    .digest('hex'),
  leaseOwner: owner,
};
const save = () => saveIsolationReceipt(join(output, 'shared-deposit.json'), receipt);
save();
const deadline = isolationDeadline(performance.now());
const processes = isolatedProcesses();
let pin;
let inputs;
let passed = false;
let claimed = false;
const interrupt = () => deadline.abort('Shared named deposit interrupted');
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
try {
  claimIsolationLease(lease, owner);
  claimed = true;
  const stat = lstatSync(lease);
  pin = {
    dev: stat.dev,
    ino: stat.ino,
    sha256: createHash('sha256').update(readFileSync(lease)).digest('hex'),
  };
  receipt.leasePin = pin;
  save();
  inputs = await isolatedInputs(root, reference, deadline.check);
  receipt.source = inputs.frozen.source;
  save();
  const child = spawn(
    process.execPath,
    [
      '--experimental-import-meta-resolve',
      '--import',
      'tsx',
      join(import.meta.dirname, 'deposit-sender.mjs'),
      output,
      reference,
      registryAddress,
      name,
    ],
    {
      cwd: join(root, 'apps/passport-dapp'),
      env: { ...process.env, PASSPORT_MIDNAMES_BROWSER_REVIEW: '1' },
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  );
  processes.register(child);
  receipt.senderPid = child.pid;
  save();
  const exit = await Promise.race([
    new Promise((resolve, reject) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      child.once('error', reject);
    }),
    deadline.aborted,
  ]);
  assert.deepEqual(exit, { code: 0, signal: null });
  const sender = JSON.parse(readFileSync(join(output, 'sender', 'sender.json'), 'utf8'));
  assert.equal(sender.passed, true);
  assert.equal(sender.walletStopped, true);
  assert.equal(sender.scope, 'shared-ledger9');
  assert.equal(sender.review.accountAddress, accountAddress);
  assert.equal(sender.review.registryAddress, registryAddress);
  assert.equal(sender.review.operation, 'deposit_shielded');
  assert.equal(sender.dispatches, 1);
  assert.match(sender.txHash, /^[a-f0-9]{64}$/);
  assert.equal(sender.browserReview.approved, true);
  assert.equal(sender.browserReview.displayed, true);
  const current = await reads.readClaim(name, profile);
  assert.deepEqual(current, claim, 'Name binding changed during the sender run.');
  const final = await dedicatedIndexerReadiness(endpoints);
  assert.ok(final.ready && final.finalizedHeight >= sender.blockHeight);
  receipt.sender = {
    txHash: sender.txHash,
    identifiers: sender.identifiers,
    blockHeight: sender.blockHeight,
    inboxIndex: sender.inboxIndex,
    review: sender.review,
    browserReview: sender.browserReview,
    dispatches: sender.dispatches,
    walletStopped: sender.walletStopped,
  };
  receipt.finalizedAfter = final.finalizedHash;
  receipt.status = 'SENDER_PASS';
  passed = true;
} catch (error) {
  receipt.status = 'FAIL';
  receipt.error = String(error);
  console.error(error);
} finally {
  deadline.abort('Shared named deposit finalizing');
  receipt.cleanup = await processes.stop(10_000);
  try {
    if (inputs) {
      await inputs.verify(() => assert.ok(deadline.cleanupRemaining() > 0));
      await verifyPreparedRegistry(prepared);
      receipt.inputsUnchanged = true;
    }
  } catch (error) {
    receipt.status = 'FAIL';
    receipt.verificationError = String(error);
  }
  try {
    if (claimed && passed && receipt.status === 'SENDER_PASS' && !receipt.cleanup.incomplete) {
      releaseIsolationLease(lease, owner, true, pin);
      receipt.leaseReleased = true;
    } else if (claimed) receipt.leaseRetained = true;
  } catch (error) {
    receipt.status = 'FAIL';
    receipt.leaseError = String(error);
    receipt.leaseRetained = true;
  }
  deadline.clear();
  save();
}
assert.equal(receipt.status, 'SENDER_PASS');
