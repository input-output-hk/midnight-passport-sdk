import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import type {
  PassportAccount,
  PreparedValueSubmission,
} from '@input-output-hk/mn-passport-protocol';
import { createNightOwnerWithdrawal } from '../src/midnames/night-send-owner.js';
import { openBrowserNightSendJournal } from '../src/midnames/night-send-journal.js';
import {
  NIGHT_SEND_OPERATIONS,
  sendNightByName,
  type NightSendIntent,
} from '../src/midnames/night-send.js';
import { createMidnamesNameService } from '../src/midnames/resolver.js';

const source = 'a'.repeat(64);
const bridge = 'b'.repeat(64);
const intent: NightSendIntent = {
  requestId: 'a1234567-a123-4123-8123-a123456789ab',
  name: 'alice.night',
  networkId: 'undeployed',
  source,
  bridge,
  asset: 'NIGHT',
  amount: '4',
  target: 'c'.repeat(64),
  providerId: 'midnames:' + 'd'.repeat(64),
  namespace: 'night',
  operations: NIGHT_SEND_OPERATIONS,
};

function owner() {
  const calls: unknown[] = [];
  const account: PassportAccount = {
    address: source,
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    scheme: 'jubjub-schnorr',
    state: async () => ({
      booted: true,
      authNonce: 1n,
      deviceEpoch: 1n,
      entryCount: 1,
      specVersion: 3,
    }),
    rotateEncryptionKey: async () => ({ txHash: 'e'.repeat(64) }),
    async withdrawUnshielded(request, options) {
      calls.push({ request, options });
      assert.ok(options?.beforeSubmit);
      await options.beforeSubmit({
        networkId: 'undeployed',
        account: source,
        circuit: 'withdraw_unshielded_with_jubjub',
        transactionHash: 'f'.repeat(64),
        identifiers: ['00' + 'f'.repeat(64)],
      });
      return { txHash: 'f'.repeat(64), nextUseCounter: 2n };
    },
  };
  return { account, calls };
}

test('the selected owner maps exactly NIGHT, amount and bridge and forwards the original fence', async () => {
  const { account, calls } = owner();
  const submit = createNightOwnerWithdrawal(account);
  const seen: PreparedValueSubmission[] = [];
  const beforeSubmit = async (submission: PreparedValueSubmission) => {
    seen.push(submission);
  };
  await submit(intent, beforeSubmit);
  assert.deepEqual(calls, [
    {
      request: { color: '00'.repeat(32), amount: '4', recipient: bridge },
      options: { beforeSubmit },
    },
  ]);
  assert.deepEqual(seen, [
    {
      networkId: 'undeployed',
      account: source,
      circuit: 'withdraw_unshielded_with_jubjub',
      transactionHash: 'f'.repeat(64),
      identifiers: ['00' + 'f'.repeat(64)],
    },
  ]);
});

test('the optional host approval check runs at the finalized owner callback before fencing', async () => {
  const { account } = owner();
  const order: string[] = [];
  const submit = createNightOwnerWithdrawal(account, (reviewed) => {
    assert.notEqual(reviewed, intent);
    assert.deepEqual(reviewed, intent);
    assert.ok(Object.isFrozen(reviewed));
    assert.ok(Object.isFrozen(reviewed.operations));
    order.push('approved-scope');
  });
  await submit(intent, async () => {
    order.push('journal-fence');
  });
  assert.deepEqual(order, ['approved-scope', 'journal-fence']);

  const refused = createNightOwnerWithdrawal(account, () => {
    throw new Error('The named route no longer has owner approval.');
  });
  await assert.rejects(
    refused(intent, async () => {
      order.push('wrong-fence');
    }),
    /no longer has/,
  );
  assert.deepEqual(order, ['approved-scope', 'journal-fence']);
});

test('a mutable caller cannot present approved scope A for withdrawal arguments B', async () => {
  let release = () => {};
  const proof = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { account } = owner();
  const mutable = { ...intent, operations: [...intent.operations] as typeof NIGHT_SEND_OPERATIONS };
  const approvedBridge = 'e'.repeat(64);
  let fences = 0;
  let dispatches = 0;
  account.withdrawUnshielded = async (request, options) => {
    assert.equal(request.recipient, intent.bridge);
    await proof;
    assert.ok(options?.beforeSubmit);
    await options.beforeSubmit({
      networkId: 'undeployed',
      account: source,
      circuit: 'withdraw_unshielded_with_jubjub',
      transactionHash: 'f'.repeat(64),
      identifiers: ['00' + 'f'.repeat(64)],
    });
    dispatches++;
    return { txHash: 'f'.repeat(64), nextUseCounter: 2n };
  };
  const submit = createNightOwnerWithdrawal(account, (reviewed) => {
    assert.equal(reviewed.bridge, intent.bridge);
    assert.equal(reviewed.amount, intent.amount);
    assert.equal(reviewed.target, intent.target);
    assert.deepEqual(reviewed.operations, intent.operations);
    if (reviewed.bridge !== approvedBridge) throw new Error('Named approval differs.');
  });
  const pending = submit(mutable, async () => {
    fences++;
  });
  mutable.bridge = approvedBridge;
  mutable.amount = '9';
  mutable.target = 'f'.repeat(64);
  Reflect.set(mutable, 'operations', [NIGHT_SEND_OPERATIONS[1], NIGHT_SEND_OPERATIONS[0]]);
  release();
  await assert.rejects(pending, /Named approval differs/);
  assert.equal(fences, 0);
  assert.equal(dispatches, 0);
});

test('wrong owner, changed account and missing fence refuse before withdrawal', async () => {
  for (const change of [
    { scheme: 'p256-webauthn' },
    { bindingId: 'other' },
    { networkId: 'other' },
    { address: 'e'.repeat(64) },
  ]) {
    const { account, calls } = owner();
    Object.assign(account, change);
    await assert.rejects(
      createNightOwnerWithdrawal(account)(intent, async () => {}),
      /cannot fence|reviewed NIGHT withdrawal differs/,
    );
    assert.equal(calls.length, 0);
  }
  const { account, calls } = owner();
  const submit = createNightOwnerWithdrawal(account);
  Reflect.set(account, 'address', 'e'.repeat(64));
  await assert.rejects(
    submit(intent, async () => {}),
    /cannot fence/,
  );
  await assert.rejects(submit(intent, undefined as never), /cannot fence/);
  assert.equal(calls.length, 0);
});

test('changed value intent refuses before the owner API', async () => {
  for (const change of [
    { source: 'e'.repeat(64) },
    { networkId: 'other' },
    { asset: 'OTHER' },
    { bridge: 'not-an-address' },
    { amount: '0' },
    { operations: ['withdraw_unshielded_with_p256', 'deposit_unshielded'] as never },
  ]) {
    const { account, calls } = owner();
    await assert.rejects(
      createNightOwnerWithdrawal(account)({ ...intent, ...change }, async () => {}),
      /reviewed NIGHT withdrawal differs/,
    );
    assert.equal(calls.length, 0);
  }
});

test('the owner callback durably fences the original in the browser journal before dispatch', async () => {
  const factory = new IDBFactory();
  const scope = { networkId: 'undeployed' as const, source, credentialId: '1'.repeat(64) };
  let journal = await openBrowserNightSendJournal(factory, scope);
  const { account } = owner();
  let withdrawals = 0;
  account.withdrawUnshielded = async (_request, options) => {
    withdrawals++;
    assert.ok(options?.beforeSubmit);
    await options.beforeSubmit({
      networkId: 'undeployed',
      account: source,
      circuit: 'withdraw_unshielded_with_jubjub',
      transactionHash: 'f'.repeat(64),
      identifiers: ['00' + 'f'.repeat(64)],
    });
    assert.deepEqual(await journal.readLeg('withdraw'), {
      hash: 'f'.repeat(64),
      identifiers: ['00' + 'f'.repeat(64)],
    });
    throw new Error('submission response lost after dispatch');
  };
  const names = createMidnamesNameService(
    { networkId: 'undeployed', namespace: 'night', registryAddress: 'd'.repeat(64) },
    {
      async readTarget() {
        return { kind: 'contract', address: intent.target } as const;
      },
      async isSupportedAccount() {
        return true;
      },
    },
  );
  const ports = () => ({
    names,
    journal,
    async isSupportedRecipient() {
      return true;
    },
    async readSourceBalance() {
      return 10n;
    },
    async review() {
      return true;
    },
    submitWithdrawal: createNightOwnerWithdrawal(account),
    async prepareDeposit() {
      throw new Error('Deposit cannot begin before withdrawal finality.');
    },
    async finalized() {
      return false;
    },
  });
  assert.equal((await sendNightByName(intent, ports())).phase, 'withdrawal-pending');
  journal.close();
  journal = await openBrowserNightSendJournal(factory, scope);
  assert.deepEqual(await journal.readIntent(), intent);
  assert.deepEqual(await journal.readLeg('withdraw'), {
    hash: 'f'.repeat(64),
    identifiers: ['00' + 'f'.repeat(64)],
  });
  assert.equal((await sendNightByName(intent, ports())).phase, 'withdrawal-pending');
  assert.equal(withdrawals, 1);
  journal.close();
});

test('a submit port that ignores callback refusal cannot retire an uncertain withdrawal', async () => {
  const factory = new IDBFactory();
  const scope = { networkId: 'undeployed' as const, source, credentialId: '1'.repeat(64) };
  const journal = await openBrowserNightSendJournal(factory, scope);
  const { account } = owner();
  let currentTarget = intent.target;
  let dispatches = 0;
  account.withdrawUnshielded = async (_request, options) => {
    currentTarget = 'e'.repeat(64);
    assert.ok(options?.beforeSubmit);
    try {
      await options.beforeSubmit({
        networkId: 'undeployed',
        account: source,
        circuit: 'withdraw_unshielded_with_jubjub',
        transactionHash: 'f'.repeat(64),
        identifiers: ['00' + 'f'.repeat(64)],
      });
    } catch {
      dispatches++;
      throw new Error('lost response after a nonconforming dispatch');
    }
    throw new Error('The callback unexpectedly approved the repointed route.');
  };
  const names = createMidnamesNameService(
    { networkId: 'undeployed', namespace: 'night', registryAddress: 'd'.repeat(64) },
    {
      async readTarget() {
        return { kind: 'contract', address: currentTarget } as const;
      },
      async isSupportedAccount() {
        return true;
      },
    },
  );
  const ports = () => ({
    names,
    journal,
    async isSupportedRecipient() {
      return true;
    },
    async readSourceBalance() {
      return 10n;
    },
    async review() {
      return true;
    },
    submitWithdrawal: createNightOwnerWithdrawal(account),
    async prepareDeposit() {
      throw new Error('Deposit cannot begin before withdrawal finality.');
    },
    async finalized() {
      return false;
    },
  });
  await assert.rejects(sendNightByName(intent, ports()), /lost response/);
  assert.equal(dispatches, 1);
  const active = await journal.readActive();
  assert.deepEqual(active?.intent, intent);
  assert.ok(Number.isFinite(Date.parse(active?.ownerStartedAt ?? '')));
  assert.equal(await journal.readRefused(intent.requestId), undefined);
  await assert.rejects(journal.retireRefused(intent, 'name-recheck'), /exact unsubmitted/);
  await assert.rejects(sendNightByName(intent, ports()), /no transaction ID/);
  await assert.rejects(
    sendNightByName(intent, {
      ...ports(),
      submitWithdrawal: undefined,
      async prepareWithdrawal() {
        dispatches++;
        throw new Error('The legacy route must never run for an uncertain owner intent.');
      },
    }),
    /no transaction ID/,
  );
  assert.equal(dispatches, 1);
  journal.close();
});

test('a name change before entering the owner port is audited and permits a new request', async () => {
  const factory = new IDBFactory();
  const scope = { networkId: 'undeployed' as const, source, credentialId: '1'.repeat(64) };
  const journal = await openBrowserNightSendJournal(factory, scope);
  const { account } = owner();
  let currentTarget = intent.target;
  let changeAtReview = true;
  let ownerCalls = 0;
  account.withdrawUnshielded = async (_request, options) => {
    ownerCalls++;
    assert.ok(options?.beforeSubmit);
    await options.beforeSubmit({
      networkId: 'undeployed',
      account: source,
      circuit: 'withdraw_unshielded_with_jubjub',
      transactionHash: 'f'.repeat(64),
      identifiers: ['00' + 'f'.repeat(64)],
    });
    return { txHash: 'f'.repeat(64), nextUseCounter: 2n };
  };
  const names = createMidnamesNameService(
    { networkId: 'undeployed', namespace: 'night', registryAddress: 'd'.repeat(64) },
    {
      async readTarget() {
        return { kind: 'contract', address: currentTarget } as const;
      },
      async isSupportedAccount() {
        return true;
      },
    },
  );
  const ports = () => ({
    names,
    journal,
    async isSupportedRecipient() {
      return true;
    },
    async readSourceBalance() {
      return 10n;
    },
    async review() {
      if (changeAtReview) {
        currentTarget = 'e'.repeat(64);
        changeAtReview = false;
      }
      return true;
    },
    submitWithdrawal: createNightOwnerWithdrawal(account),
    async prepareDeposit() {
      throw new Error('Deposit cannot begin before withdrawal finality.');
    },
    async finalized() {
      return false;
    },
  });
  await assert.rejects(sendNightByName(intent, ports()), /scope changed/);
  assert.equal(ownerCalls, 0);
  assert.equal(await journal.readActive(), undefined);
  assert.equal((await journal.readRefused(intent.requestId))?.reason, 'name-recheck');
  await assert.rejects(sendNightByName(intent, ports()), /already archived/);

  currentTarget = intent.target;
  const next = { ...intent, requestId: 'b1234567-a123-4123-8123-a123456789ab' };
  assert.equal((await sendNightByName(next, ports())).phase, 'withdrawal-pending');
  assert.equal(ownerCalls, 1);
  journal.close();
});
