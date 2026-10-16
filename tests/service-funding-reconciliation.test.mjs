import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFileFundingStore,
  inspectFileFundingStore,
  verifyFundingCredit,
} from '../packages/service/dist/index.js';

const color = 'cd'.repeat(32);
const request = {
  requestId: '12345678-1234-1234-1234-123456789abc',
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: 'ef'.repeat(32),
  accountAddress: 'ab'.repeat(32),
  color,
  amount: '10',
};
const progress = { balanceBefore: '5', depositTxId: 'deposit-id', preparationTxId: 'prepare-id' };
/** @type {import('../packages/service/dist/index.js').FundingPendingRecord} */
const pending = { request, progress };
/** @type {import('../packages/service/dist/index.js').FundingContractAction} */
const previous = {
  kind: 'ContractCall',
  entryPoint: 'append_inbox_with_p256',
  txHash: '11'.repeat(32),
  identifiers: ['previous-id'],
  status: 'SUCCESS',
  balances: { [color]: '5' },
};
/** @type {import('../packages/service/dist/index.js').FundingContractAction} */
const deposit = {
  kind: 'ContractCall',
  entryPoint: 'deposit_unshielded',
  txHash: '22'.repeat(32),
  identifiers: ['deposit-id'],
  status: 'SUCCESS',
  balances: { [color]: '15' },
};

test('an exact, successful deposit action completes the original request and replays its result', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'passport-funding-reconcile-')), 'store.json');
  const policy = { color, maxPerRequest: 10n, maxPerUtcDay: 10n };
  const store = createFileFundingStore(path);
  await store.reserve(request, policy, '2026-10-16');
  await store.recordProgress(request.requestId, { stage: 'balance-observed', balanceBefore: '5' });
  await store.recordProgress(request.requestId, {
    stage: 'prepared',
    preparationTxId: 'prepare-id',
  });
  await store.recordProgress(request.requestId, { stage: 'submitted', txId: 'deposit-id' });
  const { result, evidence } = verifyFundingCredit(pending, [previous, deposit]);
  assert.deepEqual(result, {
    requestId: request.requestId,
    txId: 'deposit-id',
    preparationTxId: 'prepare-id',
    creditedBalance: '15',
  });
  await assert.rejects(
    store.completeReconciled(request.requestId, 'operator@example.org', result, {
      ...evidence,
      previousBalance: '4',
    }),
    /differs from the pending reservation/,
  );
  await store.completeReconciled(request.requestId, 'operator@example.org', result, evidence);
  assert.deepEqual(await store.reserve(request, policy, '2026-10-16'), {
    state: 'complete',
    result,
  });
  const inspection = inspectFileFundingStore(path).entries[0];
  assert.equal(inspection?.reconciliation?.actor, 'operator@example.org');
  assert.equal(inspection?.reconciliation?.txHash, deposit.txHash);
  await assert.rejects(
    store.completeReconciled(request.requestId, 'operator@example.org', result, evidence),
  );
});

test('ambiguous, failed, and non-exact actions never produce completion evidence', () => {
  /** @param {readonly import('../packages/service/dist/index.js').FundingContractAction[]} actions
   * @param {import('../packages/service/dist/index.js').FundingPendingRecord} [record] */
  const verify =
    (actions, record = pending) =>
    () =>
      verifyFundingCredit(record, actions);
  assert.throws(verify([previous]), /does not identify one/);
  assert.throws(verify([previous, deposit, deposit]), /does not identify one/);
  assert.throws(verify([deposit]), /not a successful/);
  assert.throws(verify([previous, { ...deposit, status: 'PARTIAL_SUCCESS' }]), /not a successful/);
  assert.throws(
    verify([previous, { ...deposit, entryPoint: 'withdraw_unshielded' }]),
    /not a successful/,
  );
  assert.throws(
    verify([previous, { ...deposit, balances: { [color]: '14' } }]),
    /exact reserved amount/,
  );
  assert.throws(
    verify([previous, { ...deposit, balances: { [color]: '16' } }]),
    /exact reserved amount/,
  );
  assert.throws(verify([previous, deposit], { request }), /no durable deposit/);
  assert.throws(verify([previous, deposit], { ...pending, noSubmit: true }), /no durable deposit/);
});
