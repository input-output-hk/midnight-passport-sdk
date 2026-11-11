import type { AlignedValue, Op } from '@midnightntwrk/ledger-v9';
import type { ClaimScope } from './claim-receipt.js';

// Ledger slots in the pinned standalone registry. The map insertions are the
// public effect of create_domain, independent of the private witness.
const nameToId = 3;
const idToData = 4;

function inserts(program: readonly Op<AlignedValue>[], slot: number) {
  return program.flatMap((operation, i) => {
    if (typeof operation === 'string' || !('idx' in operation)) return [];
    const [path, ...rest] = operation.idx.path;
    if (
      rest.length ||
      path?.tag !== 'value' ||
      path.value.value.length !== 1 ||
      path.value.value[0]?.length !== 1 ||
      path.value.value[0][0] !== slot
    )
      return [];
    const [key, value, insert] = program.slice(i + 1, i + 4);
    if (
      !key ||
      typeof key === 'string' ||
      !('push' in key) ||
      key.push.storage ||
      key.push.value.tag !== 'cell' ||
      !value ||
      typeof value === 'string' ||
      !('push' in value) ||
      !value.push.storage ||
      value.push.value.tag !== 'cell' ||
      !insert ||
      typeof insert === 'string' ||
      !('ins' in insert) ||
      insert.ins.n !== 1
    )
      return [];
    return [{ key: key.push.value.content.value, value: value.push.value.content.value }];
  });
}

function sameBytes(value: Uint8Array | undefined, expected: Uint8Array): boolean {
  return (
    !!value && value.length === expected.length && value.every((byte, i) => byte === expected[i])
  );
}

function matchesBytes32(value: Uint8Array | undefined, expected: string): boolean {
  if (!value || value.length > 32) return false;
  return (
    Array.from({ length: 32 }, (_, i) => (value[i] ?? 0).toString(16).padStart(2, '0')).join('') ===
    expected
  );
}

/** Check the same new domain ID connects the root label to the stored owner and contract target. */
export function matchesClaimWrites(
  programs: readonly (readonly Op<AlignedValue>[])[],
  original: ClaimScope,
): boolean {
  const label = new Uint8Array(32).fill(255);
  label.set(new TextEncoder().encode(original.name.slice(0, -'.night'.length)));
  const names = programs.flatMap((p) => inserts(p, nameToId));
  const domains = programs.flatMap((p) => inserts(p, idToData));
  const [name] = names;
  const [domain] = domains;
  return (
    names.length === 1 &&
    domains.length === 1 &&
    !!name &&
    !!domain &&
    name.key.length === 2 &&
    sameBytes(name.key[0], label) &&
    name.key[1]?.length === 0 && // Root zone ID.
    name.value.length === 1 &&
    !!name.value[0]?.length &&
    domain.key.length === 1 &&
    sameBytes(domain.key[0], name.value[0]) &&
    domain.value.length === 13 &&
    matchesBytes32(domain.value[0], original.ownerCommitment) &&
    matchesBytes32(domain.value[2], original.accountAddress) &&
    domain.value[3]?.length === 0 // ContractAddr enum arm.
  );
}
