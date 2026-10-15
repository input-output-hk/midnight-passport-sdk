import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHeldCoinWitness } from '../packages/adapter-midnight-js/dist/index.js';

const color = Uint8Array.from({ length: 32 }, () => 7);
const coin = () => ({
  nonce: Uint8Array.from({ length: 32 }, () => 3),
  color: color.slice(),
  value: 9n,
  mt_index: 4n,
});

test('held_coin is pinned to one validated color and cannot be changed through returned arrays', () => {
  const source = coin();
  const witness = createHeldCoinWitness(source);
  source.color.fill(8);
  source.nonce.fill(8);
  const state = { marker: 'private' };
  const [nextState, first] = witness.held_coin({ privateState: state }, color);
  assert.equal(nextState, state);
  assert.deepEqual(first, coin());
  first.color.fill(9);
  first.nonce.fill(9);
  assert.deepEqual(witness.held_coin({ privateState: state }, color)[1], coin());
  assert.throws(() => witness.held_coin({ privateState: state }, new Uint8Array(32)), {
    code: 'TransferInvalid',
  });
});

test('held_coin refuses missing, malformed and out-of-range private inputs', () => {
  assert.throws(() => createHeldCoinWitness().held_coin({ privateState: null }, color), {
    code: 'BindingUnsupported',
  });
  for (const invalid of [
    { ...coin(), nonce: new Uint8Array(31) },
    { ...coin(), value: -1n },
    { ...coin(), value: 1n << 128n },
    { ...coin(), mt_index: -1n },
    { ...coin(), mt_index: 1n << 64n },
  ]) {
    assert.throws(() => createHeldCoinWitness(invalid), { code: 'TransferInvalid' });
  }
});
