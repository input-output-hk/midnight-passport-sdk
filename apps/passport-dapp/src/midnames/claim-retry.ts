import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type { ClaimJournal } from './claim-journal.js';
import { reviewedDispatchQuote } from './claim-quote.js';
import type { ClaimReceipt, ClaimRecovery } from './claim-receipt.js';

export async function releaseVerifiedFailure(
  recovery: ClaimRecovery,
  journal: ClaimJournal,
  original: ClaimReceipt,
  account: PassportAccount,
  selected: string,
  scope: string,
  ensureAccount: () => void,
) {
  const result = await recovery.check(original).catch(() => 'unavailable' as const);
  if (result !== 'failed' && result !== 'claim-failed')
    throw new Error('The original failure is no longer confirmed. Preserve its receipt.');
  ensureAccount();
  const availability = await recovery
    .availability(selected, account.address)
    .catch(() => undefined);
  ensureAccount();
  if (availability !== 'available')
    throw new Error('Registry availability is not confirmed. Preserve the original receipt.');
  if ((await recovery.check(original).catch(() => 'unavailable' as const)) !== result)
    throw new Error('The original failure changed. Preserve its receipt.');
  ensureAccount();
  if (recovery.preparation) {
    const retire = recovery.preparation.retireIndexedFailure;
    if (!retire || (await retire(original)) !== result)
      throw new Error('The sponsor did not archive this exact failed original.');
    ensureAccount();
  }
  if (
    (await recovery.check(original).catch(() => 'unavailable' as const)) !== result ||
    (await recovery.availability(selected, account.address).catch(() => undefined)) !== 'available'
  )
    throw new Error('The failed original changed after sponsor retirement. Preserve its receipt.');
  ensureAccount();
  await journal.releaseFailed(
    original,
    scope,
    result === 'claim-failed' ? 'CLAIM_SEGMENT_FAILURE' : 'FAILURE',
  );
  ensureAccount();
}

export async function releaseExpiredUnsent(
  recovery: ClaimRecovery,
  journal: ClaimJournal,
  original: ClaimReceipt,
  account: PassportAccount,
  scope: string,
  ensureAccount: () => void,
) {
  const retire = recovery.preparation?.retireExpiredUnsent;
  const saved = await journal.readPreparation(original.registryAddress, original.name, scope);
  const quote = await reviewedDispatchQuote(original, saved);
  if (!retire || !quote) throw new Error('The original quote is unavailable for safe retirement.');
  if ((await recovery.check(original).catch(() => 'unavailable' as const)) !== 'pending')
    throw new Error('The original claim changed. Preserve its receipt.');
  if ((await recovery.availability(original.name, account.address)) !== 'available')
    throw new Error('Registry availability is not confirmed. Preserve the original receipt.');
  ensureAccount();
  await retire(original);
  ensureAccount();
  await journal.releaseFailed(original, scope, 'EXPIRED_UNSENT');
  ensureAccount();
}

/** Return a fresh start only after exact, repeated checks preserve the old original. */
export async function settleOriginalForReview(
  recovery: ClaimRecovery,
  journal: ClaimJournal,
  original: ClaimReceipt,
  account: PassportAccount,
  selected: string,
  scope: string,
  ensureAccount: () => void,
): Promise<'start-fresh' | 'resume-prepared' | 'inspect'> {
  const result = await recovery.check(original).catch(() => 'unavailable' as const);
  ensureAccount();
  if (result === 'failed' || result === 'claim-failed') return 'inspect';
  if (result !== 'pending') return 'inspect';
  const sponsor = await recovery.preparation?.dispatchStatus?.(original).catch(() => undefined);
  ensureAccount();
  if (sponsor !== 'prepared' && sponsor !== 'retired') return 'inspect';
  try {
    await releaseExpiredUnsent(recovery, journal, original, account, scope, ensureAccount);
    return 'start-fresh';
  } catch {
    if (sponsor !== 'prepared') return 'inspect';
    const stillPending =
      (await recovery.check(original).catch(() => 'unavailable' as const)) === 'pending';
    const stillPrepared =
      (await recovery.preparation?.dispatchStatus?.(original).catch(() => undefined)) ===
      'prepared';
    const stillAvailable =
      (await recovery.availability(selected, account.address).catch(() => undefined)) ===
      'available';
    ensureAccount();
    return stillPending && stillPrepared && stillAvailable ? 'resume-prepared' : 'inspect';
  }
}
