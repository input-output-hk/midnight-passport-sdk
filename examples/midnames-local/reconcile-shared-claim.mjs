// Read-only reconciliation of one failed shared-chain claim. --release clears only its pinned lease.
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
import { readClaimFinality } from '../../apps/passport-dapp/src/midnames/claim-finality.ts';
import {
  createMidnamesIndexer,
  createMidnamesLedgerReads,
} from '../../apps/passport-dapp/src/midnames/ledger-reader.ts';
import { openClaimDispatch } from './claim-dispatch.mts';

const [directory, mode] = process.argv.slice(2);
assert.ok(process.env.IN_NIX_SHELL, 'Use the pinned Nix shell.');
assert.ok(mode === undefined || mode === '--release');
const root = fileURLToPath(new URL('../..', import.meta.url));
assert.ok(directory && isAbsolute(directory) && resolve(directory) === directory);
assert.equal(dirname(directory), join(root, 'review'));
assert.match(basename(directory), /^midnames-shared-claim-[a-z0-9-]{1,40}$/);
assert.equal(realpathSync(directory), directory);
const receipt = JSON.parse(readFileSync(join(directory, 'shared-claim.json'), 'utf8'));
assert.equal(receipt.status, 'FAIL');
assert.equal(receipt.leaseRetained, true);
assert.equal(receipt.walletStopped, true);
assert.equal(receipt.inputsUnchanged, true);
assert.equal(receipt.networkId, 'undeployed');
assert.equal(receipt.leaseOwner.root, directory);
assert.equal(receipt.leaseOwner.project, 'shared-ledger9-midnames-claim');
assert.ok(receipt.transactions.length === 2 || receipt.transactions.length === 3);
const preproof = receipt.transactions.length === 2;
if (preproof) {
  assert.ok(receipt.steps.some((step) => step.name === 'prove-claim-in-owner-process'));
  assert.ok(!receipt.steps.some((step) => step.name === 'dispatch-exact-original'));
  assert.ok(!existsSync(join(directory, 'tx-3.private.bin')));
  assert.ok(!existsSync(join(directory, 'claim-prepared.private.json')));
  assert.ok(!existsSync(join(directory, 'claim-dispatch-fence.json')));
} else assert.equal(receipt.transactions[2].status, 'submission-unknown');
assert.ok(receipt.leasePin);
const prepared = preproof ? undefined : openClaimDispatch(directory).preparedReceipt();
if (!preproof) {
  assert.ok(prepared);
  assert.deepEqual(
    JSON.parse(readFileSync(join(directory, 'claim-dispatch-fence.json'))),
    prepared,
  );
  assert.equal(prepared.name, receipt.name);
  assert.equal(prepared.registryAddress, receipt.registryAddress);
  assert.equal(prepared.accountAddress, receipt.accountAddress);
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireFromApp = createRequire(join(root, 'apps/passport-dapp/package.json'));
const { Transaction } = requireFromApp('@midnightntwrk/ledger-v9');
let tx;
let expiresAt;
if (!preproof) {
  const bytes = readFileSync(join(directory, 'tx-3.private.bin'));
  assert.equal(sha256(bytes), receipt.transactions[2].sha256);
  assert.equal(sha256(bytes), prepared.transaction.sha256);
  tx = Transaction.deserialize('signature', 'proof', 'binding', bytes);
  assert.deepEqual(tx.identifiers(), prepared.transaction.identifiers);
  const ttls = [...tx.intents.values()].map(({ ttl }) => ttl.getTime());
  assert.ok(ttls.length > 0 && ttls.every(Number.isSafeInteger));
  expiresAt = Math.min(...ttls);
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
const finality = await dedicatedIndexerReadiness({ nodeUrl, indexerUrl });
assert.ok(finality.ready);
const block = (
  await post(indexerUrl, {
    query: 'query($offset:BlockOffset){block(offset:$offset){hash height timestamp}}',
    variables: { offset: { height: finality.finalizedHeight } },
  })
).data.block;
assert.equal(block.hash, finality.finalizedHash.replace(/^0x/, ''));
assert.equal(block.height, finality.finalizedHeight);
if (!preproof)
  assert.ok(
    block.timestamp > expiresAt,
    'Wait for a canonical finalized block after claim expiry.',
  );
const query =
  'query($offset:TransactionOffset!){transactions(offset:$offset){__typename hash protocolVersion raw ... on RegularTransaction {identifiers transactionResult{status} block{hash height}}}}';
const transactionRows = async (identifier) =>
  (
    await post(indexerUrl, {
      query,
      variables: { offset: { identifier } },
    })
  ).data.transactions;
const funding = [];
for (const row of receipt.transactions.slice(0, 2)) {
  assert.equal(row.status, 'submitted');
  const rows = await transactionRows(row.id);
  assert.equal(rows.length, 1);
  const indexed = rows[0];
  assert.equal(indexed.__typename, 'RegularTransaction');
  assert.equal(indexed.protocolVersion, 2001100);
  assert.equal(indexed.transactionResult.status, 'SUCCESS');
  assert.ok(indexed.identifiers.includes(row.id));
  assert.equal(sha256(Buffer.from(indexed.raw, 'hex')), row.sha256);
  assert.equal(
    indexed.hash,
    Transaction.deserialize(
      'signature',
      'proof',
      'binding',
      Buffer.from(indexed.raw, 'hex'),
    ).transactionHash(),
  );
  assert.ok(indexed.block.height <= finality.finalizedHeight);
  assert.equal(await rpc('chain_getBlockHash', [indexed.block.height]), '0x' + indexed.block.hash);
  funding.push({ id: row.id, block: indexed.block });
}
if (preproof) {
  const reads = createMidnamesLedgerReads(
    createMidnamesIndexer('undeployed', indexerUrl, 'ws://127.0.0.1:8088/api/v4/graphql/ws'),
    'undeployed',
    'acc-s3r1.1',
    'standalone-0.35',
  );
  assert.equal(
    await reads.readClaim(receipt.name, {
      networkId: 'undeployed',
      namespace: 'night',
      registryAddress: receipt.registryAddress,
    }),
    undefined,
  );
} else {
  assert.equal(await readClaimFinality(indexerUrl, prepared, fetch, 2001100), false);
  for (const identifier of prepared.transaction.identifiers)
    assert.deepEqual(await transactionRows(identifier), []);
}
const after = await dedicatedIndexerReadiness({ nodeUrl, indexerUrl });
assert.ok(after.ready && after.finalizedHeight >= finality.finalizedHeight);
if (!preproof) assert.equal(await readClaimFinality(indexerUrl, prepared, fetch, 2001100), false);
const lease = nativeLeasePath();
const result = {
  status: preproof ? 'RECONCILED_PREPROOF' : 'RECONCILED_REJECTED',
  sourceReceipt: join(directory, 'shared-claim.json'),
  ...(preproof
    ? { claimPrepared: false }
    : {
        claimHash: tx.transactionHash(),
        claimIdentifiers: prepared.transaction.identifiers,
        expiresAt: new Date(expiresAt).toISOString(),
      }),
  finalizedBlock: block,
  funding,
  claimIndexed: false,
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
    'Prior reconciliation differs.',
  );
  if (!preproof) assert.ok(prior.finalizedBlock.timestamp > expiresAt);
  assert.ok(prior.finalizedBlock.height <= after.finalizedHeight);
  assert.equal(
    await rpc('chain_getBlockHash', [prior.finalizedBlock.height]),
    '0x' + prior.finalizedBlock.hash,
  );
}
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
