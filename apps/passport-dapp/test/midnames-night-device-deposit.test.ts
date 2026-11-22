import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContractCall } from '@midnightntwrk/ledger-v9';
import { WalletFacade } from '@midnightntwrk/wallet-sdk-facade';
import { IDBFactory } from 'fake-indexeddb';
import { openBrowserNightSendJournal } from '../src/midnames/night-send-journal.js';
import { NIGHT_SEND_OPERATIONS } from '../src/midnames/night-send.js';
import { exactFencedNightDeposit } from '../src/wallet/night-deposit-fence.js';
import {
  checkedDeviceNightDepositRequest,
  checkedDeviceNightLeg,
  deviceNightDeposit,
} from '../src/wallet/night-deposit.js';
import type { NightBridgeTransaction } from '../src/midnames/night-bridge-output.js';

const hash = 'a'.repeat(64);
const depositHash = 'f'.repeat(64);
const intentHash = 'b'.repeat(64);
const bridge = 'c'.repeat(64);
const target = 'd'.repeat(64);
const type = '00'.repeat(32);
const identifier = '01' + 'e'.repeat(64);
const output = { transactionHash: hash, intentHash, outputNo: 0, owner: bridge, type, value: 4n };
const coin = { utxo: { intentHash, outputNo: 0, owner: bridge, type, value: 4n } };
const original = { hash: depositHash, identifiers: [identifier] };
const scope = {
  networkId: 'undeployed' as const,
  source: '1'.repeat(64),
  credentialId: '2'.repeat(32),
};
const call = Object.defineProperties(Object.create(ContractCall.prototype) as object, {
  address: { value: target },
  entryPoint: { value: 'deposit_unshielded' },
});
const transaction: NightBridgeTransaction = {
  transactionHash: () => depositHash,
  identifiers: () => [identifier],
  intents: new Map([
    [
      0,
      {
        intentHash: () => intentHash,
        actions: [call],
        guaranteedUnshieldedOffer: { inputs: [coin.utxo], outputs: [] },
      },
    ],
  ]),
};
const request = { scope, target, output, proven: Uint8Array.of(1, 2, 3) };

test('the worker input parser owns the proof bytes and rejects a changed output', () => {
  const checked = checkedDeviceNightDepositRequest(structuredClone(request));
  request.proven[0] = 9;
  assert.deepEqual(checked.proven, Uint8Array.of(1, 2, 3));
  assert.throws(() => checkedDeviceNightDepositRequest({ ...request, target: 'wrong' }), /Invalid/);
  assert.throws(
    () => checkedDeviceNightDepositRequest({ ...request, output: { ...output, value: 0n } }),
    /Invalid/,
  );
  assert.deepEqual(checkedDeviceNightLeg(original), original);
  assert.throws(() => checkedDeviceNightLeg({ hash, identifiers: [] }), /original transaction ID/);
  for (const credentialId of ['', 'a', 'A'.repeat(32), 'a'.repeat(2048)]) {
    assert.throws(
      () => checkedDeviceNightDepositRequest({ ...request, scope: { ...scope, credentialId } }),
      /Invalid NIGHT deposit request/,
    );
  }
});

test('candidate deposit keeps its binding pin through the worker journal fence', async () => {
  const candidateScope = {
    ...scope,
    bindingId: 'acc-s3r1.1-zkir036',
    manifestSha256: '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f',
  };
  const parsed = checkedDeviceNightDepositRequest({ ...request, scope: candidateScope });
  assert.deepEqual(parsed.scope, candidateScope);
  assert.deepEqual(checkedDeviceNightDepositRequest(parsed).scope, candidateScope);
  const factory = new IDBFactory();
  const journal = await openBrowserNightSendJournal(factory, candidateScope);
  try {
    await journal.createIntent({
      requestId: 'a1234567-a123-4123-8123-a123456789ab',
      networkId: 'undeployed',
      source: scope.source,
      bridge,
      asset: 'NIGHT',
      amount: '4',
      name: 'alice.night',
      target,
      providerId: `midnames:${'3'.repeat(64)}`,
      namespace: 'night',
      operations: NIGHT_SEND_OPERATIONS,
    });
    await journal.fenceLeg('withdraw', { hash, identifiers: ['00' + '4'.repeat(64)] });
    await journal.fenceLeg('deposit', original);
    assert.equal(
      await exactFencedNightDeposit(parsed.scope, original, output, target, factory),
      true,
    );
  } finally {
    journal.close();
  }
  assert.throws(
    () =>
      checkedDeviceNightDepositRequest({
        ...request,
        scope: { ...candidateScope, manifestSha256: '0'.repeat(64) },
      }),
    /Invalid NIGHT deposit request/,
  );
  assert.throws(
    () =>
      checkedDeviceNightDepositRequest({
        ...request,
        scope: { ...candidateScope, manifestSha256: undefined },
      }),
    /Invalid NIGHT deposit request/,
  );
});

test('the signer retains only one checked original and dispatches it once', async () => {
  const steps: string[] = [];
  let durable = false;
  const finalized = { serialize: () => Uint8Array.of(7) };
  const facade = Object.assign(Object.create(WalletFacade.prototype) as WalletFacade, {
    adoptTransaction: () => (steps.push('adopt'), {}),
    validateTransaction: async () => {
      steps.push('validate');
    },
    balanceUnboundTransaction: async () => (steps.push('balance'), {}),
    signRecipe: async () => (steps.push('sign'), {}),
    finalizeRecipe: async () => (steps.push('finalize'), finalized),
    submitTransaction: async () => (steps.push('submit'), identifier),
    revert: async () => {
      steps.push('revert');
    },
  });
  const deposit = deviceNightDeposit(
    facade,
    async () => {
      throw new Error('The fake facade must not request a real signature.');
    },
    async () => [coin],
    bridge,
    'undeployed',
    true,
    async () => output,
    async () => durable,
    () => transaction,
    (owner) => String(owner),
  );
  assert.deepEqual(await deposit.prepare(request), original);
  await assert.rejects(() => deposit.prepare(request), /Reconcile/);
  await assert.rejects(
    () => deposit.submit({ hash: '3'.repeat(64), identifiers: [identifier] }),
    /fenced original/,
  );
  await assert.rejects(() => deposit.submit(original), /durable journal fence/);
  durable = true;
  assert.equal(await deposit.submit(original), identifier);
  await assert.rejects(() => deposit.submit(original), /fenced original/);
  assert.deepEqual(steps, ['adopt', 'balance', 'sign', 'finalize', 'submit']);
});

test('concurrent worker requests cannot both cross an asynchronous journal fence', async () => {
  let releaseFence: (allowed: boolean) => void = () => {};
  const fence = new Promise<boolean>((resolve) => {
    releaseFence = resolve;
  });
  let dispatches = 0;
  const facade = Object.assign(Object.create(WalletFacade.prototype) as WalletFacade, {
    adoptTransaction: () => ({}),
    validateTransaction: async () => {},
    balanceUnboundTransaction: async () => ({}),
    signRecipe: async () => ({}),
    finalizeRecipe: async () => ({ serialize: () => Uint8Array.of(7) }),
    submitTransaction: async () => {
      dispatches++;
      return identifier;
    },
    revert: async () => {},
  });
  const deposit = deviceNightDeposit(
    facade,
    async () => {
      throw new Error('The fake facade must not request a real signature.');
    },
    async () => [coin],
    bridge,
    'undeployed',
    true,
    async () => output,
    async () => fence,
    () => transaction,
    (owner) => String(owner),
  );
  await deposit.prepare(request);
  const first = deposit.submit(original);
  await assert.rejects(() => deposit.submit(original), /fenced original/);
  releaseFence(true);
  assert.equal(await first, identifier);
  assert.equal(dispatches, 1);
});

test('a balanced different destination is reverted before an original is returned', async () => {
  let reverted = 0;
  const facade = Object.assign(Object.create(WalletFacade.prototype) as WalletFacade, {
    adoptTransaction: () => ({}),
    validateTransaction: async () => {},
    balanceUnboundTransaction: async () => ({}),
    signRecipe: async () => ({}),
    finalizeRecipe: async () => ({ serialize: () => Uint8Array.of(7) }),
    submitTransaction: async () => identifier,
    revert: async () => {
      reverted++;
    },
  });
  const deposit = deviceNightDeposit(
    facade,
    async () => {
      throw new Error('The fake facade must not request a real signature.');
    },
    async () => [coin],
    bridge,
    'undeployed',
    true,
    async () => output,
    async () => true,
    () => ({
      ...transaction,
      intents: new Map([[0, { intentHash: () => intentHash, actions: [call] }]]),
    }),
    (owner) => String(owner),
  );
  await assert.rejects(() => deposit.prepare(request), /only the original/);
  assert.equal(reverted, 1);
  await assert.rejects(() => deposit.submit(original), /fenced original/);
});

test('a lost submission answer never permits a second wallet dispatch', async () => {
  let dispatches = 0;
  const facade = Object.assign(Object.create(WalletFacade.prototype) as WalletFacade, {
    adoptTransaction: () => ({}),
    validateTransaction: async () => {},
    balanceUnboundTransaction: async () => ({}),
    signRecipe: async () => ({}),
    finalizeRecipe: async () => ({ serialize: () => Uint8Array.of(7) }),
    submitTransaction: async () => {
      dispatches++;
      throw new Error('The wallet reply was lost after admission.');
    },
    revert: async () => {},
  });
  const deposit = deviceNightDeposit(
    facade,
    async () => {
      throw new Error('The fake facade must not request a real signature.');
    },
    async () => [coin],
    bridge,
    'undeployed',
    true,
    async () => output,
    async () => true,
    () => transaction,
    (owner) => String(owner),
  );
  await deposit.prepare(request);
  await assert.rejects(() => deposit.submit(original), /reply was lost/);
  await assert.rejects(() => deposit.submit(original), /fenced original/);
  assert.equal(dispatches, 1);
});
