import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { ledgerStateRootV18, normalizeLedgerRootV18 } from '../src/ledger-state-root.ts';

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

test('inline and referenced node keys normalize to the same graph commitment', () => {
  const child = hash(Buffer.of(1, 0, 0, 0), Buffer.of(21));
  const graph = envelope(8, 0, 4, 21, 4, 0, 4, 63);
  const commitment = ledgerStateRootV18(graph);
  // A direct key encodes data before children. Its child can be either kind.
  const direct = [1, 4, 63, 4, 1, 4, 21, 0];
  const mixed = [1, 4, 63, 4, 0, ...child];
  assert.equal(normalizeLedgerRootV18(direct), commitment);
  assert.equal(normalizeLedgerRootV18(mixed), commitment);
  assert.equal(normalizeLedgerRootV18([...Buffer.from(commitment, 'hex')]), commitment);
  assert.notEqual(normalizeLedgerRootV18([1, 4, 64, 4, 0, ...child]), commitment);
});

test('refuses truncated, oversized, ambiguous or malformed node keys', () => {
  assert.throws(() => normalizeLedgerRootV18([1, 0, 4, 0]), /truncated/i);
  assert.throws(() => normalizeLedgerRootV18([1, 1, 0, 0]), /noncanonical/i);
  assert.throws(() => normalizeLedgerRootV18([1, 0, 0, 0]), /trailing/i);
  assert.throws(() => normalizeLedgerRootV18([2]), /variant/i);
  assert.throws(() => normalizeLedgerRootV18([1, -1, 0]), /bytes/i);
  assert.throws(() => normalizeLedgerRootV18(Array<number>(16_385).fill(0)), /length/i);
  const nested = Array.from({ length: 65 }, () => [1, 0, 4]).flat();
  assert.throws(() => normalizeLedgerRootV18([...nested, 1, 0, 0]), /nesting/i);
});
