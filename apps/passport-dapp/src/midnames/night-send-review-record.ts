import type { NightSendIntent, NightSendLeg, NightUnresolvedObservation } from './night-send.js';
import type { NightRecoveryReview } from './night-send-journal.js';

const hex32 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export const unresolvedReason = (value: unknown): value is NightUnresolvedObservation['reason'] =>
  typeof value === 'string' &&
  ['Absent', 'InvalidRecord', 'Expired', 'Unavailable', 'UnsupportedTarget'].includes(value);

function reviewIdentity(
  row: Record<string, unknown>,
  intent: NightSendIntent,
  withdrawal: NightSendLeg,
): row is Record<string, unknown> & { approvedAt: string } {
  return (
    row.name === intent.name &&
    row.networkId === intent.networkId &&
    row.providerId === intent.providerId &&
    row.namespace === intent.namespace &&
    row.originalTarget === intent.target &&
    (row.originalBindingId === undefined || row.originalBindingId === intent.recipientBindingId) &&
    row.withdrawalHash === withdrawal.hash &&
    typeof row.approvedAt === 'string' &&
    Number.isFinite(Date.parse(row.approvedAt))
  );
}

function reviewTarget(row: Record<string, unknown>, intent: NightSendIntent): boolean {
  if (row.currentBindingId !== undefined) {
    if (
      row.unresolvedReason !== undefined ||
      !hex32(row.currentTarget) ||
      !['acc-s3r1.1', 'acc-s3r1.1-zkir036'].includes(String(row.currentBindingId))
    )
      return false;
  }
  if (row.unresolvedReason === undefined)
    return hex32(row.currentTarget) && row.currentTarget !== intent.target;
  return (
    unresolvedReason(row.unresolvedReason) &&
    (row.currentTarget === undefined || hex32(row.currentTarget)) &&
    (row.unresolvedReason !== 'UnsupportedTarget' || hex32(row.currentTarget)) &&
    (row.unresolvedReason === 'UnsupportedTarget' ||
      row.unresolvedReason === 'Unavailable' ||
      row.currentTarget === undefined)
  );
}

export function checkedRecoveryReviews(
  value: unknown,
  intent: NightSendIntent,
  withdrawal: NightSendLeg | undefined,
): readonly NightRecoveryReview[] | undefined {
  if (value === undefined) return undefined;
  if (!withdrawal || !Array.isArray(value) || value.length === 0 || value.length > 32)
    throw new Error('Stored NIGHT deposit recovery reviews are invalid.');
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('Stored NIGHT deposit recovery review is invalid.');
    const row = item as Record<string, unknown>;
    if (!reviewIdentity(row, intent, withdrawal) || !reviewTarget(row, intent))
      throw new Error('Stored NIGHT deposit recovery review is invalid.');
    return {
      name: intent.name,
      networkId: 'undeployed',
      providerId: intent.providerId,
      namespace: 'night',
      originalTarget: intent.target,
      ...(intent.recipientBindingId && { originalBindingId: intent.recipientBindingId }),
      ...(typeof row.currentTarget === 'string' ? { currentTarget: row.currentTarget } : {}),
      ...(typeof row.currentTarget === 'string' &&
        row.unresolvedReason === undefined && {
          currentBindingId:
            (row.currentBindingId as string | undefined) ?? intent.recipientBindingId,
        }),
      ...(unresolvedReason(row.unresolvedReason) ? { unresolvedReason: row.unresolvedReason } : {}),
      withdrawalHash: withdrawal.hash,
      approvedAt: row.approvedAt,
    };
  });
}
