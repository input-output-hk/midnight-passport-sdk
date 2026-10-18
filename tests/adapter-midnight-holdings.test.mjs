import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import {
  createGraphqlHoldingIndexer,
  createMidnightHoldingSource,
} from '../packages/adapter-midnight-js/dist/index.js';

const require = createRequire(
  new URL('../packages/adapter-midnight-js/package.json', import.meta.url),
);
const { ZswapOutput, ZswapOffer, ZswapChainState, ZswapInput } = await import(
  require.resolve('@midnightntwrk/ledger-v9')
);
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
    queryShieldedInputs: async () => [],
    coinNullifier: async () => '11'.repeat(32),
    enumerateContractActions: async () => [
      { txHash: 'tx-a' },
      { txHash: 'tx-a' },
      { txHash: 'tx-b' },
    ],
    queryShieldedOutputs: async (txHash) => {
      queried.push(txHash);
      return txHash === 'tx-a'
        ? [{ contractAddress: account.toUpperCase(), commitment: commitment(coin), index: 11n }]
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
    queryShieldedInputs: async () => [],
    coinNullifier: async () => '11'.repeat(32),
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

test('qualified holding retains the chain output index and refuses an ambiguous position', async () => {
  const entry = Uint8Array.of(1);
  const opened = [{ kind: /** @type {const} */ ('coin'), coin }];
  const source = createMidnightHoldingSource({
    queryShieldedInputs: async () => [],
    coinNullifier: async () => '11'.repeat(32),
    enumerateContractActions: async () => [{ txHash: 'tx-a' }],
    queryShieldedOutputs: async () => [
      { contractAddress: account, commitment: commitment(coin), index: 11n },
    ],
  });
  assert.deepEqual(await source.selectQualifiedHeldCoins(account, [entry], opened), [
    { inboxIndex: 0, coin: { ...coin, mt_index: 11n } },
  ]);
  const noIndex = createMidnightHoldingSource({
    queryShieldedInputs: async () => [],
    coinNullifier: async () => '11'.repeat(32),
    enumerateContractActions: async () => [{ txHash: 'tx-a' }],
    queryShieldedOutputs: async () => [{ contractAddress: account, commitment: commitment(coin) }],
  });
  await assert.rejects(
    noIndex.selectHeldEntries(account, [entry], opened),
    /no unique verified Merkle index/,
  );
  await assert.rejects(
    noIndex.selectQualifiedHeldCoins(account, [entry], opened),
    /no unique verified Merkle index/,
  );
  const ambiguous = createMidnightHoldingSource({
    queryShieldedInputs: async () => [],
    coinNullifier: async () => '11'.repeat(32),
    enumerateContractActions: async () => [{ txHash: 'tx-a' }],
    queryShieldedOutputs: async () => [
      { contractAddress: account, commitment: commitment(coin), index: 11n },
      { contractAddress: account, commitment: commitment(coin), index: 12n },
    ],
  });
  await assert.rejects(
    ambiguous.selectQualifiedHeldCoins(account, [entry], opened),
    /no unique verified Merkle index/,
  );
});

test('a confirmed but subsequently spent output is excluded', async () => {
  const entry = Uint8Array.of(1);
  const source = createMidnightHoldingSource({
    enumerateContractActions: async () => [{ txHash: 'tx-a' }],
    queryShieldedOutputs: async () => [
      { contractAddress: account, commitment: commitment(coin), index: 11n },
    ],
    queryShieldedInputs: async () => [{ contractAddress: account, nullifier: '11'.repeat(32) }],
    coinNullifier: async () => '11'.repeat(32),
  });
  assert.deepEqual(await source.selectHeldEntries(account, [entry], [{ kind: 'coin', coin }]), []);
});

test('current Zswap state derives the same nullifier after a contract coin is spent', async () => {
  const qualified = {
    type: hex(coin.color),
    nonce: hex(coin.nonce),
    value: coin.value,
    mt_index: 0n,
  };
  const output = ZswapOutput.newContractOwned(qualified, undefined, account);
  const fresh = new ZswapChainState()
    .tryApply(ZswapOffer.fromOutput(output))[0]
    .postBlockUpdate(new Date(), 3600n);
  let current = fresh;
  const indexer = createGraphqlHoldingIndexer({
    networkId: 'undeployed',
    url: 'http://localhost:18088/api/v4/graphql',
    wsUrl: 'ws://localhost:18088/api/v4/graphql/ws',
    publicDataProvider: {
      queryZSwapAndContractState: async () => [
        current,
        /** @type {any} */ ({}),
        /** @type {any} */ ({}),
      ],
    },
  });
  const nullifier = await indexer.coinNullifier(account, coin, 0n);
  const input = ZswapInput.newContractOwned(qualified, undefined, account, fresh);
  current = fresh.tryApply(ZswapOffer.fromInput(input))[0];
  assert.equal(await indexer.coinNullifier(account, coin, 0n), nullifier);
});
