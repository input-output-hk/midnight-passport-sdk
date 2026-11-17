import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ContractCall } from '@midnightntwrk/ledger-v9';
import {
  assertExactNightBridgeSpend,
  checkedNightBridgeOutput,
  exactNightBridgeOutput,
  hasExactNightBridgeCoin,
  type NightBridgeTransaction,
} from '../src/midnames/night-bridge-output.js';
import { assertExactNightDeposit } from '../src/midnames/night-deposit-check.js';
import { NIGHT_SEND_OPERATIONS, type NightSendIntent } from '../src/midnames/night-send.js';

const bridge = 'b'.repeat(64);
const hash = 'e'.repeat(64);
const intentHash = 'd'.repeat(64);
const identifier = '0'.repeat(66);
const night = '00'.repeat(32);
const intent: NightSendIntent = {
  requestId: 'a1234567-a123-4123-8123-a123456789ab',
  name: 'alice.night',
  networkId: 'undeployed',
  source: 'a'.repeat(64),
  target: 'c'.repeat(64),
  bridge,
  asset: 'NIGHT',
  amount: '4',
  providerId: 'midnames',
  namespace: 'night',
  operations: NIGHT_SEND_OPERATIONS,
};
const withdrawal = { hash, identifiers: [identifier] };
const output = { value: 4n, type: night, owner: bridge };
const coin = { ...output, intentHash, outputNo: 0 };
const call = (address = intent.target, entryPoint = 'deposit_unshielded') =>
  Object.defineProperties(Object.create(ContractCall.prototype) as object, {
    address: { value: address },
    entryPoint: { value: entryPoint },
  });

function transaction(
  outputs: readonly (typeof output)[],
  inputs: readonly (typeof coin)[] = [],
): NightBridgeTransaction {
  return {
    transactionHash: () => hash,
    identifiers: () => [identifier],
    intents: new Map([
      [
        7,
        {
          intentHash: () => intentHash,
          guaranteedUnshieldedOffer: { outputs, inputs },
        },
      ],
    ]),
  };
}

test('the original journaled output is the only acceptable deposit input', () => {
  const expected = exactNightBridgeOutput(intent, withdrawal, transaction([output]));
  assert.deepEqual(expected, {
    transactionHash: hash,
    intentHash,
    outputNo: 0,
    owner: bridge,
    type: night,
    value: 4n,
  });
  assert.equal(hasExactNightBridgeCoin([{ utxo: coin }], expected), true);
  assert.equal(
    hasExactNightBridgeCoin([{ utxo: { ...coin, intentHash: 'f'.repeat(64) } }], expected),
    false,
  );
  assertExactNightBridgeSpend(transaction([], [coin]), expected, () => bridge);
});

test('a changed original identity or extra/different withdrawal output refuses before deposit', () => {
  const original = transaction([output]);
  assert.throws(
    () =>
      exactNightBridgeOutput(intent, { hash: 'f'.repeat(64), identifiers: [identifier] }, original),
    /identity/,
  );
  assert.throws(
    () => exactNightBridgeOutput(intent, { hash, identifiers: ['1'.repeat(66)] }, original),
    /identity/,
  );
  for (const changed of [
    [{ ...output, owner: 'f'.repeat(64) }],
    [{ ...output, value: 3n }],
    [{ ...output, type: '1'.repeat(64) }],
    [output, output],
    [],
  ])
    assert.throws(
      () => exactNightBridgeOutput(intent, withdrawal, transaction(changed)),
      /single exact/,
    );
});

test('wallet ambiguity and balanced coin substitution refuse before deposit dispatch', () => {
  const expected = exactNightBridgeOutput(intent, withdrawal, transaction([output]));
  assert.throws(
    () => hasExactNightBridgeCoin([{ utxo: coin }, { utxo: coin }], expected),
    /Ambiguous/,
  );
  assert.equal(
    hasExactNightBridgeCoin([{ utxo: { ...coin, owner: 'mn_addr_undeployed1other' } }], expected),
    false,
  );
  for (const changed of [
    { ...coin, intentHash: 'f'.repeat(64) },
    { ...coin, outputNo: 1 },
    { ...coin, value: 3n },
    { ...coin, type: '1'.repeat(64) },
  ])
    assert.throws(
      () => assertExactNightBridgeSpend(transaction([], [changed]), expected, () => bridge),
      /only the original/,
    );
  assert.throws(
    () => assertExactNightBridgeSpend(transaction([], [coin, coin]), expected, () => bridge),
    /only the original/,
  );
  assert.throws(
    () => assertExactNightBridgeSpend(transaction([], [coin]), expected, () => 'f'.repeat(64)),
    /only the original/,
  );
});

test('worker observation accepts only a bounded exact NIGHT output request', () => {
  const expected = exactNightBridgeOutput(intent, withdrawal, transaction([output]));
  assert.deepEqual(checkedNightBridgeOutput(structuredClone(expected)), expected);
  for (const changed of [
    { ...expected, owner: 'mn_addr_undeployed1other' },
    { ...expected, type: '1'.repeat(64) },
    { ...expected, value: '4' },
    { ...expected, value: 0n },
    { ...expected, value: 1n << 128n },
    { ...expected, outputNo: -1 },
    { ...expected, outputNo: 65_536 },
    { ...expected, intentHash: 'bad' },
    { ...expected, transactionHash: 'bad' },
  ])
    assert.throws(() => checkedNightBridgeOutput(changed), /Invalid NIGHT bridge output/);
});

test('the device signer refuses a different ACC action or an unshielded change output', () => {
  const expected = exactNightBridgeOutput(intent, withdrawal, transaction([output]));
  const deposit = (
    actions: readonly unknown[],
    outputs: readonly (typeof output)[] = [],
    inputs: readonly (typeof coin)[] = [coin],
  ): NightBridgeTransaction => ({
    transactionHash: () => hash,
    identifiers: () => [identifier],
    intents: new Map([
      [
        7,
        {
          intentHash: () => intentHash,
          actions,
          guaranteedUnshieldedOffer: { inputs, outputs },
        },
      ],
    ]),
  });
  assert.doesNotThrow(() =>
    assertExactNightDeposit(deposit([call()]), expected, intent.target, () => bridge),
  );
  for (const changed of [
    deposit([call('f'.repeat(64))]),
    deposit([call(intent.target, 'withdraw_unshielded_with_jubjub')]),
    deposit([call(), call()]),
    deposit([call()], [output]),
    deposit([call()], [], [{ ...coin, value: 3n }]),
  ])
    assert.throws(
      () => assertExactNightDeposit(changed, expected, intent.target, () => bridge),
      /reviewed ACC call|only the original/,
    );
});
