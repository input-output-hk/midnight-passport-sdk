import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { ledgerStateRootV18 } from '../src/ledger-state-root.ts';

const tag = Buffer.from('midnight:ledger-state[v18]:');
const envelope = (...bytes: number[]) => Buffer.concat([tag, Buffer.from(bytes)]);
const hash = (...bytes: Uint8Array[]) => {
  const digest = createHash('sha256');
  for (const value of bytes) digest.update(value);
  return digest.digest();
};

test('arena root commits to child order and little-endian lengths', () => {
  const first = hash(Buffer.of(1, 0, 0, 0), Buffer.of(21));
  const second = hash(Buffer.of(1, 0, 0, 0), Buffer.of(42));
  // Three nodes. Each starts with the SCALE child count and child indices.
  const graph = [12, 0, 4, 21, 0, 4, 42];
  assert.equal(
    ledgerStateRootV18(envelope(...graph, 8, 0, 4, 4, 63)),
    '00' + hash(Buffer.of(1, 0, 0, 0), Buffer.of(63), first, second).toString('hex'),
  );
  assert.notEqual(
    ledgerStateRootV18(envelope(...graph, 8, 0, 4, 4, 63)),
    ledgerStateRootV18(envelope(...graph, 8, 4, 0, 4, 63)),
  );
});

test('arena root rejects unbound and noncanonical graph encodings', () => {
  assert.throws(() => ledgerStateRootV18(envelope(4, 4, 0, 0)), /child order/);
  assert.throws(() => ledgerStateRootV18(envelope(8, 0, 0, 0, 0)), /reachable root/);
  assert.throws(() => ledgerStateRootV18(envelope(4, 0, 0, 0)), /reachable root/);
  assert.throws(() => ledgerStateRootV18(envelope(5, 0, 0, 0)), /Noncanonical/);
  assert.throws(() => ledgerStateRootV18(envelope(4, 0, 4)), /Truncated/);
  assert.throws(() => ledgerStateRootV18(Buffer.from('midnight:ledger-state[v17]:')), /format/);
});
