// Reconcile a rejected root-assisted issuance or a finalized create with a rejected transfer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedicatedIndexerReadiness } from '../../scripts/qualification/indexer-readiness.mjs';
import { nativeLeasePath } from '../../scripts/qualification/native-lease.mjs';
import {
  releaseIsolationLease,
  saveIsolationReceipt,
} from '../../scripts/qualification/native-isolation-files.mjs';
import {
  createMidnamesIndexer,
  createMidnamesLedgerReads,
} from '../../apps/passport-dapp/src/midnames/ledger-reader.ts';

const [directory, mode] = process.argv.slice(2);
assert.ok(process.env.IN_NIX_SHELL);
assert.ok(mode === undefined || mode === '--release');
const root = fileURLToPath(new URL('../..', import.meta.url));
assert.ok(directory && isAbsolute(directory) && resolve(directory) === directory);
assert.equal(dirname(directory), join(root, 'review'));
assert.match(basename(directory), /^midnames-admin-name-[a-z0-9-]{1,40}$/);
assert.equal(realpathSync(directory), directory);
const receipt = JSON.parse(readFileSync(join(directory, 'admin-name.json'), 'utf8'));
assert.equal(receipt.status, 'FAIL');
assert.equal(receipt.leaseRetained, true);
assert.equal(receipt.walletStopped, true);
assert.equal(receipt.inputsUnchanged, true);
assert.equal(receipt.leaseOwner.project, 'shared-ledger9-midnames-admin-name');
assert.equal(receipt.leaseOwner.root, directory);
assert.ok(receipt.transactions.length === 1 || receipt.transactions.length === 2);
const partial = receipt.transactions.length === 2;
const created = partial ? receipt.transactions[0] : undefined;
const original = receipt.transactions.at(-1);
assert.ok(original);
assert.equal(original.ordinal, partial ? 2 : 1);
assert.equal(original.operation, partial ? 'transfer_domain' : 'create_domain');
assert.equal(original.status, 'submission-unknown');
if (partial) {
  assert.equal(created.ordinal, 1);
  assert.equal(created.operation, 'create_domain');
  assert.equal(created.status, 'finalized-success');
  assert.ok(created.block && Number.isSafeInteger(created.block.height));
}
assert.ok(receipt.leasePin);
const bytes = readFileSync(join(directory, `admin-tx-${original.ordinal}.private.bin`));
const sha256 = (data) => createHash('sha256').update(data).digest('hex');
assert.equal(sha256(bytes), original.sha256);
const requireFromApp = createRequire(join(root, 'apps/passport-dapp/package.json'));
const { Transaction } = requireFromApp('@midnightntwrk/ledger-v9');
const tx = Transaction.deserialize('signature', 'proof', 'binding', bytes);
assert.equal(tx.transactionHash(), original.hash);
assert.deepEqual(tx.identifiers(), original.identifiers);
const ttls = [...tx.intents.values()].map(({ ttl }) => ttl.getTime());
assert.ok(ttls.length > 0 && ttls.every(Number.isSafeInteger));
const expiresAt = Math.min(...ttls);
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
  assert.equal(value.error, undefined);
  assert.equal(value.errors, undefined);
  return value;
};
const rpc = async (method, params = []) =>
  (await post(nodeUrl, { jsonrpc: '2.0', id: 1, method, params })).result;
assert.equal(
  await rpc('chain_getBlockHash', [0]),
  '0x823383ec0302be8417cfcbcc62f21df08f4047bca37aaea89e3f54b550ebae1d',
);
const before = await dedicatedIndexerReadiness({ nodeUrl, indexerUrl });
assert.ok(before.ready);
const block = (
  await post(indexerUrl, {
    query: 'query($offset:BlockOffset){block(offset:$offset){hash height timestamp}}',
    variables: { offset: { height: before.finalizedHeight } },
  })
).data.block;
assert.equal(block.height, before.finalizedHeight);
assert.equal(block.hash, before.finalizedHash.replace(/^0x/, ''));
assert.ok(block.timestamp > expiresAt, 'Wait for finalized expiry.');
const query =
  'query($offset:TransactionOffset!){transactions(offset:$offset){__typename hash protocolVersion raw ... on RegularTransaction {identifiers transactionResult{status} block{hash height}}}}';
if (created) {
  const createdBytes = readFileSync(join(directory, 'admin-tx-1.private.bin'));
  assert.equal(sha256(createdBytes), created.sha256);
  const createdTx = Transaction.deserialize('signature', 'proof', 'binding', createdBytes);
  assert.equal(createdTx.transactionHash(), created.hash);
  assert.deepEqual(createdTx.identifiers(), created.identifiers);
  for (const identifier of created.identifiers) {
    const { data } = await post(indexerUrl, {
      query,
      variables: { offset: { identifier } },
    });
    assert.equal(data.transactions.length, 1);
    const [row] = data.transactions;
    assert.equal(row.__typename, 'RegularTransaction');
    assert.equal(row.protocolVersion, 2001100);
    assert.equal(row.hash, created.hash);
    assert.equal(sha256(Buffer.from(row.raw, 'hex')), created.sha256);
    assert.deepEqual(row.identifiers, created.identifiers);
    assert.equal(row.transactionResult.status, 'SUCCESS');
    assert.deepEqual(row.block, created.block);
    assert.ok(row.block.height <= before.finalizedHeight);
    assert.equal(await rpc('chain_getBlockHash', [row.block.height]), '0x' + row.block.hash);
  }
}
for (const identifier of original.identifiers) {
  const result = await post(indexerUrl, {
    query,
    variables: { offset: { identifier } },
  });
  assert.deepEqual(result.data.transactions, []);
}
const reads = createMidnamesLedgerReads(
  createMidnamesIndexer('undeployed', indexerUrl, 'ws://127.0.0.1:8088/api/v4/graphql/ws'),
  'undeployed',
  'acc-s3r1.1',
  'standalone-0.35',
);
const indexedName = await reads.readClaim(receipt.name, {
  networkId: 'undeployed',
  namespace: 'night',
  registryAddress: receipt.registryAddress,
});
if (partial)
  assert.deepEqual(indexedName, {
    ownerCommitment: receipt.rootCommitment,
    target: { kind: 'contract', address: receipt.accountAddress },
  });
else assert.equal(indexedName, undefined);
const after = await dedicatedIndexerReadiness({ nodeUrl, indexerUrl });
assert.ok(after.ready && after.finalizedHeight >= before.finalizedHeight);
for (const identifier of original.identifiers) {
  const result = await post(indexerUrl, {
    query,
    variables: { offset: { identifier } },
  });
  assert.deepEqual(result.data.transactions, []);
}
const result = {
  status: partial ? 'RECONCILED_PARTIAL' : 'RECONCILED_REJECTED',
  sourceReceipt: join(directory, 'admin-name.json'),
  originalHash: original.hash,
  originalIdentifiers: original.identifiers,
  expiresAt: new Date(expiresAt).toISOString(),
  finalizedBlock: block,
  nameIndexed: partial,
  ...(partial && { createdHash: created.hash, createdBlock: created.block }),
  originalFailurePreserved: true,
  leaseReleased: false,
};
const path = join(directory, 'reconciliation.json');
const pending = { ...result, status: 'READY_TO_RELEASE' };
const prior = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
if (prior) {
  const released = prior.status === result.status && prior.leaseReleased === true;
  assert.ok(released || (prior.status === 'READY_TO_RELEASE' && prior.leaseReleased === false));
  assert.deepEqual(
    {
      ...prior,
      status: 'READY_TO_RELEASE',
      leaseReleased: false,
      finalizedBlock: pending.finalizedBlock,
    },
    pending,
  );
  assert.ok(prior.finalizedBlock.timestamp > expiresAt);
  assert.ok(prior.finalizedBlock.height <= after.finalizedHeight);
  assert.equal(
    await rpc('chain_getBlockHash', [prior.finalizedBlock.height]),
    '0x' + prior.finalizedBlock.hash,
  );
}
const lease = nativeLeasePath();
assert.ok(existsSync(lease) || (prior && prior.leaseReleased));
if (mode === '--release') {
  if (!prior) saveIsolationReceipt(path, pending);
  if (existsSync(lease)) {
    releaseIsolationLease(lease, receipt.leaseOwner, true, receipt.leasePin);
    result.leaseReleased = true;
  } else {
    result.status = 'RECONCILED_LEASE_ALREADY_ABSENT';
    result.leaseAlreadyAbsent = true;
  }
  saveIsolationReceipt(path, result);
}
console.log(JSON.stringify(result));
