import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createMidnightHoldingSource } from '../packages/adapter-midnight-js/dist/index.js';

const require = createRequire(
  new URL('../packages/adapter-midnight-js/package.json', import.meta.url),
);
const { ZswapOutput } = await import(require.resolve('@midnightntwrk/ledger-v9'));
const account = 'ab'.repeat(32);
const sampleCoin = () => ({ nonce: Buffer.alloc(32, 4), color: Buffer.alloc(32, 5), value: 7n });
/** @param {import('../packages/account/dist/ports/index.js').ShieldedCoin} coin */
const plainCoin = (coin) => ({
  nonce: new Uint8Array(coin.nonce),
  color: new Uint8Array(coin.color),
  value: coin.value,
});
/** @param {import('../packages/account/dist/ports/index.js').ShieldedCoin} coin */
const commitment = (coin) =>
  ZswapOutput.newContractOwned(
    {
      type: Buffer.from(coin.color).toString('hex'),
      nonce: Buffer.from(coin.nonce).toString('hex'),
      value: coin.value,
    },
    undefined,
    account,
  ).commitment;
/** @param {import('../packages/account/dist/ports/index.js').ShieldedCoin} coin
 * @returns {import('../packages/account/dist/ports/index.js').OpenedInboxEntry[]} */
const openedCoin = (coin) => [{ kind: 'coin', coin }];
function gate() {
  /** @type {()=>void} */ let release = () => {};
  /** @type {Promise<void>} */ const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
/** @param {import('../packages/account/dist/ports/index.js').ShieldedCoin} coin
 * @param {Partial<import('../packages/adapter-midnight-js/dist/holdings.js').HoldingIndexer>} [overrides] */
function sourceFor(coin, overrides = {}) {
  const originalCommitment = commitment(coin);
  return createMidnightHoldingSource({
    enumerateContractActions: async () => [{ txHash: 'tx-a' }],
    queryShieldedOutputs: async () => [
      { contractAddress: account, commitment: originalCommitment, index: 11n },
    ],
    queryShieldedInputs: async () => [],
    coinNullifier: async () => '11'.repeat(32),
    ...overrides,
  });
}

for (const method of /** @type {const} */ (['selectHeldEntries', 'selectQualifiedHeldCoins'])) {
  test(`${method} qualifies the captured coin when caller objects and Buffers change during history`, async () => {
    const coin = sampleCoin(),
      expected = plainCoin(coin),
      held = gate(),
      entered = gate();
    /** @type {import('../packages/account/dist/ports/index.js').ShieldedCoin | undefined} */ let supplied;
    const source = sourceFor(coin, {
      enumerateContractActions: async () => {
        entered.release();
        await held.promise;
        return [{ txHash: 'tx-a' }];
      },
      coinNullifier: async (_account, value, index) => {
        supplied = plainCoin(value);
        assert.equal(index, 11n);
        return '11'.repeat(32);
      },
    });
    const opened = openedCoin(coin),
      entries = [new Uint8Array(192)];
    const pending = source[method](account, entries, opened);
    await entered.promise;
    coin.value = 9n;
    coin.nonce.fill(6);
    coin.color.fill(7);
    opened[0] = { kind: 'coin', coin: sampleCoin() };
    entries.length = 0;
    held.release();
    const selected = await pending;
    assert.deepEqual(supplied, expected);
    if (method === 'selectHeldEntries') assert.deepEqual(selected, [0]);
    else assert.deepEqual(selected, [{ inboxIndex: 0, coin: { ...expected, mt_index: 11n } }]);
    assert.ok(coin.nonce.every((v) => v === 6));
    assert.ok(coin.color.every((v) => v === 7));
  });
}

test('caller mutation during nullifier completion cannot change the qualified return', async () => {
  const coin = sampleCoin(),
    expected = plainCoin(coin),
    held = gate(),
    entered = gate();
  const source = sourceFor(coin, {
    coinNullifier: async (_account, supplied) => {
      assert.deepEqual(supplied, expected);
      entered.release();
      await held.promise;
      return '11'.repeat(32);
    },
  });
  const pending = source.selectQualifiedHeldCoins(account, [new Uint8Array(192)], openedCoin(coin));
  await entered.promise;
  coin.value = 12n;
  coin.nonce.fill(8);
  coin.color.fill(9);
  held.release();
  assert.deepEqual(await pending, [{ inboxIndex: 0, coin: { ...expected, mt_index: 11n } }]);
  assert.equal(coin.value, 12n);
  assert.ok(coin.nonce.every((v) => v === 8));
});

test('nullifier port receives its own coin copy and cannot mutate verified return or caller bytes', async () => {
  const coin = sampleCoin(),
    expected = plainCoin(coin);
  /** @type {import('../packages/account/dist/ports/index.js').ShieldedCoin | undefined} */ let retained;
  const source = sourceFor(coin, {
    coinNullifier: async (_account, supplied) => {
      retained = supplied;
      assert.deepEqual(supplied, expected);
      supplied.nonce.fill(10);
      supplied.color.fill(11);
      Object.defineProperty(supplied, 'value', { value: 12n });
      return '11'.repeat(32);
    },
  });
  const selected = await source.selectQualifiedHeldCoins(
    account,
    [new Uint8Array(192)],
    openedCoin(coin),
  );
  assert.deepEqual(selected, [{ inboxIndex: 0, coin: { ...expected, mt_index: 11n } }]);
  assert.deepEqual(plainCoin(coin), expected);
  assert.ok(retained);
  retained.nonce.fill(0);
  retained.color.fill(0);
  assert.deepEqual(selected, [{ inboxIndex: 0, coin: { ...expected, mt_index: 11n } }]);
  assert.deepEqual(plainCoin(coin), expected);
});

test('clearing a qualified result cannot clear caller Buffer storage or another invocation', async () => {
  const coin = sampleCoin(),
    expected = plainCoin(coin),
    source = sourceFor(coin);
  const first = await source.selectQualifiedHeldCoins(
    account,
    [new Uint8Array(192)],
    openedCoin(coin),
  );
  const second = await source.selectQualifiedHeldCoins(
    account,
    [new Uint8Array(192)],
    openedCoin(coin),
  );
  assert.ok(first[0] && second[0]);
  assert.equal(first[0].coin.nonce.constructor, Uint8Array);
  assert.equal(first[0].coin.color.constructor, Uint8Array);
  first[0].coin.nonce.fill(0);
  first[0].coin.color.fill(0);
  assert.deepEqual(plainCoin(coin), expected);
  assert.deepEqual(second, [{ inboxIndex: 0, coin: { ...expected, mt_index: 11n } }]);
});

for (const value of [0n, (1n << 128n) - 1n]) {
  test(`uint128 boundary ${value} retains its exact chain commitment`, async () => {
    const coin = { ...sampleCoin(), value },
      source = sourceFor(coin);
    const selected = await source.selectQualifiedHeldCoins(
      account.toUpperCase(),
      [new Uint8Array(192)],
      openedCoin(coin),
    );
    assert.equal(selected[0]?.coin.value, value);
    assert.equal(selected[0]?.coin.mt_index, 11n);
    assert.ok(selected[0]);
    assert.equal(commitment(selected[0].coin), commitment(coin));
  });
}

/** @type {Array<[string,(coin:ReturnType<typeof sampleCoin>)=>void]>} */
const malformed = [
  [
    'short nonce',
    (coin) => {
      coin.nonce = Buffer.alloc(31);
    },
  ],
  [
    'long nonce',
    (coin) => {
      coin.nonce = Buffer.alloc(33);
    },
  ],
  [
    'short color',
    (coin) => {
      coin.color = Buffer.alloc(31);
    },
  ],
  [
    'long color',
    (coin) => {
      coin.color = Buffer.alloc(33);
    },
  ],
  [
    'negative value',
    (coin) => {
      coin.value = -1n;
    },
  ],
  [
    'overflow value',
    (coin) => {
      coin.value = 1n << 128n;
    },
  ],
  [
    'number value',
    (coin) => {
      Object.defineProperty(coin, 'value', { value: 7 });
    },
  ],
  [
    'string value',
    (coin) => {
      Object.defineProperty(coin, 'value', { value: '7' });
    },
  ],
  [
    'shadowed oversized storage',
    (coin) => {
      const bytes = Buffer.alloc(1024);
      Object.defineProperty(bytes, 'length', { value: 32 });
      Object.defineProperty(bytes, 'byteLength', { value: 32 });
      coin.nonce = bytes;
    },
  ],
  [
    'non-byte typed array',
    (coin) => {
      Object.defineProperty(coin, 'nonce', { value: new Uint16Array(16) });
    },
  ],
];
for (const [label, mutate] of malformed) {
  test(`${label} is skipped before history and nullifier queries`, async () => {
    let queries = 0;
    const source = sourceFor(sampleCoin(), {
      enumerateContractActions: async () => {
        queries++;
        return [];
      },
      coinNullifier: async () => {
        queries++;
        return '11'.repeat(32);
      },
    });
    const coin = sampleCoin();
    mutate(coin);
    assert.deepEqual(
      await source.selectQualifiedHeldCoins(account, [new Uint8Array(192)], openedCoin(coin)),
      [],
    );
    assert.equal(queries, 0);
  });
}

test('intrinsic admission accepts cross-realm byte arrays and ignores overridden iterators', async () => {
  const coin = sampleCoin(),
    expected = plainCoin(coin),
    source = sourceFor(coin);
  const nonce = runInNewContext('new Uint8Array(32).fill(4)');
  const color = Buffer.alloc(32, 5);
  Object.defineProperty(color, Symbol.iterator, {
    value: () => {
      throw new Error('caller iterator must not execute');
    },
  });
  const selected = await source.selectQualifiedHeldCoins(
    account,
    [new Uint8Array(192)],
    openedCoin({ nonce, color, value: 7n }),
  );
  assert.deepEqual(selected, [{ inboxIndex: 0, coin: { ...expected, mt_index: 11n } }]);
});

test('distinct first inbox output and eight-hash query-pair batching remain unchanged', async () => {
  const coin = sampleCoin(),
    expected = plainCoin(coin),
    firstBatch = gate(),
    started = gate();
  let active = 0,
    maxActive = 0;
  /** @type {string[]} */ const queries = [];
  /** @param {string} hash */
  const query = async (hash) => {
    queries.push(hash);
    active++;
    maxActive = Math.max(maxActive, active);
    if (active === 16) started.release();
    if (hash !== 'tx-8') await firstBatch.promise;
    active--;
  };
  const source = sourceFor(coin, {
    enumerateContractActions: async () => [
      ...Array.from({ length: 9 }, (_v, i) => ({ txHash: `tx-${i}` })),
      { txHash: 'tx-0' },
    ],
    queryShieldedOutputs: async (hash) => {
      await query(hash);
      return hash === 'tx-0'
        ? [{ contractAddress: account, commitment: commitment(expected), index: 11n }]
        : [];
    },
    queryShieldedInputs: async (hash) => {
      await query(hash);
      return [];
    },
  });
  const pending = source.selectQualifiedHeldCoins(
    account,
    [new Uint8Array(192), new Uint8Array(192)],
    [...openedCoin(coin), ...openedCoin(coin)],
  );
  await started.promise;
  assert.equal(queries.length, 16);
  assert.equal(queries.includes('tx-8'), false);
  firstBatch.release();
  assert.deepEqual(await pending, [{ inboxIndex: 0, coin: { ...expected, mt_index: 11n } }]);
  assert.equal(maxActive, 16);
  assert.equal(queries.length, 18);
  for (let i = 0; i < 9; i++) assert.equal(queries.filter((hash) => hash === `tx-${i}`).length, 2);
});

test('malformed nested coin values and throwing getters remain noise before history', async () => {
  let queries = 0;
  const source = sourceFor(sampleCoin(), {
    enumerateContractActions: async () => {
      queries++;
      return [];
    },
  });
  for (const value of [
    undefined,
    null,
    7,
    'malformed',
    {},
    { nonce: new Uint8Array(32), color: null, value: 1n },
  ]) {
    const opened = openedCoin(sampleCoin());
    assert.ok(opened[0]);
    Object.defineProperty(opened[0], 'coin', { value });
    assert.deepEqual(
      await source.selectQualifiedHeldCoins(account, [new Uint8Array(192)], opened),
      [],
    );
  }
  const coin = sampleCoin();
  Object.defineProperty(coin, 'nonce', {
    get() {
      throw new Error('synthetic malformed description');
    },
  });
  assert.deepEqual(
    await source.selectQualifiedHeldCoins(account, [new Uint8Array(192)], openedCoin(coin)),
    [],
  );
  assert.equal(queries, 0);
});
