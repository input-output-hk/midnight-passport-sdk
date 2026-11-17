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
assert.equal(receipt.transactions.length, 3);
assert.equal(receipt.transactions[2].status, 'submission-unknown');
assert.ok(receipt.leasePin);
const prepared = openClaimDispatch(directory).preparedReceipt();
assert.ok(prepared);
assert.deepEqual(JSON.parse(readFileSync(join(directory, 'claim-dispatch-fence.json'))), prepared);
assert.equal(prepared.name, receipt.name);
assert.equal(prepared.registryAddress, receipt.registryAddress);
assert.equal(prepared.accountAddress, receipt.accountAddress);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireFromApp = createRequire(join(root, 'apps/passport-dapp/package.json'));
const { Transaction } = requireFromApp('@midnightntwrk/ledger-v9');
const bytes = readFileSync(join(directory, 'tx-3.private.bin'));
assert.equal(sha256(bytes), receipt.transactions[2].sha256);
assert.equal(sha256(bytes), prepared.transaction.sha256);
const tx = Transaction.deserialize('signature', 'proof', 'binding', bytes);
assert.deepEqual(tx.identifiers(), prepared.transaction.identifiers);
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
assert.ok(block.timestamp > expiresAt, 'Wait for a canonical finalized block after claim expiry.');
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
assert.equal(await readClaimFinality(indexerUrl, prepared, fetch, 2001100), false);
for (const identifier of prepared.transaction.identifiers)
  assert.deepEqual(await transactionRows(identifier), []);
const after = await dedicatedIndexerReadiness({ nodeUrl, indexerUrl });
assert.ok(after.ready && after.finalizedHeight >= finality.finalizedHeight);
assert.equal(await readClaimFinality(indexerUrl, prepared, fetch, 2001100), false);
const lease = nativeLeasePath();
const result = {
  status: 'RECONCILED_REJECTED',
  sourceReceipt: join(directory, 'shared-claim.json'),
  claimHash: tx.transactionHash(),
  claimIdentifiers: prepared.transaction.identifiers,
  expiresAt: new Date(expiresAt).toISOString(),
  finalizedBlock: block,
  funding,
  claimIndexed: false,
  originalFailurePreserved: true,
  leaseReleased: false,
};
const path = join(directory, 'reconciliation.json');
const pending = { ...result, status: 'READY_TO_RELEASE' };
const prior = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
if (prior) assert.deepEqual(prior, pending, 'Prior reconciliation differs.');
assert.ok(existsSync(lease) || (mode === '--release' && prior));
if (mode === '--release') {
  if (!prior) saveIsolationReceipt(path, pending);
  if (existsSync(lease)) releaseIsolationLease(lease, receipt.leaseOwner, true, receipt.leasePin);
  result.leaseReleased = true;
  saveIsolationReceipt(path, result);
}
console.log(JSON.stringify(result));
