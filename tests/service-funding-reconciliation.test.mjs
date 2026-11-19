import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFileFundingStore,
  inspectFileFundingStore,
  releaseRejectedFundingReservation,
  verifyFundingCredit,
  verifyFundingRejection,
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

test('four aged node gas rejections and an unchanged complete ACC history release only the legacy request', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'passport-funding-rejected-')), 'store.json');
  const night = { ...request, color: '00'.repeat(32) };
  const store = createFileFundingStore(path);
  await store.reserve(
    night,
    { color: night.color, maxPerRequest: 10n, maxPerUtcDay: 10n },
    '2026-10-16',
  );
  await store.recordProgress(night.requestId, { stage: 'balance-observed', balanceBefore: '0' });
  await store.recordProgress(night.requestId, { stage: 'prepared', preparationTxId: 'prepare-id' });
  const pending = inspectFileFundingStore(path).entries[0];
  assert.ok(pending);
  const actions = [{ ...previous, txHash: 'aa'.repeat(32), balances: { [night.color]: '0' } }];
  const log = [0, 10, 20, 30]
    .map(
      (seconds, index) =>
        `2026-10-16 12:00:${String(seconds).padStart(2, '0')} 🚫 Rejected transaction ${String(index + 1).repeat(64)} from mempool: guaranteed execution would fail: ran out of gas budget`,
    )
    .join('\n');
  const now = Date.parse('2026-10-16T12:20:00Z');
  const evidence = verifyFundingRejection(pending, actions, log, now);
  assert.equal(evidence.rejectedHashes.length, 4);
  assert.equal(evidence.observedBalance, '0');
  assert.throws(
    () => verifyFundingRejection(pending, actions, log, Date.parse('2026-10-16T12:05:00Z')),
    /aged/,
  );
  assert.throws(
    () =>
      verifyFundingRejection(pending, actions, log.replace('ran out of gas budget', 'other'), now),
    /four aged/,
  );
  assert.throws(
    () =>
      verifyFundingRejection(
        pending,
        [...actions, { ...deposit, balances: { [night.color]: '10' } }],
        log,
        now,
      ),
    /deposit action/,
  );
  await assert.rejects(
    releaseRejectedFundingReservation(path, night.requestId, 'operator', {
      ...evidence,
      observedBalance: '1',
    }),
    /differs/,
  );
  await releaseRejectedFundingReservation(path, night.requestId, 'operator', evidence);
  const released = inspectFileFundingStore(path).entries[0]?.release;
  assert.ok(released);
  assert.equal(released.reason, 'node-rejected');
  assert.deepEqual(released.evidence, evidence);
  assert.equal(
    (
      await store.reserve(
        night,
        { color: night.color, maxPerRequest: 10n, maxPerUtcDay: 10n },
        '2026-10-16',
      )
    ).state,
    'released',
  );
});
