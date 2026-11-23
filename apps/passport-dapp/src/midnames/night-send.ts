import {
  PassportNameError,
  resolvePassportName,
  type PassportNameService,
} from '@input-output-hk/mn-passport-account/names';
import type { PreparedValueSubmission } from '@input-output-hk/mn-passport-protocol';

const ADDRESS = /^[a-f0-9]{64}$/;
const isToken = (value: unknown, pattern: RegExp): value is string =>
  typeof value === 'string' && pattern.test(value);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const NIGHT_SEND_OPERATIONS = Object.freeze([
  'withdraw_unshielded_with_jubjub',
  'deposit_unshielded',
] as const);

export interface NightSendRequest {
  readonly requestId: string;
  readonly name: string;
  readonly networkId: string;
  readonly source: string;
  readonly bridge: string;
  readonly asset: string;
  readonly amount: string;
}

export interface NightSendIntent extends NightSendRequest {
  readonly target: string;
  readonly providerId: string;
  readonly namespace: string;
  readonly operations: typeof NIGHT_SEND_OPERATIONS;
}

export interface NightSendLeg {
  readonly hash: string;
  readonly identifiers: readonly string[];
}

export type NightUnresolvedReason =
  'Absent' | 'InvalidRecord' | 'Expired' | 'Unavailable' | 'UnsupportedTarget';

/** A fresh name lookup that cannot authorize a new named destination. */
export interface NightUnresolvedObservation {
  readonly reason: NightUnresolvedReason;
  readonly currentTarget?: string;
}

export interface NightSendJournal {
  readIntent(): Promise<NightSendIntent | undefined>;
  /** Exclusively create. A losing writer must fail before preparing a payment. */
  createIntent(intent: NightSendIntent): Promise<void>;
  readLeg(leg: 'withdraw' | 'deposit'): Promise<NightSendLeg | undefined>;
  /** Atomically and durably reserve a leg. A duplicate writer must fail. */
  fenceLeg(leg: 'withdraw' | 'deposit', original: NightSendLeg): Promise<void>;
  /** Durably mark entry into the owner API before signing or submission can begin. */
  markOwnerStarted?(intent: NightSendIntent): Promise<void>;
  /** Archive a name-recheck refusal only before the owner API was entered. */
  retireRefused?(intent: NightSendIntent, reason: 'name-recheck'): Promise<void>;
  /** Reconcile only a proven pre-credential fence rejection; keep its history. */
  retireUnsupportedFence?(intent: NightSendIntent): Promise<void>;
  /** Durably pin each approved post-withdrawal mapping before another deposit proof. */
  recordRecoveryReview?(
    original: NightSendIntent,
    current: NightSendIntent | NightUnresolvedObservation,
    withdrawal: NightSendLeg,
  ): Promise<void>;
}

export class NightDepositInterrupted extends Error {
  constructor(
    readonly withdrawal: NightSendLeg,
    cause: unknown,
  ) {
    super(
      cause instanceof NightSendPreflightError && cause.code === 'NightNameChanged'
        ? 'The name changed during deposit recovery. The original withdrawal is saved; review the current destination before retrying only its deposit.'
        : 'The withdrawal finalized. Inspect the original intent before continuing the deposit.',
      { cause },
    );
    this.name = 'NightDepositInterrupted';
  }
}

export class NightPaymentDeclined extends Error {
  constructor() {
    super('NIGHT payment declined.');
    this.name = 'NightPaymentDeclined';
  }
}

type NightSendPreflightCode =
  | 'NightUnsupportedRoute'
  | 'NightNameUnavailable'
  | 'NightNameChanged'
  | 'NightSelfRecipient'
  | 'NightRecipientUnsupported'
  | 'NightSourceUnsupported'
  | 'NightInsufficientBalance';

/** Fixed, user-facing refusal categories before any owner approval or transaction. */
export class NightSendPreflightError extends Error {
  constructor(
    readonly code: NightSendPreflightCode,
    message: string,
  ) {
    super(message);
    this.name = 'NightSendPreflightError';
  }
}

interface PreparedLeg {
  readonly original: NightSendLeg;
  dispatch(): Promise<void>;
}

interface NightSendCorePorts {
  readonly names: PassportNameService;
  readonly journal: NightSendJournal;
  /** Verify the recipient activation and pinned binding independently of the name-service result. */
  isSupportedRecipient(address: string, networkId: string): Promise<boolean>;
  /** Return undefined for a source that fails the pinned binding and activation checks. */
  readSourceBalance(source: string): Promise<bigint | undefined>;
  review(intent: NightSendIntent, observedBalance: bigint): Promise<boolean>;
  /** A finalized withdrawal may finish at its originally reviewed ACC after a name repoint, but only after a fresh, explicit review. */
  reviewOriginalDeposit?(
    original: NightSendIntent,
    current: NightSendIntent,
    withdrawal: NightSendLeg,
  ): Promise<boolean>;
  /** Explicit direct-ACC repair when the current name cannot authorize a named route. */
  reviewUnresolvedOriginalDeposit?(
    original: NightSendIntent,
    observation: NightUnresolvedObservation,
    withdrawal: NightSendLeg,
  ): Promise<boolean>;
  /** Prepare a deposit funded by the original withdrawal output to the controlled wallet. */
  prepareDeposit(intent: NightSendIntent, withdrawal: NightSendLeg): Promise<PreparedLeg>;
  /** Require canonical successful finality for the exact prepared transaction. */
  finalized(original: NightSendLeg): Promise<boolean>;
}

type NightSendPorts = NightSendCorePorts &
  (
    | {
        /** Standalone wallet fixture, which prepares an original transaction before dispatch. */
        prepareWithdrawal(intent: NightSendIntent): Promise<PreparedLeg>;
        readonly submitWithdrawal?: undefined;
      }
    | {
        /** Account API path: the callback must be awaited immediately before its only dispatch. */
        submitWithdrawal(
          intent: NightSendIntent,
          beforeSubmit: (submission: PreparedValueSubmission) => Promise<void>,
        ): Promise<void>;
        readonly prepareWithdrawal?: undefined;
      }
  );

type OwnerSubmit = NonNullable<NightSendPorts['submitWithdrawal']>;
type PrepareWithdrawal = NonNullable<NightSendPorts['prepareWithdrawal']>;
type MarkOwnerStarted = NonNullable<NightSendJournal['markOwnerStarted']>;
type RetireRefusal = NonNullable<NightSendJournal['retireRefused']>;

function validate(request: NightSendRequest) {
  if (
    request.networkId !== 'undeployed' ||
    request.asset !== 'NIGHT' ||
    !isToken(request.requestId, UUID) ||
    !isToken(request.source, ADDRESS) ||
    !isToken(request.bridge, ADDRESS) ||
    !isToken(request.amount, /^[1-9][0-9]{0,38}$/) ||
    BigInt(request.amount) >= 1n << 128n
  )
    throw new NightSendPreflightError(
      'NightUnsupportedRoute',
      'Unsupported or invalid standalone NIGHT payment.',
    );
}

async function resolveIntent(
  request: NightSendRequest,
  ports: Pick<NightSendPorts, 'names' | 'isSupportedRecipient'>,
) {
  const target = await resolvePassportName(ports.names, request);
  if (!target || target.mode !== 'external')
    throw new NightSendPreflightError(
      'NightNameUnavailable',
      'The name must resolve to a different supported Passport ACC.',
    );
  if (target.accountAddress === request.source)
    throw new NightSendPreflightError(
      'NightSelfRecipient',
      'The name must resolve to a different supported Passport ACC.',
    );
  if ((await ports.isSupportedRecipient(target.accountAddress, request.networkId)) !== true)
    throw new NightSendPreflightError(
      'NightRecipientUnsupported',
      'The named recipient is not an activated, supported Passport ACC.',
    );
  return Object.freeze({
    ...request,
    target: target.accountAddress,
    providerId: target.providerId,
    namespace: target.namespace,
    operations: NIGHT_SEND_OPERATIONS,
  });
}

async function observeRecovery(
  intent: NightSendIntent,
  ports: Pick<NightSendPorts, 'names' | 'isSupportedRecipient'>,
): Promise<NightSendIntent | NightUnresolvedObservation> {
  const provider = ports.names.provider;
  const sameProvider = () =>
    provider.id === intent.providerId &&
    provider.namespace === intent.namespace &&
    provider.mode === 'external' &&
    ports.names.provider === provider;
  if (!sameProvider())
    throw new NightSendPreflightError('NightNameChanged', 'The original name provider changed.');
  let target;
  try {
    target = await resolvePassportName(ports.names, intent);
  } catch (error) {
    if (!(error instanceof PassportNameError) || error.code === 'InvalidQuery') throw error;
    if (!sameProvider())
      throw new NightSendPreflightError('NightNameChanged', 'The original name provider changed.');
    return { reason: error.code };
  }
  if (!sameProvider() || (target && target.providerId !== intent.providerId))
    throw new NightSendPreflightError('NightNameChanged', 'The original name provider changed.');
  if (!target) return { reason: 'Absent' };
  if (target.mode !== 'external' || target.namespace !== intent.namespace)
    throw new NightSendPreflightError('NightNameChanged', 'The original name provider changed.');
  if (target.accountAddress === intent.source)
    return { reason: 'UnsupportedTarget', currentTarget: target.accountAddress };
  let supported: boolean;
  try {
    supported = await ports.isSupportedRecipient(target.accountAddress, intent.networkId);
  } catch {
    if (!sameProvider())
      throw new NightSendPreflightError('NightNameChanged', 'The original name provider changed.');
    return { reason: 'Unavailable', currentTarget: target.accountAddress };
  }
  if (!sameProvider())
    throw new NightSendPreflightError('NightNameChanged', 'The original name provider changed.');
  if (!supported) return { reason: 'UnsupportedTarget', currentTarget: target.accountAddress };
  return { ...intent, target: target.accountAddress };
}

function sameObservation(
  reviewed: NightSendIntent | NightUnresolvedObservation,
  current: NightSendIntent | NightUnresolvedObservation,
) {
  if ('reason' in reviewed || 'reason' in current)
    return (
      'reason' in reviewed &&
      'reason' in current &&
      reviewed.reason === current.reason &&
      reviewed.currentTarget === current.currentTarget
    );
  return (
    reviewed.target === current.target &&
    reviewed.providerId === current.providerId &&
    reviewed.namespace === current.namespace
  );
}

function assertSameIntent(a: NightSendIntent, b: NightSendIntent) {
  if (
    a.requestId !== b.requestId ||
    a.source !== b.source ||
    a.bridge !== b.bridge ||
    a.asset !== b.asset ||
    a.amount !== b.amount ||
    a.networkId !== b.networkId ||
    a.name !== b.name ||
    a.target !== b.target ||
    a.providerId !== b.providerId ||
    a.namespace !== b.namespace ||
    a.operations.length !== b.operations.length ||
    a.operations.some((op, i) => op !== b.operations[i])
  )
    throw new Error('The original payment scope changed. Inspect the retained intent.');
}

function checkedLeg(leg: NightSendLeg): NightSendLeg {
  if (
    !isToken(leg.hash, ADDRESS) ||
    !Array.isArray(leg.identifiers) ||
    leg.identifiers.length === 0 ||
    leg.identifiers.length > 32 ||
    leg.identifiers.some((id) => !isToken(id, /^[a-f0-9]{66}$/))
  )
    throw new Error('Invalid Ledger 9 transaction identity.');
  return Object.freeze({ hash: leg.hash, identifiers: Object.freeze([...leg.identifiers]) });
}

function requireDistinctLegs(withdrawal: NightSendLeg, deposit: NightSendLeg) {
  if (withdrawal.hash === deposit.hash)
    throw new Error('Withdrawal and deposit require distinct transactions.');
}

async function submitLeg(
  leg: 'withdraw' | 'deposit',
  intent: NightSendIntent,
  prepared: PreparedLeg,
  ports: NightSendPorts,
  prior?: NightSendLeg,
  recoveryObservation?: NightSendIntent | NightUnresolvedObservation,
) {
  const original = checkedLeg(prepared.original);
  if (prior) requireDistinctLegs(prior, original);
  if (recoveryObservation) {
    const current = await observeRecovery(intent, ports);
    if (!sameObservation(recoveryObservation, current))
      throw new NightSendPreflightError(
        'NightNameChanged',
        'The name changed again during deposit recovery. Review the destination again.',
      );
    if (!(await ports.isSupportedRecipient(intent.target, intent.networkId)))
      throw new NightSendPreflightError(
        'NightRecipientUnsupported',
        'The originally reviewed ACC no longer has a supported binding.',
      );
  } else assertSameIntent(intent, await resolveIntent(intent, ports));
  await ports.journal.fenceLeg(leg, original);
  try {
    await prepared.dispatch();
  } catch {
    // The submission response can be lost after admission. Reconcile the original only.
  }
  return original;
}

async function submitOwnerWithdrawal(
  intent: NightSendIntent,
  ports: NightSendPorts,
  submitWithdrawal: OwnerSubmit,
) {
  let original: NightSendLeg | undefined;
  try {
    await submitWithdrawal(intent, async (submission) => {
      if (original) throw new Error('The original NIGHT withdrawal is already fenced.');
      if (
        submission.networkId !== intent.networkId ||
        submission.account !== intent.source ||
        submission.circuit !== NIGHT_SEND_OPERATIONS[0]
      )
        throw new Error('The finalized NIGHT withdrawal differs from the reviewed source.');
      const checked = checkedLeg({
        hash: submission.transactionHash,
        identifiers: submission.identifiers,
      });
      assertSameIntent(intent, await resolveIntent(intent, ports));
      await ports.journal.fenceLeg('withdraw', checked);
      original = checked;
    });
  } catch (error) {
    // Once the original is durable, a lost submit response is uncertain: look it up, never resend.
    if (!original) throw error;
  }
  if (!original)
    throw new Error('The owner withdrawal returned without an original transaction ID.');
  return original;
}

async function recheckBeforeOwnerWithdrawal(
  intent: NightSendIntent,
  request: NightSendRequest,
  ports: NightSendPorts,
  ownerRoute: boolean,
  retireRefused: RetireRefusal | undefined,
) {
  try {
    const resolved = await resolveIntent(request, ports);
    if (
      resolved.target !== intent.target ||
      resolved.providerId !== intent.providerId ||
      resolved.namespace !== intent.namespace
    )
      throw new NightSendPreflightError(
        'NightNameChanged',
        'The original payment scope changed after review. Review the named destination again.',
      );
    assertSameIntent(intent, resolved);
  } catch (error) {
    if (ownerRoute) await retireRefused?.(intent, 'name-recheck');
    throw error;
  }
}

async function submitSelectedWithdrawal(
  intent: NightSendIntent,
  ports: NightSendPorts,
  submitWithdrawal: OwnerSubmit | undefined,
  prepareWithdrawal: PrepareWithdrawal | undefined,
  markOwnerStarted: MarkOwnerStarted | undefined,
  retireRefused: RetireRefusal | undefined,
) {
  if (submitWithdrawal) {
    if (retireRefused && !markOwnerStarted)
      throw new Error('The owner journal cannot mark a submission attempt.');
    await markOwnerStarted?.(intent);
    return submitOwnerWithdrawal(intent, ports, submitWithdrawal);
  }
  if (!prepareWithdrawal) throw new Error('The withdrawal preparation port is unavailable.');
  return submitLeg('withdraw', intent, await prepareWithdrawal(intent), ports);
}

async function depositOriginalWithdrawal(
  intent: NightSendIntent,
  withdrawal: NightSendLeg,
  ports: NightSendPorts,
) {
  const current = await observeRecovery(intent, ports);
  const needsRecovery = 'reason' in current || current.target !== intent.target;
  if (needsRecovery) {
    if (!ports.journal.recordRecoveryReview)
      throw new NightSendPreflightError(
        'NightNameChanged',
        'The name cannot authorize the original deposit. Inspect the saved withdrawal.',
      );
    if ('reason' in current && !ports.reviewUnresolvedOriginalDeposit)
      throw new NightSendPreflightError(
        'NightNameUnavailable',
        'The current name cannot be verified. Review the saved original ACC before deposit.',
      );
    if (!('reason' in current) && !ports.reviewOriginalDeposit)
      throw new NightSendPreflightError(
        'NightNameChanged',
        'The name changed after withdrawal. Inspect the saved original before deposit.',
      );
    if (!(await ports.isSupportedRecipient(intent.target, intent.networkId)))
      throw new NightSendPreflightError(
        'NightRecipientUnsupported',
        'The originally reviewed ACC no longer has a supported binding.',
      );
    const approved =
      'reason' in current
        ? await ports.reviewUnresolvedOriginalDeposit?.(intent, current, withdrawal)
        : await ports.reviewOriginalDeposit?.(intent, current, withdrawal);
    if (!approved)
      throw new Error('The original deposit recovery was declined. The withdrawal remains saved.');
    await ports.journal.recordRecoveryReview(intent, current, withdrawal);
  } else assertSameIntent(intent, current);
  return submitLeg(
    'deposit',
    intent,
    await ports.prepareDeposit(intent, withdrawal),
    ports,
    withdrawal,
    needsRecovery ? current : undefined,
  );
}

/** Standalone wallet-mediated NIGHT payment with original-only reconciliation. */
export async function sendNightByName(input: NightSendRequest, ports: NightSendPorts) {
  const submitWithdrawal = ports.submitWithdrawal?.bind(ports);
  const prepareWithdrawal = ports.prepareWithdrawal?.bind(ports);
  const markOwnerStarted = ports.journal.markOwnerStarted?.bind(ports.journal);
  const retireRefused = ports.journal.retireRefused?.bind(ports.journal);
  const request = Object.freeze({
    requestId: input.requestId,
    source: input.source,
    bridge: input.bridge,
    asset: input.asset,
    amount: input.amount,
    networkId: input.networkId,
    name: input.name,
  });
  validate(request);
  const retained = await ports.journal.readIntent();
  const intent = retained
    ? Object.freeze({ ...retained, operations: Object.freeze(retained.operations) })
    : await resolveIntent(request, ports);
  // Preserve the stored scope even if the original name has moved since dispatch.
  assertSameIntent(intent, { ...intent, ...request, operations: NIGHT_SEND_OPERATIONS });
  const storedWithdrawal = await ports.journal.readLeg('withdraw');
  const storedDeposit = await ports.journal.readLeg('deposit');
  if ((storedWithdrawal && !retained) || (storedDeposit && (!retained || !storedWithdrawal)))
    throw new Error('The payment journal is incomplete. Inspect the original receipts.');
  if (retained && !storedWithdrawal)
    throw new Error('The original withdrawal has no transaction ID; inspect before retry.');
  let withdrawal = storedWithdrawal && checkedLeg(storedWithdrawal);
  let deposit = storedDeposit && checkedLeg(storedDeposit);
  if (withdrawal && deposit) requireDistinctLegs(withdrawal, deposit);
  if (!withdrawal) {
    assertSameIntent(intent, await resolveIntent(request, ports));
    const balance = await ports.readSourceBalance(intent.source);
    if (balance === undefined)
      throw new NightSendPreflightError(
        'NightSourceUnsupported',
        'Unsupported source account or insufficient NIGHT balance.',
      );
    if (balance < BigInt(intent.amount))
      throw new NightSendPreflightError(
        'NightInsufficientBalance',
        'Unsupported source account or insufficient NIGHT balance.',
      );
    if ((await ports.review(intent, balance)) !== true) throw new NightPaymentDeclined();
    if (!retained) await ports.journal.createIntent(intent);
    await recheckBeforeOwnerWithdrawal(
      intent,
      request,
      ports,
      submitWithdrawal !== undefined,
      retireRefused,
    );
    withdrawal = await submitSelectedWithdrawal(
      intent,
      ports,
      submitWithdrawal,
      prepareWithdrawal,
      markOwnerStarted,
      retireRefused,
    );
  }
  const finalized = (original: NightSendLeg) => ports.finalized(original).catch(() => false);
  if (!(await finalized(withdrawal))) return { phase: 'withdrawal-pending' as const, withdrawal };

  if (!deposit) {
    try {
      deposit = await depositOriginalWithdrawal(intent, withdrawal, ports);
    } catch (cause) {
      throw new NightDepositInterrupted(withdrawal, cause);
    }
  }
  return {
    phase: (await finalized(deposit)) ? ('completed' as const) : ('deposit-pending' as const),
    withdrawal,
    deposit,
  };
}
