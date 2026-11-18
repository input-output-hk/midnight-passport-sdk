import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertExactNightWithdrawalFee,
  checkedNightWithdrawalFeeRequest,
  deviceNightWithdrawalFee,
} from '../src/wallet/night-withdrawal-fee.js';
import type { NightBridgeTransaction } from '../src/midnames/night-bridge-output.js';

const source = 'a'.repeat(64);
const bridge = 'b'.repeat(64);
const scope = { networkId: 'undeployed' as const, source, credentialId: 'c'.repeat(32) };
const request = { scope, bridge, amount: '4', proven: Uint8Array.of(1, 2) };
const transaction = {
  intents: new Map([
    [
      0,
      {
        actions: [{ address: source, entryPoint: 'withdraw_unshielded_with_jubjub' }],
        guaranteedUnshieldedOffer: {
          inputs: [],
          outputs: [{ owner: bridge, type: '00'.repeat(32), value: 4n }],
        },
      },
    ],
  ]),
} as unknown as NightBridgeTransaction;

test('fee wallet accepts only the exact ACC withdrawal and an actual WebAuthn ID', () => {
  assert.deepEqual(checkedNightWithdrawalFeeRequest(request), request);
  assert.doesNotThrow(() => assertExactNightWithdrawalFee(transaction, request));
  for (const credentialId of ['', 'a', 'F'.repeat(32), 'f'.repeat(2048)])
    assert.throws(
      () => checkedNightWithdrawalFeeRequest({ ...request, scope: { ...scope, credentialId } }),
      /Invalid NIGHT withdrawal fee request/,
    );
  const intent = transaction.intents?.get(0);
  assert.ok(intent);
  for (const changed of [
    { ...intent, actions: [{ address: bridge, entryPoint: 'withdraw_unshielded_with_jubjub' }] },
    { ...intent, actions: [{ address: source, entryPoint: 'deposit_unshielded' }] },
    {
      ...intent,
      guaranteedUnshieldedOffer: {
        inputs: [],
        outputs: [{ owner: source, type: '00'.repeat(32), value: 4n }],
      },
    },
    {
      ...intent,
      guaranteedUnshieldedOffer: {
        inputs: [
          {
            value: 1n,
            type: '00'.repeat(32),
            owner: bridge,
            intentHash: '0'.repeat(64),
            outputNo: 0,
          },
        ],
        outputs: [{ owner: bridge, type: '00'.repeat(32), value: 4n }],
      },
    },
  ])
    assert.throws(
      () =>
        assertExactNightWithdrawalFee(
          { ...transaction, intents: new Map([[0, changed]]) },
          request,
        ),
      /different NIGHT withdrawal/,
    );
});

test('device wallet balances Dust and signs only an exact fenced withdrawal, without dispatch', async () => {
  const calls: string[] = [];
  const recipe = {};
  const signed = { blockData: {} };
  const finalized = { serialize: () => Uint8Array.of(3, 4) };
  const facade = {
    adoptTransaction(bytes: Uint8Array) {
      calls.push('adopt');
      assert.deepEqual(bytes, request.proven);
      return {};
    },
    async validateTransaction() {
      calls.push('validate');
    },
    async balanceUnboundTransaction(_adopted: unknown, options: { tokenKindsToBalance: string[] }) {
      calls.push('balance');
      assert.deepEqual(options.tokenKindsToBalance, ['dust']);
      return recipe;
    },
    async signRecipe() {
      calls.push('sign');
      return signed;
    },
    async finalizeRecipe() {
      calls.push('finalize');
      return finalized;
    },
    async revert() {
      calls.push('revert');
    },
  } as unknown as Parameters<typeof deviceNightWithdrawalFee>[0];
  const balance = deviceNightWithdrawalFee(
    facade,
    async () => {
      throw new Error('The fake facade must not request a real signature.');
    },
    bridge,
    'undeployed',
    async () => {
      calls.push('dust-ready');
    },
    () => transaction,
  );
  assert.deepEqual(await balance(request), Uint8Array.of(3, 4));
  assert.deepEqual(calls, ['dust-ready', 'adopt', 'balance', 'sign', 'finalize']);
  assert.equal('submitTransaction' in facade, false);
});
