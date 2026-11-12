import { createHash } from 'node:crypto';

const ledgerStateTag = Buffer.from('midnight:ledger-state[v18]:');
export const maximumLedgerSnapshotBytes = 16 * 1024 * 1024;
const maximumNodes = 250_000;
const digestBytes = 32;

// Node 2.1.0 with Ledger 9 rc.5 serializes its state as an arena DAG. Each
// node hashes its data length as a fixed LE u32, then its data and its child
// hashes in stored order. The envelope instead encodes counts as SCALE.
export function ledgerStateRootV18(snapshot: Uint8Array): string {
  if (
    snapshot.length > maximumLedgerSnapshotBytes ||
    !ledgerStateTag.every((byte, index) => byte === snapshot[index])
  )
    throw new Error('Unsupported ledger snapshot format or size.');

  let offset = ledgerStateTag.length;
  function take(count: number): Uint8Array {
    const end = offset + count;
    if (end > snapshot.length) throw new Error('Truncated ledger snapshot.');
    const result = snapshot.subarray(offset, end);
    offset = end;
    return result;
  }
  function compact(): number {
    const [first = 0] = take(1);
    const mode = first & 3;
    if (mode === 0) return first >>> 2;
    if (mode === 3) throw new Error('Oversized ledger snapshot field.');
    const tail = take((1 << mode) - 1);
    let encoded = first;
    for (const [i, byte] of tail.entries()) encoded += byte * 2 ** (8 * (i + 1));
    const value = Math.floor(encoded / 4);
    if (value < (mode === 1 ? 64 : 16_384)) throw new Error('Noncanonical ledger snapshot count.');
    return value;
  }

  const nodes = compact();
  if (nodes < 1 || nodes > maximumNodes || nodes * 2 > snapshot.length - offset)
    throw new Error('Invalid ledger snapshot node count.');
  const hashes = Buffer.allocUnsafe(nodes * digestBytes);
  const referenced = new Uint8Array(nodes);
  const length = Buffer.alloc(4);
  for (let node = 0; node < nodes; node++) {
    const childCount = compact();
    if (childCount > 16) throw new Error('Too many ledger snapshot children.');
    const children = Array.from({ length: childCount }, compact);
    const size = compact();
    const bytes = take(size);
    length.writeUInt32LE(size);
    const hash = createHash('sha256').update(length).update(bytes);
    for (const child of children) {
      if (child >= node) throw new Error('Invalid ledger snapshot child order.');
      referenced[child] = 1;
      hash.update(hashes.subarray(child * digestBytes, (child + 1) * digestBytes));
    }
    hash.digest().copy(hashes, node * digestBytes);
  }
  if (offset !== snapshot.length || referenced.indexOf(0) !== nodes - 1)
    throw new Error('Ledger snapshot does not have one reachable root.');

  // LedgerState has a by-reference arena key, encoded as discriminant 0
  // followed by the digest. This is not the Zswap commitment tree root.
  return '00' + hashes.subarray(-digestBytes).toString('hex');
}
