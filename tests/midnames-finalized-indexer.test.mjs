import assert from 'node:assert/strict';
import { test } from 'node:test';
import { waitForFinalizedIndexerBlock } from '../examples/midnames-local/finalized-indexer.mjs';

const hash = 'a'.repeat(64);

test('waits for the exact finalized block and never substitutes an older tip', async () => {
  /** @type {Array<{type: 'blockHash', blockHash: string}>} */
  const queries = [];
  let attempts = 0;
  const block = await waitForFinalizedIndexerBlock(
    {
      /** @param {{type: 'blockHash', blockHash: string}} offset */
      async queryBlock(offset) {
        queries.push(offset);
        return ++attempts === 3 ? { hash, height: 100 } : null;
      },
    },
    hash,
    100,
    { attempts: 3, pause: async () => {} },
  );
  assert.deepEqual(block, { hash, height: 100 });
  assert.deepEqual(queries, Array(3).fill({ type: 'blockHash', blockHash: hash }));
});

test('refuses a lagging indexer and a different block at the captured height', async () => {
  await assert.rejects(
    waitForFinalizedIndexerBlock({ queryBlock: async () => null }, hash, 100, {
      attempts: 2,
      pause: async () => {},
    }),
    /did not reach the exact node-finalized block/,
  );
  await assert.rejects(
    waitForFinalizedIndexerBlock(
      { queryBlock: async () => ({ hash: 'b'.repeat(64), height: 100 }) },
      hash,
      100,
      { pause: async () => assert.fail('Different hash must refuse immediately') },
    ),
    /different block hash/,
  );
});
