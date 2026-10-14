import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { createMidnightHoldingSource } from '../packages/adapter-midnight-js/dist/index.js';

const require = createRequire(
  new URL('../packages/adapter-midnight-js/package.json', import.meta.url),
);
const { ZswapOutput } = await import(require.resolve('@midnightntwrk/ledger-v9'));
const account = 'ab'.repeat(32);
const coin = { nonce: new Uint8Array(32).fill(4), color: new Uint8Array(32).fill(5), value: 7n };
const other = { nonce: new Uint8Array(32).fill(6), color: coin.color, value: 9n };
const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');
const commitment = (/** @type {typeof coin} */ value) =>
  ZswapOutput.newContractOwned(
    { type: hex(value.color), nonce: hex(value.nonce), value: value.value },
    undefined,
    account,
  ).commitment;

test('holding source selects a distinct ACC output and skips noise or another recipient', async () => {
  /** @type {string[]} */
  const queried = [];
  const source = createMidnightHoldingSource({
    enumerateContractActions: async () => [
      { txHash: 'tx-a' },
      { txHash: 'tx-a' },
      { txHash: 'tx-b' },
    ],
    queryShieldedOutputs: async (txHash) => {
      queried.push(txHash);
      return txHash === 'tx-a'
        ? [{ contractAddress: account.toUpperCase(), commitment: commitment(coin) }]
        : [{ contractAddress: 'cd'.repeat(32), commitment: commitment(other) }];
    },
  });
  const entries = [Uint8Array.of(1), Uint8Array.of(2), Uint8Array.of(3), Uint8Array.of(4)];
  /** @type {(import('../packages/account/dist/ports/index.js').OpenedInboxEntry | null)[]} */
  const opened = [
    null,
    { kind: 'coin', coin },
    { kind: 'coin', coin },
    { kind: 'coin', coin: other },
  ];
  assert.deepEqual(await source.selectHeldEntries(account, entries, opened), [1]);
  assert.deepEqual(queried.sort(), ['tx-a', 'tx-b']);
});

test('holding source checks alignment and avoids history queries for no opened coins', async () => {
  let queries = 0;
  const source = createMidnightHoldingSource({
    enumerateContractActions: async () => {
      queries++;
      return [];
    },
    queryShieldedOutputs: async () => [],
  });
  assert.deepEqual(await source.selectHeldEntries(account, [Uint8Array.of(1)], [null]), []);
  assert.equal(queries, 0);
  await assert.rejects(source.selectHeldEntries(account, [], [null]), /does not match/);
});
