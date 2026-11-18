import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyMeasuredNightDepositCall } from '../src/measured-night-deposit.ts';

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
