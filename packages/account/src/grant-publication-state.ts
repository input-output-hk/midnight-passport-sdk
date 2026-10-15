import type { StagedJubjubGrant } from './jubjub-grant-issue.js';
import type { GrantBookkeeping, OpenedInboxEntry } from './ports/index.js';

export const validGrantId = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);

export function grantObjectMatches(
  candidate: GrantBookkeeping['object'],
  expected: GrantBookkeeping['object'],
): boolean {
  if (
    candidate.color !== expected.color ||
    candidate.maxCoinValue !== expected.maxCoinValue ||
    candidate.recipient.kind !== expected.recipient.kind
  )
    return false;
  return (
    candidate.recipient.kind === 'any' ||
    (expected.recipient.kind !== 'any' && candidate.recipient.value === expected.recipient.value)
  );
}

/** A matching salt distinguishes a reissued grant from an older record at the same id. */
export function publishedGrantParts(
  opened: readonly (OpenedInboxEntry | null)[],
  grant: GrantBookkeeping,
): { header: boolean; object: boolean } {
  let header = false;
  let object = false;
  for (const entry of opened) {
    if (entry?.kind !== 'grant' || entry.record.grantId !== grant.grantId) continue;
    if (entry.record.part === 'grant' && entry.record.scopeSalt === grant.scopeSalt) header = true;
    if (entry.record.part === 'object' && grantObjectMatches(entry.record.object, grant.object))
      object = true;
  }
  return { header, object };
}

/** Refuse a corrupt or read-capable write-ahead opening before publishing any ACC inbox entry. */
export function isPublishableUnshieldedGrant(
  staged: StagedJubjubGrant | undefined,
  account: string,
  grantId: string,
): staged is StagedJubjubGrant {
  return !!(
    staged &&
    staged.account === account &&
    staged.bookkeeping.grantId === grantId &&
    validGrantId(staged.bookkeeping.scopeSalt) &&
    Number.isInteger(staged.bookkeeping.slot) &&
    staged.bookkeeping.slot >= 0 &&
    staged.bookkeeping.slot <= 255 &&
    staged.bookkeeping.granteePublicKey === staged.scope.grantee.publicKey &&
    grantObjectMatches(staged.bookkeeping.object, {
      color: staged.scope.color,
      recipient: staged.scope.recipient,
      maxCoinValue: staged.scope.maxCoinValue,
    }) &&
    !staged.scope.read &&
    staged.scope.operations.length === 1 &&
    staged.scope.operations[0] === 'withdraw-unshielded'
  );
}
