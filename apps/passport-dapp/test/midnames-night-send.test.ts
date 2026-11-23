import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NightDepositInterrupted,
  NightPaymentDeclined,
  NightSendPreflightError,
  sendNightByName,
  type NightSendIntent,
  type NightSendLeg,
  type NightSendRequest,
  type NightUnresolvedObservation,
} from '../src/midnames/night-send.js';
import { createMidnamesNameService } from '../src/midnames/resolver.js';
import type { PreparedValueSubmission } from '@input-output-hk/mn-passport-protocol';

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
    balance: 10n as bigint | undefined,
    absent: false,
    outage: false,
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
  const recoveryRecords: {
    original: NightSendIntent;
    current: NightSendIntent | NightUnresolvedObservation;
    withdrawal: NightSendLeg;
  }[] = [];
  const names = createMidnamesNameService(
    { networkId: request.networkId, namespace: 'night', registryAddress: 'd'.repeat(64) },
    {
      async readTarget() {
        if (state.outage) throw new Error('indexer unavailable');
        if (state.absent) return undefined;
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
      async recordRecoveryReview(original, current, saved) {
        assert.deepEqual(legs.get('withdraw'), saved);
        assert.equal(legs.has('deposit'), false);
        recoveryRecords.push({ original, current, withdrawal: saved });
        calls.push('recovery-record');
      },
    },
    async readSourceBalance() {
      return state.balance;
    },
    async review(reviewed, observedBalance) {
      assert.equal(observedBalance, state.balance);
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
  return { state, ports, calls, legs, recoveryRecords };
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

test('a provider default address cannot authorize a contract-call payment', async () => {
  const { calls, legs, ports } = fixture();
  const unclassified = {
    provider: { id: 'midnames:' + 'd'.repeat(64), namespace: 'night', mode: 'external' as const },
    async resolve(query: { name: string; networkId: string }) {
      return { ...query, namespace: 'night', accountAddress: target };
    },
  };
  await assert.rejects(sendNightByName(request, { ...ports(), names: unclassified }), {
    code: 'InvalidRecord',
  });
  assert.deepEqual(calls, []);
  assert.equal(legs.size, 0);
});

test('preflight refusals have distinct public codes without owner approval or dispatch', async () => {
  const { state, calls, ports, legs } = fixture();
  const refused = async (input: NightSendRequest, code: NightSendPreflightError['code']) => {
    await assert.rejects(sendNightByName(input, ports()), (error) => {
      assert.ok(error instanceof NightSendPreflightError);
      assert.equal(error.code, code);
      return true;
    });
  };
  await refused({ ...request, asset: 'shielded' }, 'NightUnsupportedRoute');
  state.absent = true;
  await refused(request, 'NightNameUnavailable');
  state.absent = false;
  state.address = request.source;
  await refused(request, 'NightSelfRecipient');
  state.address = target;
  state.supportedTarget = false;
  await refused(request, 'NightRecipientUnsupported');
  state.supportedTarget = true;
  state.balance = undefined;
  await refused(request, 'NightSourceUnsupported');
  state.balance = 3n;
  await refused(request, 'NightInsufficientBalance');
  assert.deepEqual(calls, []);
  assert.equal(legs.size, 0);
});

test('an operator decline is typed and cannot sign or dispatch either leg', async () => {
  const { calls, ports, legs } = fixture();
  await assert.rejects(
    sendNightByName(request, {
      ...ports(),
      async review() {
        calls.push('review');
        return false;
      },
    }),
    NightPaymentDeclined,
  );
  assert.deepEqual(calls, ['review']);
  assert.equal(legs.size, 0);
});

test('repoints before owner signing and after withdrawal proof refuse the original route', async () => {
  for (const stage of ['beforeSign', 'duringWithdrawalProof'] as const) {
    const { state, calls, ports, legs } = fixture();
    state[stage] = () => {
      state.address = 'f'.repeat(64);
    };
    await assert.rejects(
      sendNightByName(request, ports()),
      stage === 'beforeSign'
        ? (error: unknown) =>
            error instanceof NightSendPreflightError && error.code === 'NightNameChanged'
        : /scope changed/,
    );
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

test('a repointed name needs a fresh review to finish only the saved original deposit', async () => {
  const { state, calls, ports, legs, recoveryRecords } = fixture();
  state.finalized.add(withdrawal.hash);
  state.stopBeforeDeposit = true;
  await assert.rejects(sendNightByName(request, ports()), NightDepositInterrupted);
  state.stopBeforeDeposit = false;
  state.address = 'd'.repeat(64);
  let recoveryReviews = 0;
  const recovery = {
    ...ports(),
    async reviewOriginalDeposit(
      original: NightSendIntent,
      current: NightSendIntent,
      saved: NightSendLeg,
    ) {
      recoveryReviews++;
      assert.equal(original.target, target);
      assert.equal(current.target, state.address);
      assert.deepEqual(saved, withdrawal);
      calls.push('recovery-review');
      return recoveryReviews > 1;
    },
  };
  await assert.rejects(sendNightByName(request, recovery), NightDepositInterrupted);
  assert.equal(legs.has('deposit'), false);
  state.duringDepositProof = () => {
    state.address = 'e'.repeat(64);
  };
  await assert.rejects(sendNightByName(request, recovery), (error) => {
    assert.ok(error instanceof NightDepositInterrupted);
    assert.match(error.message, /name changed during deposit recovery/i);
    return true;
  });
  assert.equal(legs.has('deposit'), false, 'a second repoint cannot fence the stale review');
  state.duringDepositProof = () => {};
  assert.equal((await sendNightByName(request, recovery)).phase, 'deposit-pending');
  assert.deepEqual(legs.get('deposit'), deposit);
  state.finalized.add(deposit.hash);
  assert.equal((await sendNightByName(request, recovery)).phase, 'completed');
  assert.equal(
    recoveryReviews,
    3,
    'a second repoint needs a new review; a fenced deposit does not',
  );
  assert.deepEqual(
    recoveryRecords.map((row) => ('target' in row.current ? row.current.target : undefined)),
    ['d'.repeat(64), 'e'.repeat(64)],
  );
  assert.deepEqual(calls, [
    'review',
    'sign',
    'withdraw',
    'recovery-review',
    'recovery-review',
    'recovery-record',
    'recovery-review',
    'recovery-record',
    'deposit',
  ]);
});

test('an unresolved name can repair only the exact finalized output at its original ACC', async () => {
  for (const [kind, reason] of [
    ['absent', 'Absent'],
    ['invalid', 'InvalidRecord'],
    ['outage', 'Unavailable'],
    ['unsupported', 'UnsupportedTarget'],
  ] as const) {
    const { state, calls, ports, legs, recoveryRecords } = fixture();
    state.finalized.add(withdrawal.hash);
    state.stopBeforeDeposit = true;
    await assert.rejects(sendNightByName(request, ports()), NightDepositInterrupted);
    state.stopBeforeDeposit = false;
    if (kind === 'absent') state.absent = true;
    if (kind === 'invalid') state.validTarget = false;
    if (kind === 'outage') state.outage = true;
    if (kind === 'unsupported') state.address = 'd'.repeat(64);
    const base = ports();
    const recovery = {
      ...base,
      async isSupportedRecipient(address: string) {
        return address === target;
      },
      async reviewUnresolvedOriginalDeposit(
        original: NightSendIntent,
        observation: NightUnresolvedObservation,
        saved: NightSendLeg,
      ) {
        assert.equal(original.target, target);
        assert.equal(observation.reason, reason);
        assert.deepEqual(saved, withdrawal);
        calls.push('repair-review');
        return true;
      },
    };
    await assert.rejects(sendNightByName(request, base), NightDepositInterrupted);
    assert.equal(legs.has('deposit'), false);
    state.duringDepositProof = () => {
      state.absent = false;
      state.validTarget = true;
      state.outage = false;
      state.address = target;
    };
    await assert.rejects(sendNightByName(request, recovery), NightDepositInterrupted);
    assert.equal(legs.has('deposit'), false, 'a changed observation needs another review');
    state.duringDepositProof = () => {};
    if (kind === 'absent') state.absent = true;
    if (kind === 'invalid') state.validTarget = false;
    if (kind === 'outage') state.outage = true;
    if (kind === 'unsupported') state.address = 'd'.repeat(64);
    assert.equal((await sendNightByName(request, recovery)).phase, 'deposit-pending');
    assert.equal(legs.get('deposit')?.hash, deposit.hash);
    assert.equal(calls.filter((call) => call === 'sign').length, 1);
    assert.equal(calls.filter((call) => call === 'withdraw').length, 1);
    assert.equal(calls.filter((call) => call === 'deposit').length, 1);
    assert.deepEqual(
      recoveryRecords.map((row) =>
        'reason' in row.current ? row.current.reason : row.current.target,
      ),
      [reason, reason],
    );
    state.finalized.add(deposit.hash);
    assert.equal((await sendNightByName(request, recovery)).phase, 'completed');
  }
});

test('an expired name requires the same explicit direct-ACC repair review', async () => {
  const { state, ports, legs } = fixture();
  state.finalized.add(withdrawal.hash);
  state.stopBeforeDeposit = true;
  await assert.rejects(sendNightByName(request, ports()), NightDepositInterrupted);
  state.stopBeforeDeposit = false;
  const base = ports();
  const expired = {
    ...base.names,
    async resolve(query: { name: string; networkId: string }) {
      return {
        ...query,
        namespace: 'night',
        accountAddress: target,
        addressClass: 'contract' as const,
        resolvedOperation: 'contract-call' as const,
        expiresAt: Date.now() - 1,
      };
    },
  };
  let reviewed = 0;
  const recovery = {
    ...base,
    names: expired,
    async reviewUnresolvedOriginalDeposit(
      original: NightSendIntent,
      observation: NightUnresolvedObservation,
    ) {
      assert.equal(original.target, target);
      assert.equal(observation.reason, 'Expired');
      reviewed++;
      return true;
    },
  };
  assert.equal((await sendNightByName(request, recovery)).phase, 'deposit-pending');
  assert.equal(reviewed, 1);
  assert.equal(legs.get('deposit')?.hash, deposit.hash);
});

test('unresolved repair refuses changed provider, lost original binding and failed durable review', async () => {
  const { state, ports, legs, calls } = fixture();
  state.finalized.add(withdrawal.hash);
  state.stopBeforeDeposit = true;
  await assert.rejects(sendNightByName(request, ports()), NightDepositInterrupted);
  state.stopBeforeDeposit = false;
  state.absent = true;
  let reviews = 0;
  const base = ports();
  const recovery = {
    ...base,
    async reviewUnresolvedOriginalDeposit() {
      reviews++;
      return true;
    },
  };
  const changedProvider = createMidnamesNameService(
    { networkId: request.networkId, namespace: 'night', registryAddress: 'f'.repeat(64) },
    {
      async readTarget() {
        return undefined;
      },
      async isSupportedAccount() {
        return true;
      },
    },
  );
  await assert.rejects(
    sendNightByName(request, { ...recovery, names: changedProvider }),
    NightDepositInterrupted,
  );
  assert.equal(reviews, 0);
  await assert.rejects(
    sendNightByName(request, {
      ...recovery,
      async isSupportedRecipient() {
        return false;
      },
    }),
    NightDepositInterrupted,
  );
  assert.equal(reviews, 0);
  await assert.rejects(
    sendNightByName(request, {
      ...recovery,
      journal: {
        ...base.journal,
        async recordRecoveryReview() {
          throw new Error('storage unavailable');
        },
      },
    }),
    NightDepositInterrupted,
  );
  assert.equal(reviews, 1);
  assert.equal(legs.has('deposit'), false);
  assert.deepEqual(calls, ['review', 'sign', 'withdraw']);
});

test('the original ACC binding must survive the recovery review and proof', async () => {
  const { state, calls, ports, legs } = fixture();
  state.finalized.add(withdrawal.hash);
  state.stopBeforeDeposit = true;
  await assert.rejects(sendNightByName(request, ports()), NightDepositInterrupted);
  state.stopBeforeDeposit = false;
  state.address = 'd'.repeat(64);
  let reviews = 0;
  const recovery = {
    ...ports(),
    async reviewOriginalDeposit() {
      reviews++;
      return true;
    },
  };
  state.supportedTarget = false;
  await assert.rejects(sendNightByName(request, recovery), NightDepositInterrupted);
  assert.equal(reviews, 0);
  state.supportedTarget = true;
  state.duringDepositProof = () => {
    state.supportedTarget = false;
  };
  await assert.rejects(sendNightByName(request, recovery), NightDepositInterrupted);
  assert.equal(reviews, 1);
  assert.equal(legs.has('deposit'), false);
  assert.deepEqual(calls, ['review', 'sign', 'withdraw', 'recovery-record']);
});

test('changing the registry provider cannot use original-target recovery', async () => {
  const { state, calls, ports, legs } = fixture();
  state.finalized.add(withdrawal.hash);
  state.stopBeforeDeposit = true;
  await assert.rejects(sendNightByName(request, ports()), NightDepositInterrupted);
  let reviewed = false;
  const replacement = createMidnamesNameService(
    { networkId: request.networkId, namespace: 'night', registryAddress: 'f'.repeat(64) },
    {
      async readTarget() {
        return { kind: 'contract' as const, address: 'd'.repeat(64) };
      },
      async isSupportedAccount() {
        return true;
      },
    },
  );
  await assert.rejects(
    sendNightByName(request, {
      ...ports(),
      names: replacement,
      async reviewOriginalDeposit() {
        reviewed = true;
        return true;
      },
    }),
    NightDepositInterrupted,
  );
  assert.equal(reviewed, false);
  assert.equal(legs.has('deposit'), false);
  assert.deepEqual(calls, ['review', 'sign', 'withdraw']);
});

test('an unknown withdrawal remains original-only and cannot fund the next leg', async () => {
  const { calls, ports, legs } = fixture();
  for (let attempt = 0; attempt < 2; attempt++)
    assert.equal((await sendNightByName(request, ports())).phase, 'withdrawal-pending');
  await assert.rejects(sendNightByName({ ...request, amount: '3' }, ports()), /scope changed/);
  assert.deepEqual(calls, ['review', 'sign', 'withdraw']);
  assert.equal(legs.size, 1);
});

test('a retained no-ID intent refuses another review or withdrawal preparation', async () => {
  const { state, calls, ports, legs } = fixture();
  state.duringWithdrawalProof = () => {
    throw new Error('preparation interrupted');
  };
  await assert.rejects(sendNightByName(request, ports()), /preparation interrupted/);
  state.duringWithdrawalProof = () => {};
  await assert.rejects(
    sendNightByName(request, {
      ...ports(),
      async review() {
        calls.push('unexpected-review');
        return true;
      },
    }),
    /no transaction ID/,
  );
  assert.deepEqual(calls, ['review', 'sign']);
  assert.equal(legs.size, 0);
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

test('the account owner callback fences the finalized original before dispatch and lost reply', async () => {
  const { calls, ports, legs } = fixture();
  const base = ports();
  let executions = 0;
  const owner: Parameters<typeof sendNightByName>[1] = {
    ...base,
    prepareWithdrawal: undefined,
    journal: {
      ...base.journal,
      async fenceLeg(leg, original) {
        calls.push('fence');
        await base.journal.fenceLeg(leg, original);
      },
    },
    async submitWithdrawal(
      intent: NightSendIntent,
      beforeSubmit: (submission: PreparedValueSubmission) => Promise<void>,
    ) {
      executions++;
      calls.push('owner-sign');
      assert.equal(intent.bridge, request.bridge);
      await beforeSubmit({
        networkId: request.networkId,
        account: request.source,
        circuit: 'withdraw_unshielded_with_jubjub',
        transactionHash: withdrawal.hash,
        identifiers: withdrawal.identifiers,
      });
      assert.deepEqual(legs.get('withdraw'), withdrawal);
      calls.push('withdraw');
      throw new Error('submission reply lost');
    },
  };
  assert.equal((await sendNightByName(request, owner)).phase, 'withdrawal-pending');
  assert.deepEqual(calls, ['review', 'owner-sign', 'fence', 'withdraw']);
  assert.equal((await sendNightByName(request, owner)).phase, 'withdrawal-pending');
  assert.equal(executions, 1, 'the unknown original is looked up without another owner send');
});

test('a changed host port cannot switch an approved owner withdrawal to an unfenced path', async () => {
  const { calls, ports, legs } = fixture();
  let substituted = 0;
  const owner: Parameters<typeof sendNightByName>[1] = {
    ...ports(),
    prepareWithdrawal: undefined,
    async review() {
      calls.push('review');
      Object.assign(owner, {
        async submitWithdrawal() {
          substituted++;
        },
        async prepareWithdrawal() {
          substituted++;
        },
      });
      return true;
    },
    async submitWithdrawal(_, beforeSubmit) {
      calls.push('original-owner');
      await beforeSubmit({
        networkId: request.networkId,
        account: request.source,
        circuit: 'withdraw_unshielded_with_jubjub',
        transactionHash: withdrawal.hash,
        identifiers: withdrawal.identifiers,
      });
    },
  };
  assert.equal((await sendNightByName(request, owner)).phase, 'withdrawal-pending');
  assert.deepEqual(calls, ['review', 'original-owner']);
  assert.equal(substituted, 0);
  assert.deepEqual(legs.get('withdraw'), withdrawal);
});

test('the owner callback rechecks a repointed name before fencing or dispatch', async () => {
  const { state, calls, ports, legs } = fixture();
  const owner: Parameters<typeof sendNightByName>[1] = {
    ...ports(),
    prepareWithdrawal: undefined,
    async submitWithdrawal(_, beforeSubmit) {
      calls.push('owner-sign');
      state.address = 'f'.repeat(64);
      await beforeSubmit({
        networkId: request.networkId,
        account: request.source,
        circuit: 'withdraw_unshielded_with_jubjub',
        transactionHash: withdrawal.hash,
        identifiers: withdrawal.identifiers,
      });
      calls.push('withdraw');
    },
  };
  await assert.rejects(sendNightByName(request, owner), /scope changed/);
  assert.deepEqual(calls, ['review', 'owner-sign']);
  assert.equal(legs.size, 0);
  await assert.rejects(sendNightByName(request, owner), /no transaction ID/);
  assert.deepEqual(calls, ['review', 'owner-sign'], 'a retained intent without an ID cannot retry');
});

test('the account owner route refuses a wrong finalized call or a missing callback', async () => {
  for (const wrong of [true, false]) {
    const { calls, ports, legs } = fixture();
    const owner: Parameters<typeof sendNightByName>[1] = {
      ...ports(),
      prepareWithdrawal: undefined,
      async submitWithdrawal(_, beforeSubmit) {
        calls.push('owner-sign');
        if (wrong)
          await beforeSubmit({
            networkId: request.networkId,
            account: request.source,
            circuit: 'withdraw_unshielded_with_p256',
            transactionHash: withdrawal.hash,
            identifiers: withdrawal.identifiers,
          });
        calls.push('withdraw-attempt');
      },
    };
    await assert.rejects(
      sendNightByName(request, owner),
      wrong ? /differs from the reviewed source/ : /without an original transaction ID/,
    );
    assert.deepEqual(
      calls,
      wrong ? ['review', 'owner-sign'] : ['review', 'owner-sign', 'withdraw-attempt'],
    );
    assert.equal(legs.size, 0);
    await assert.rejects(sendNightByName(request, owner), /no transaction ID/);
  }
});
