import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NightDepositInterrupted,
  sendNightByName,
  type NightSendIntent,
  type NightSendLeg,
  type NightSendRequest,
} from '../src/midnames/night-send.js';
import { createMidnamesNameService } from '../src/midnames/resolver.js';

const request: NightSendRequest = {
  requestId: 'a1234567-a123-4123-8123-a123456789ab',
  name: 'alice.night',
  networkId: 'undeployed',
  source: 'a'.repeat(64),
  bridge: 'b'.repeat(64),
  asset: 'NIGHT',
  amount: '4',
};
const target = 'c'.repeat(64);
const withdrawal = { hash: 'e'.repeat(64), identifiers: ['0'.repeat(66)] };
const deposit = { hash: 'f'.repeat(64), identifiers: ['1'.repeat(66)] };

function fixture() {
  const state = {
    address: target,
    validTarget: true,
    supportedTarget: true,
    balance: 10n,
    stopBeforeDeposit: false,
    dropDepositReply: false,
    finalized: new Set<string>(),
    beforeSign: () => {},
    duringWithdrawalProof: () => {},
    duringDepositProof: () => {},
  };
  const calls: string[] = [];
  let intent: NightSendIntent | undefined;
  const legs = new Map<string, NightSendLeg>();
  const names = createMidnamesNameService(
    { networkId: request.networkId, namespace: 'night', registryAddress: 'd'.repeat(64) },
    {
      async readTarget() {
        return state.validTarget ? { kind: 'contract', address: state.address } : { kind: 'other' };
      },
      async isSupportedAccount() {
        return true;
      },
    },
  );
  const ports = (): Parameters<typeof sendNightByName>[1] => ({
    names,
    async isSupportedRecipient() {
      return state.supportedTarget;
    },
    journal: {
      async readIntent() {
        return intent && structuredClone(intent);
      },
      async createIntent(reviewed) {
        assert.equal(intent, undefined);
        intent = structuredClone(reviewed);
      },
      async readLeg(leg) {
        return legs.get(leg);
      },
      async fenceLeg(leg, receipt) {
        assert.equal(legs.has(leg), false);
        legs.set(leg, receipt);
      },
    },
    async readSourceBalance() {
      return state.balance;
    },
    async review(reviewed) {
      assert.equal(reviewed.target, target);
      assert.deepEqual(reviewed.operations, [
        'withdraw_unshielded_with_jubjub',
        'deposit_unshielded',
      ]);
      assert.equal(reviewed.bridge, request.bridge);
      calls.push('review');
      state.beforeSign();
      return true;
    },
    async prepareWithdrawal() {
      calls.push('sign');
      state.duringWithdrawalProof();
      return {
        original: withdrawal,
        async dispatch() {
          assert.deepEqual(legs.get('withdraw'), withdrawal);
          calls.push('withdraw');
        },
      };
    },
    async prepareDeposit(_, original) {
      assert.deepEqual(original, withdrawal);
      if (state.stopBeforeDeposit) throw new Error('interrupted');
      state.duringDepositProof();
      return {
        original: deposit,
        async dispatch() {
          assert.deepEqual(legs.get('deposit'), deposit);
          calls.push('deposit');
          if (state.dropDepositReply) throw new Error('lost response');
        },
      };
    },
    async finalized(original) {
      return state.finalized.has(original.hash);
    },
  });
  return { state, ports, calls, legs };
}

test('unsupported routes, target type and insufficient balance refuse before owner approval', async () => {
  const { state, calls, ports } = fixture();
  await assert.rejects(sendNightByName({ ...request, asset: 'shielded' }, ports()), /Unsupported/);
  state.validTarget = false;
  await assert.rejects(sendNightByName(request, ports()));
  state.validTarget = true;
  state.balance = 3n;
  await assert.rejects(sendNightByName(request, ports()), /insufficient/);
  assert.deepEqual(calls, []);
});

test('repoints before owner signing and after withdrawal proof refuse the original route', async () => {
  for (const stage of ['beforeSign', 'duringWithdrawalProof'] as const) {
    const { state, calls, ports, legs } = fixture();
    state[stage] = () => {
      state.address = 'f'.repeat(64);
    };
    await assert.rejects(sendNightByName(request, ports()), /scope changed/);
    assert.deepEqual(calls, stage === 'beforeSign' ? ['review'] : ['review', 'sign']);
    assert.equal(legs.size, 0);
  }
});

test('after a withdrawal and interruption only the original deposit can continue', async () => {
  const { state, calls, ports } = fixture();
  state.finalized.add(withdrawal.hash);
  state.stopBeforeDeposit = true;
  await assert.rejects(sendNightByName(request, ports()), (error) => {
    assert.ok(error instanceof NightDepositInterrupted);
    assert.deepEqual(error.withdrawal, withdrawal);
    assert.match(String(error.cause), /interrupted/);
    return true;
  });
  state.stopBeforeDeposit = false;
  state.address = 'f'.repeat(64);
  await assert.rejects(sendNightByName(request, ports()), { name: 'NightDepositInterrupted' });
  state.address = target;
  state.duringDepositProof = () => {
    state.address = 'f'.repeat(64);
  };
  await assert.rejects(sendNightByName(request, ports()), { name: 'NightDepositInterrupted' });
  assert.deepEqual(calls, ['review', 'sign', 'withdraw']);

  state.address = target;
  state.duringDepositProof = () => {};
  state.dropDepositReply = true;
  assert.equal((await sendNightByName(request, ports())).phase, 'deposit-pending');
  assert.equal((await sendNightByName(request, ports())).phase, 'deposit-pending');
  state.finalized.add(deposit.hash);
  assert.equal((await sendNightByName(request, ports())).phase, 'completed');
  assert.deepEqual(calls, ['review', 'sign', 'withdraw', 'deposit']);
});

test('an unknown withdrawal remains original-only and cannot fund the next leg', async () => {
  const { calls, ports, legs } = fixture();
  for (let attempt = 0; attempt < 2; attempt++)
    assert.equal((await sendNightByName(request, ports())).phase, 'withdrawal-pending');
  await assert.rejects(sendNightByName({ ...request, amount: '3' }, ports()), /scope changed/);
  assert.deepEqual(calls, ['review', 'sign', 'withdraw']);
  assert.equal(legs.size, 1);
});

test('orphaned or duplicated leg receipts refuse before any owner approval', async () => {
  const { legs, ports, calls, state } = fixture();
  legs.set('deposit', deposit);
  await assert.rejects(sendNightByName(request, ports()), /journal is incomplete/);
  assert.deepEqual(calls, []);
  legs.clear();
  await sendNightByName(request, ports());
  legs.set('deposit', withdrawal);
  state.finalized.add(withdrawal.hash);
  await assert.rejects(sendNightByName(request, ports()), /distinct transactions/);
  assert.deepEqual(calls, ['review', 'sign', 'withdraw']);
});

test('a well-formed target requires an independent binding check before approval and dispatch', async () => {
  const { state, calls, ports, legs } = fixture();
  state.supportedTarget = false;
  await assert.rejects(sendNightByName(request, ports()), /not an activated, supported/);
  assert.deepEqual(calls, []);

  state.supportedTarget = true;
  state.duringWithdrawalProof = () => {
    state.supportedTarget = false;
  };
  await assert.rejects(sendNightByName(request, ports()), /not an activated, supported/);
  assert.deepEqual(calls, ['review', 'sign']);
  assert.equal(legs.size, 0);
});
