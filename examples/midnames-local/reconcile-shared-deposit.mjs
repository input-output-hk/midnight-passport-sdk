// Reconcile one failed shared-chain deposit without replacing its original receipt.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMidnamesIndexer,
  createMidnamesLedgerReads,
} from '../../apps/passport-dapp/src/midnames/ledger-reader.ts';
import { dedicatedIndexerReadiness } from '../../scripts/qualification/indexer-readiness.mjs';
import { nativeLeasePath } from '../../scripts/qualification/native-lease.mjs';
import {
  releaseIsolationLease,
  saveIsolationReceipt,
} from '../../scripts/qualification/native-isolation-files.mjs';

const [directory, mode] = process.argv.slice(2);
assert.ok(process.env.IN_NIX_SHELL);
assert.ok(mode === undefined || mode === '--release');
const root = fileURLToPath(new URL('../..', import.meta.url));
assert.ok(directory && isAbsolute(directory) && resolve(directory) === directory);
assert.equal(dirname(directory), join(root, 'review'));
assert.match(basename(directory), /^midnames-shared-deposit-[a-z0-9-]{1,40}$/);
assert.equal(realpathSync(directory), directory);
const parent = JSON.parse(readFileSync(join(directory, 'shared-deposit.json'), 'utf8'));
const sender = JSON.parse(readFileSync(join(directory, 'sender', 'sender.json'), 'utf8'));
assert.equal(parent.status, 'FAIL');
assert.equal(parent.scope, 'shared-ledger9');
assert.equal(parent.leaseRetained, true);
assert.equal(parent.inputsUnchanged, true);
assert.equal(parent.cleanup.incomplete, false);
assert.equal(parent.leaseOwner.root, directory);
assert.equal(parent.leaseOwner.project, 'shared-ledger9-midnames-deposit');
assert.ok(parent.leasePin);
assert.equal(sender.scope, 'shared-ledger9');
assert.equal(sender.name, parent.name);
assert.equal(sender.registryAddress, parent.registryAddress);
assert.equal(sender.walletStopped, true);
assert.ok(sender.dispatches === 0 || sender.dispatches === 1);
if (sender.review) {
  assert.equal(sender.review.accountAddress, parent.accountAddress);
  assert.equal(sender.review.registryAddress, parent.registryAddress);
  assert.equal(sender.review.operation, 'deposit_shielded');
  assert.equal(sender.review.name, parent.name);
  assert.equal(sender.review.networkId, 'undeployed');
}
if (sender.reviewDecision === 'declined') assert.equal(sender.dispatches, 0);
if (sender.dispatches === 0) {
  assert.equal(sender.submissionId, undefined);
  assert.equal(sender.txHash, undefined);
}
const originalPath = join(directory, 'sender', 'deposit.private.bin');
const prepared = sender.preparedSha256 !== undefined;
assert.equal(existsSync(originalPath), prepared, 'Prepared original bytes and receipt disagree.');
assert.equal(sender.identifiers !== undefined, prepared);
if (sender.dispatches === 1) assert.equal(prepared, true);
if (!prepared) {
  assert.equal(sender.passed, undefined);
  assert.equal(sender.txHash, undefined);
}
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
let original;
let expiresAt;
let originalBytes;
if (prepared) {
  assert.match(sender.preparedSha256, /^[a-f0-9]{64}$/);
  assert.ok(Array.isArray(sender.identifiers) && sender.identifiers.length > 0);
  assert.equal(sender.reviewDecision, 'approved');
  assert.ok(sender.review);
  if (sender.submissionId !== undefined)
    assert.ok(sender.identifiers.includes(sender.submissionId));
  originalBytes = readFileSync(originalPath);
  assert.equal(sha256(originalBytes), sender.preparedSha256);
  const requireFromApp = createRequire(join(root, 'apps/passport-dapp/package.json'));
  const { Transaction } = requireFromApp('@midnightntwrk/ledger-v9');
  original = Transaction.deserialize('signature', 'proof', 'binding', originalBytes);
  assert.deepEqual(original.identifiers(), sender.identifiers);
  const ttls = [...original.intents.values()].map(({ ttl }) => ttl.getTime());
  assert.ok(ttls.length > 0 && ttls.every(Number.isSafeInteger));
  expiresAt = Math.max(...ttls);
}
const nodeUrl = 'http://127.0.0.1:9944';
const indexerUrl = 'http://127.0.0.1:8088/api/v4/graphql';
const post = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  assert.ok(response.ok);
  const value = await response.json();
  assert.equal(value.errors, undefined);
  assert.equal(value.error, undefined);
  return value;
};
const rpc = async (method, params = []) =>
  (await post(nodeUrl, { jsonrpc: '2.0', id: 1, method, params })).result;
assert.equal(
  await rpc('chain_getBlockHash', [0]),
  '0x823383ec0302be8417cfcbcc62f21df08f4047bca37aaea89e3f54b550ebae1d',
);
if (parent.finalizedBeforeHeight !== undefined) {
  assert.ok(Number.isSafeInteger(parent.finalizedBeforeHeight));
  assert.equal(
    await rpc('chain_getBlockHash', [parent.finalizedBeforeHeight]),
    '0x' + parent.finalizedBefore,
    'The original finalized chain anchor changed.',
  );
}
const before = await dedicatedIndexerReadiness({ nodeUrl, indexerUrl });
assert.ok(before.ready);
const block = (
  await post(indexerUrl, {
    query: 'query($offset:BlockOffset){block(offset:$offset){hash height timestamp}}',
    variables: { offset: { height: before.finalizedHeight } },
  })
).data.block;
assert.equal(block.hash, before.finalizedHash.replace(/^0x/, ''));
assert.equal(block.height, before.finalizedHeight);
const query =
  'query($offset:TransactionOffset!){transactions(offset:$offset){__typename protocolVersion raw hash block{hash height} ... on RegularTransaction{identifiers transactionResult{status}}}}';
const observe = async () => {
  if (!prepared) return { kind: 'preproof' };
  const observed = [];
  for (const identifier of sender.identifiers) {
    const rows = (await post(indexerUrl, { query, variables: { offset: { identifier } } })).data
      .transactions;
    assert.ok(Array.isArray(rows) && rows.length <= 1, 'Ambiguous original identifier.');
    observed.push(rows[0]);
  }
  if (observed.every((row) => row === undefined)) return { kind: 'absent' };
  assert.ok(observed.every(Boolean), 'Only some original identifiers are indexed.');
  const hash = original.transactionHash();
  for (const row of observed) {
    assert.equal(row.__typename, 'RegularTransaction');
    assert.equal(row.protocolVersion, 2001100);
    assert.equal(row.transactionResult.status, 'SUCCESS');
    assert.equal(row.hash, hash);
    assert.match(row.raw, /^(?:[a-f0-9]{2})+$/);
    assert.equal(sha256(Buffer.from(row.raw, 'hex')), sender.preparedSha256);
    assert.deepEqual(row.identifiers, sender.identifiers);
    assert.ok(row.block.height <= before.finalizedHeight);
    assert.equal(await rpc('chain_getBlockHash', [row.block.height]), '0x' + row.block.hash);
  }
  const first = observed[0];
  assert.ok(observed.every((row) => row.block.hash === first.block.hash));
  if (sender.txHash !== undefined) assert.equal(sender.txHash, hash);
  if (sender.blockHeight !== undefined) assert.equal(sender.blockHeight, first.block.height);
  return { kind: 'landed', hash, block: first.block };
};
const observed = await observe();
if (observed.kind === 'landed') assert.equal(sender.dispatches, 1);
if (observed.kind === 'absent') {
  assert.equal(sender.txHash, undefined, 'Sender recorded a finalized transaction.');
  assert.equal(sender.passed, undefined);
  assert.ok(
    block.timestamp > expiresAt,
    'Wait for finality after the longest original intent TTL.',
  );
}
const reads = createMidnamesLedgerReads(
  createMidnamesIndexer('undeployed', indexerUrl, 'ws://127.0.0.1:8088/api/v4/graphql/ws'),
  'undeployed',
  'acc-s3r1.1',
  'standalone-0.35',
);
const claim = await reads.readClaim(parent.name, {
  networkId: 'undeployed',
  namespace: 'night',
  registryAddress: parent.registryAddress,
});
assert.ok(claim && claim.target.kind === 'contract');
assert.equal(claim.target.address, parent.accountAddress);
assert.equal(claim.ownerCommitment, parent.ownerCommitment);
assert.ok(await reads.isSupportedAccount(parent.accountAddress, 'undeployed'));
const after = await dedicatedIndexerReadiness({ nodeUrl, indexerUrl });
assert.ok(after.ready && after.finalizedHeight >= before.finalizedHeight);
const again = await observe();
assert.deepEqual(again, observed, 'Original transaction outcome changed during reconciliation.');
const current = await reads.readClaim(parent.name, {
  networkId: 'undeployed',
  namespace: 'night',
  registryAddress: parent.registryAddress,
});
assert.deepEqual(current, claim, 'Name binding changed during reconciliation.');
assert.ok(await reads.isSupportedAccount(parent.accountAddress, 'undeployed'));
const status =
  observed.kind === 'preproof'
    ? 'RECONCILED_PREPROOF'
    : observed.kind === 'landed'
      ? 'RECONCILED_LANDED'
      : 'RECONCILED_REJECTED';
const result = {
  status,
  sourceReceipt: join(directory, 'shared-deposit.json'),
  ...(prepared && {
    originalHash: original.transactionHash(),
    originalIdentifiers: sender.identifiers,
    expiresAt: new Date(expiresAt).toISOString(),
  }),
  ...(observed.kind === 'landed' && {
    landedBlock: observed.block,
    senderFinalized: sender.passed === true,
  }),
  finalizedBlock: block,
  name: parent.name,
  registryAddress: parent.registryAddress,
  accountAddress: parent.accountAddress,
  originalFailurePreserved: true,
  leaseReleased: false,
};
const path = join(directory, 'reconciliation.json');
const pending = { ...result, status: 'READY_TO_RELEASE' };
const prior = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
if (prior) {
  assert.ok(
    (prior.status === result.status && prior.leaseReleased === true) ||
      (prior.status === 'READY_TO_RELEASE' && prior.leaseReleased === false),
  );
  assert.deepEqual(
    {
      ...prior,
      status: 'READY_TO_RELEASE',
      leaseReleased: false,
      finalizedBlock: pending.finalizedBlock,
    },
    pending,
  );
  if (observed.kind === 'absent') assert.ok(prior.finalizedBlock.timestamp > expiresAt);
  assert.ok(prior.finalizedBlock.height <= after.finalizedHeight);
  assert.equal(
    await rpc('chain_getBlockHash', [prior.finalizedBlock.height]),
    '0x' + prior.finalizedBlock.hash,
  );
}
const lease = nativeLeasePath();
assert.ok(existsSync(lease) || prior?.leaseReleased);
if (mode === '--release') {
  if (prior?.leaseReleased) {
    assert.ok(!existsSync(lease), 'A new native lease appeared after reconciliation.');
  } else {
    if (!prior) saveIsolationReceipt(path, pending);
    releaseIsolationLease(lease, parent.leaseOwner, true, parent.leasePin);
    result.leaseReleased = true;
    saveIsolationReceipt(path, result);
  }
}
console.log(JSON.stringify(prior?.leaseReleased ? prior : result));
