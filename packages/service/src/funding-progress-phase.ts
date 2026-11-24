import type { FundingPhase, FundingProgress } from './funding-route.js';

export interface ProgressRecord {
  readonly balanceBefore: string;
  readonly preparationTxId?: string;
  readonly depositTxId?: string;
  readonly phase?: FundingPhase;
  readonly phaseStartedAt?: string;
}

const NONNEGATIVE_DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const MAX_AMOUNT = (1n << 128n) - 1n;
const validTxId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256;
const phases = new Set<FundingPhase>([
  'wallet-preparation',
  'wallet-prepared',
  'acc-proof',
  'wallet-balancing',
  'acc-submitted',
  'credit-confirmation',
]);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validate old phase-free journals as well as new observational progress. */
export function validProgressRecord(value: unknown): value is ProgressRecord {
  if (!record(value) || typeof value.balanceBefore !== 'string') return false;
  if (!NONNEGATIVE_DECIMAL.test(value.balanceBefore) || BigInt(value.balanceBefore) > MAX_AMOUNT)
    return false;
  if (value.preparationTxId !== undefined && !validTxId(value.preparationTxId)) return false;
  if (value.depositTxId !== undefined && !validTxId(value.depositTxId)) return false;
  if (value.phase === undefined) return value.phaseStartedAt === undefined;
  if (!phases.has(value.phase as FundingPhase)) return false;
  if (
    typeof value.phaseStartedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.phaseStartedAt))
  )
    return false;
  if (
    ['wallet-prepared', 'acc-proof', 'wallet-balancing'].includes(String(value.phase)) &&
    !value.preparationTxId
  )
    return false;
  if (['acc-submitted', 'credit-confirmation'].includes(String(value.phase)) && !value.depositTxId)
    return false;
  return true;
}

const withPhase = (value: ProgressRecord, phase: FundingPhase): ProgressRecord => ({
  ...value,
  phase,
  phaseStartedAt: new Date().toISOString(),
});

function balanceProgress(previous: ProgressRecord | undefined, balanceBefore: string) {
  if (
    !NONNEGATIVE_DECIMAL.test(balanceBefore) ||
    BigInt(balanceBefore) > MAX_AMOUNT ||
    (previous &&
      (previous.balanceBefore !== balanceBefore ||
        (previous.phase !== undefined && previous.phase !== 'wallet-preparation')))
  )
    throw new Error('funding initial balance is invalid or changed');
  return previous ?? withPhase({ balanceBefore }, 'wallet-preparation');
}

function preparedProgress(previous: ProgressRecord | undefined, preparationTxId: string) {
  if (
    !previous ||
    previous.depositTxId ||
    !validTxId(preparationTxId) ||
    (previous.phase !== undefined &&
      !['wallet-preparation', 'wallet-prepared'].includes(previous.phase))
  )
    throw new Error('funding preparation milestone is out of order');
  if (previous.preparationTxId && previous.preparationTxId !== preparationTxId)
    throw new Error('funding preparation transaction changed');
  return withPhase({ ...previous, preparationTxId }, 'wallet-prepared');
}

function proofProgress(previous: ProgressRecord | undefined) {
  if (
    !previous?.preparationTxId ||
    previous.depositTxId ||
    (previous.phase !== undefined && !['wallet-prepared', 'acc-proof'].includes(previous.phase))
  )
    throw new Error('ACC proof milestone is out of order');
  return withPhase(previous, 'acc-proof');
}

function balancingProgress(previous: ProgressRecord | undefined) {
  if (
    !previous?.preparationTxId ||
    previous.depositTxId ||
    !['acc-proof', 'wallet-balancing'].includes(previous.phase ?? '')
  )
    throw new Error('wallet balancing milestone is out of order');
  return withPhase(previous, 'wallet-balancing');
}

function submittedProgress(previous: ProgressRecord | undefined, txId: string) {
  if (
    !previous ||
    !validTxId(txId) ||
    (previous.depositTxId && previous.depositTxId !== txId) ||
    previous.phase === 'credit-confirmation'
  )
    throw new Error('funding submission milestone is out of order');
  return withPhase({ ...previous, depositTxId: txId }, 'acc-submitted');
}

function confirmationProgress(previous: ProgressRecord | undefined) {
  if (
    !previous?.depositTxId ||
    !['acc-submitted', 'credit-confirmation'].includes(previous.phase ?? '')
  )
    throw new Error('credit confirmation milestone is out of order');
  return withPhase(previous, 'credit-confirmation');
}

/** Phase labels never authorize release; the original transaction fence remains separate. */
export function advanceFundingProgress(
  previous: ProgressRecord | undefined,
  progress: Exclude<FundingProgress, { readonly stage: 'no-submit' | 'acc-not-submitted' }>,
): ProgressRecord {
  switch (progress.stage) {
    case 'balance-observed':
      return balanceProgress(previous, progress.balanceBefore);
    case 'prepared':
      return preparedProgress(previous, progress.preparationTxId);
    case 'proof-started':
      return proofProgress(previous);
    case 'balancing-started':
      return balancingProgress(previous);
    case 'submitted':
      return submittedProgress(previous, progress.txId);
    case 'credit-confirmation-started':
      return confirmationProgress(previous);
  }
}
