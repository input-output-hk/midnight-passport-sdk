import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Wait for one exact node-finalized block; an older indexed tip is never a substitute.
 * @param {{queryBlock(offset: {type: 'blockHash', blockHash: string}): Promise<{hash: string, height: number} | null>}} indexer
 * @param {string} blockHash
 * @param {number} height
 * @param {{attempts?: number, pause?: () => Promise<void>}} [options]
 */
export async function waitForFinalizedIndexerBlock(
  indexer,
  blockHash,
  height,
  { attempts = 20, pause = () => delay(1_000) } = {},
) {
  assert.match(blockHash, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(height) && height >= 0);
  assert.ok(Number.isSafeInteger(attempts) && attempts >= 1 && attempts <= 30);
  for (let attempt = 0; attempt < attempts; attempt++) {
    let block;
    try {
      block = await indexer.queryBlock({ type: 'blockHash', blockHash });
    } catch {
      // A transient unavailable offset may be indexed on the next attempt.
    }
    if (block) {
      assert.equal(block.hash, blockHash, 'Indexer returned a different block hash.');
      assert.equal(block.height, height, 'Indexer returned a different block height.');
      return block;
    }
    if (attempt + 1 < attempts) await pause();
  }
  throw new Error('Indexer did not reach the exact node-finalized block.');
}
