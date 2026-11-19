import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  submitMeasuredNightDepositAfterPreparation,
  verifyMeasuredNightDepositCall,
} from '../src/measured-night-deposit.ts';

const target = 'ab'.repeat(32);

// A wallet provider can return the same ledger action from a second WASM instance.
class ContractCall {
  constructor(
    readonly address: string,
    readonly entryPoint: string | Uint8Array,
  ) {}
}

test('accepts the pinned call across ledger WASM class instances', () => {
  assert.doesNotThrow(() =>
    verifyMeasuredNightDepositCall([new ContractCall(target, 'deposit_unshielded')], target),
  );
  assert.doesNotThrow(() =>
    verifyMeasuredNightDepositCall(
      [new ContractCall(target, new TextEncoder().encode('deposit_unshielded'))],
      target,
    ),
  );
});

test('refuses changed targets, circuits, action types, and extra calls', () => {
  for (const actions of [
    [],
    [new ContractCall('cd'.repeat(32), 'deposit_unshielded')],
    [new ContractCall(target, 'withdraw_unshielded')],
    [
      new ContractCall(target, 'deposit_unshielded'),
      new ContractCall(target, 'deposit_unshielded'),
    ],
    [{ address: target, entryPoint: 'deposit_unshielded' }],
  ])
    assert.throws(
      () => verifyMeasuredNightDepositCall(actions, target),
      /pinned NIGHT deposit call/,
    );
});

test('proof or balance failure records no ACC submission only before the send fence', async () => {
  const events: string[] = [];
  await assert.rejects(
    submitMeasuredNightDepositAfterPreparation(
      async () => {
        events.push('prepare');
        throw new Error('proof failed');
      },
      async () => {
        events.push('submit');
      },
      async (progress) => {
        events.push(progress.stage);
      },
    ),
    /proof failed/,
  );
  assert.deepEqual(events, ['prepare', 'acc-not-submitted']);
});

test('a failed no-ACC marker leaves the original request uncertain', async () => {
  let submitted = false;
  await assert.rejects(
    submitMeasuredNightDepositAfterPreparation(
      async () => {
        throw new Error('balance failed');
      },
      async () => {
        submitted = true;
      },
      async () => {
        throw new Error('marker write failed');
      },
    ),
    /marker write failed/,
  );
  assert.equal(submitted, false);
});

test('a failed final-hash fence never reaches the ACC submitter', async () => {
  const events: string[] = [];
  await assert.rejects(
    submitMeasuredNightDepositAfterPreparation(
      async () => ({ tx: 'balanced', txId: 'exact-hash' }),
      async () => {
        events.push('submit');
      },
      async (progress) => {
        events.push(progress.stage);
        throw new Error('fence write failed');
      },
    ),
    /fence write failed/,
  );
  assert.deepEqual(events, ['submitted']);
});

test('submit failure and lost response retain the exact recorded hash', async () => {
  const events: string[] = [];
  await assert.rejects(
    submitMeasuredNightDepositAfterPreparation(
      async () => ({ tx: 'balanced', txId: 'exact-hash' }),
      async () => {
        events.push('submit');
        throw new Error('node response lost');
      },
      async (progress) => {
        events.push(`${progress.stage}:${'txId' in progress ? progress.txId : ''}`);
      },
    ),
    /node response lost/,
  );
  assert.deepEqual(events, ['submitted:exact-hash', 'submit']);
});

test('success sends only after the final hash is recorded', async () => {
  const events: string[] = [];
  assert.deepEqual(
    await submitMeasuredNightDepositAfterPreparation(
      async () => ({ tx: 'balanced', txId: 'exact-hash' }),
      async (tx) => {
        events.push(`submit:${tx}`);
      },
      async (progress) => {
        events.push(`${progress.stage}:${'txId' in progress ? progress.txId : ''}`);
      },
    ),
    { txId: 'exact-hash' },
  );
  assert.deepEqual(events, ['submitted:exact-hash', 'submit:balanced']);
});
