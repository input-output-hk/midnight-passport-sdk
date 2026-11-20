import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { indexedClaimBlock } from './claim-indexed-failure.mjs';

const raw = '0001';
const identifier = '00' + '12'.repeat(32);
const receipt = {
  transaction: {
    identifiers: [identifier],
    sha256: createHash('sha256').update(Buffer.from(raw, 'hex')).digest('hex'),
  },
};
const block = { hash: 'ab'.repeat(32), height: 12 };
const row = {
  __typename: 'RegularTransaction',
  protocolVersion: 2001100,
  hash: 'cd'.repeat(32),
  raw,
  identifiers: [identifier],
  block,
};

test('a canonical block observation stays scoped to the exact original raw and identifiers', () => {
  assert.deepEqual(indexedClaimBlock(row, receipt, 2001100), block);
  for (const different of [
    { raw: '0002' },
    { identifiers: ['00' + '34'.repeat(32)] },
    { identifiers: [identifier, identifier] },
    { protocolVersion: 2001000 },
    { __typename: 'SystemTransaction' },
    { block: { ...block, hash: '0x' + block.hash } },
    { block: { ...block, height: 0 } },
  ])
    assert.equal(indexedClaimBlock({ ...row, ...different }, receipt, 2001100), undefined);
});
