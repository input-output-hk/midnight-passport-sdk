import { createHash } from 'node:crypto';

const ledgerStateTag = Buffer.from('midnight:ledger-state[v18]:');
export const maximumLedgerSnapshotBytes = 16 * 1024 * 1024;
const maximumNodes = 250_000;
const digestBytes = 32;

const maximumRootKeyBytes = 16 * 1024;
const maximumInlineDepth = 64;

function scaleReader(snapshot: Uint8Array) {
  let offset = 0;
  function take(count: number): Uint8Array {
    const end = offset + count;
    if (end > snapshot.length) throw new Error('Truncated ledger encoding.');
    const result = snapshot.subarray(offset, end);
    offset = end;
    return result;
  }
  function compact(): number {
    const [first = 0] = take(1);
    const mode = first & 3;
    if (mode === 0) return first >>> 2;
    if (mode === 3) throw new Error('Oversized ledger encoding field.');
    const tail = take((1 << mode) - 1);
    let encoded = first;
    for (const [i, byte] of tail.entries()) encoded += byte * 2 ** (8 * (i + 1));
    const value = Math.floor(encoded / 4);
    if (value < (mode === 1 ? 64 : 16_384)) throw new Error('Noncanonical ledger encoding count.');
    return value;
  }

  return { take, compact, remaining: () => snapshot.length - offset };
}

function nodeHash(data: Uint8Array) {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(data.length);
  return createHash('sha256').update(length).update(data);
}

/** Normalize both ArenaKey variants returned by midnight_ledgerStateRoot. */
export function normalizeLedgerRootV18(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length > maximumRootKeyBytes)
    throw new Error('Invalid ledger root key length.');
  for (const byte of raw) {
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255)
      throw new Error('Invalid ledger root key bytes.');
  }
  const reader = scaleReader(Buffer.from(raw));
  function readKey(depth: number): Uint8Array {
    if (depth > maximumInlineDepth) throw new Error('Ledger root key nesting exceeds its limit.');
    const [variant] = reader.take(1);
    if (variant === 0) return reader.take(digestBytes);
    if (variant !== 1) throw new Error('Unknown ledger root key variant.');
    const hash = nodeHash(reader.take(reader.compact()));
    const children = reader.compact();
    if (children > 16) throw new Error('Too many ledger root key children.');
    for (let child = 0; child < children; child++) hash.update(readKey(depth + 1));
    return hash.digest();
  }
  const digest = readKey(0);
  if (reader.remaining() !== 0) throw new Error('Trailing ledger root key bytes.');
  return '00' + Buffer.from(digest).toString('hex');
}

// Node 2.1.0 with Ledger 9 rc.5 serializes its state as an arena DAG. Each
// node hashes its data length as a fixed LE u32, then its data and its child
// hashes in stored order. The envelope instead encodes counts as SCALE.
export function ledgerStateRootV18(snapshot: Uint8Array): string {
  if (
    snapshot.length > maximumLedgerSnapshotBytes ||
    !ledgerStateTag.every((byte, index) => byte === snapshot[index])
  )
    throw new Error('Unsupported ledger snapshot format or size.');

  const reader = scaleReader(snapshot.subarray(ledgerStateTag.length));
  const { take, compact } = reader;

  const nodes = compact();
  if (nodes < 1 || nodes > maximumNodes || nodes * 2 > reader.remaining())
    throw new Error('Invalid ledger snapshot node count.');
  const hashes = Buffer.allocUnsafe(nodes * digestBytes);
  const referenced = new Uint8Array(nodes);
  for (let node = 0; node < nodes; node++) {
    const childCount = compact();
    if (childCount > 16) throw new Error('Too many ledger snapshot children.');
    const children = Array.from({ length: childCount }, compact);
    const size = compact();
    const bytes = take(size);
    const hash = nodeHash(bytes);
    for (const child of children) {
      if (child >= node) throw new Error('Invalid ledger snapshot child order.');
      referenced[child] = 1;
      hash.update(hashes.subarray(child * digestBytes, (child + 1) * digestBytes));
    }
    hash.digest().copy(hashes, node * digestBytes);
  }
  if (reader.remaining() !== 0 || referenced.indexOf(0) !== nodes - 1)
    throw new Error('Ledger snapshot does not have one reachable root.');

  // Return the normalized commitment, using the referenced key encoding.
  return '00' + hashes.subarray(-digestBytes).toString('hex');
}
