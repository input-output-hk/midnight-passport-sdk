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
