import {
  resolvePassportName,
  type PassportNameService,
} from '@input-output-hk/mn-passport-account/names';

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

export interface NightSendJournal {
  readIntent(): Promise<NightSendIntent | undefined>;
  /** Exclusively create. A losing writer must fail before preparing a payment. */
  createIntent(intent: NightSendIntent): Promise<void>;
  readLeg(leg: 'withdraw' | 'deposit'): Promise<NightSendLeg | undefined>;
  /** Atomically and durably reserve a leg. A duplicate writer must fail. */
  fenceLeg(leg: 'withdraw' | 'deposit', original: NightSendLeg): Promise<void>;
}

export class NightDepositInterrupted extends Error {
  constructor(
    readonly withdrawal: NightSendLeg,
    cause: unknown,
  ) {
    super('The withdrawal finalized. Inspect the original intent before continuing the deposit.', {
      cause,
    });
    this.name = 'NightDepositInterrupted';
  }
}

interface PreparedLeg {
  readonly original: NightSendLeg;
  dispatch(): Promise<void>;
}

interface NightSendPorts {
  readonly names: PassportNameService;
  readonly journal: NightSendJournal;
  /** Verify the recipient activation and pinned binding independently of the name-service result. */
  isSupportedRecipient(address: string, networkId: string): Promise<boolean>;
  /** Return undefined for a source that fails the pinned binding and activation checks. */
  readSourceBalance(source: string): Promise<bigint | undefined>;
  review(intent: NightSendIntent): Promise<boolean>;
  /** Owner authorization and preparation of the exact reviewed withdrawal. */
  prepareWithdrawal(intent: NightSendIntent): Promise<PreparedLeg>;
  /** Prepare a deposit funded by the original withdrawal output to the controlled wallet. */
  prepareDeposit(intent: NightSendIntent, withdrawal: NightSendLeg): Promise<PreparedLeg>;
  /** Require canonical successful finality for the exact prepared transaction. */
  finalized(original: NightSendLeg): Promise<boolean>;
}

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
    throw new Error('Unsupported or invalid standalone NIGHT payment.');
}

async function resolveIntent(
  request: NightSendRequest,
  ports: Pick<NightSendPorts, 'names' | 'isSupportedRecipient'>,
) {
  const target = await resolvePassportName(ports.names, request);
  if (!target || target.mode !== 'external' || target.accountAddress === request.source)
    throw new Error('The name must resolve to a different supported Passport ACC.');
  if ((await ports.isSupportedRecipient(target.accountAddress, request.networkId)) !== true)
    throw new Error('The named recipient is not an activated, supported Passport ACC.');
  return Object.freeze({
    ...request,
    target: target.accountAddress,
    providerId: target.providerId,
    namespace: target.namespace,
    operations: NIGHT_SEND_OPERATIONS,
  });
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
) {
  const original = checkedLeg(prepared.original);
  if (prior) requireDistinctLegs(prior, original);
  assertSameIntent(intent, await resolveIntent(intent, ports));
  await ports.journal.fenceLeg(leg, original);
  try {
    await prepared.dispatch();
  } catch {
    // The submission response can be lost after admission. Reconcile the original only.
  }
  return original;
}

/** Standalone wallet-mediated NIGHT payment with original-only reconciliation. */
export async function sendNightByName(input: NightSendRequest, ports: NightSendPorts) {
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
  const intent = retained ?? (await resolveIntent(request, ports));
  // Preserve the stored scope even if the original name has moved since dispatch.
  assertSameIntent(intent, { ...intent, ...request, operations: NIGHT_SEND_OPERATIONS });
  const storedWithdrawal = await ports.journal.readLeg('withdraw');
  const storedDeposit = await ports.journal.readLeg('deposit');
  if ((storedWithdrawal && !retained) || (storedDeposit && (!retained || !storedWithdrawal)))
    throw new Error('The payment journal is incomplete. Inspect the original receipts.');
  let withdrawal = storedWithdrawal && checkedLeg(storedWithdrawal);
  let deposit = storedDeposit && checkedLeg(storedDeposit);
  if (withdrawal && deposit) requireDistinctLegs(withdrawal, deposit);
  if (!withdrawal) {
    assertSameIntent(intent, await resolveIntent(request, ports));
    const balance = await ports.readSourceBalance(intent.source);
    if (balance === undefined || balance < BigInt(intent.amount))
      throw new Error('Unsupported source account or insufficient NIGHT balance.');
    if ((await ports.review(intent)) !== true) throw new Error('NIGHT payment declined.');
    if (!retained) await ports.journal.createIntent(intent);
    assertSameIntent(intent, await resolveIntent(request, ports));
    withdrawal = await submitLeg('withdraw', intent, await ports.prepareWithdrawal(intent), ports);
  }
  const finalized = (original: NightSendLeg) => ports.finalized(original).catch(() => false);
  if (!(await finalized(withdrawal))) return { phase: 'withdrawal-pending' as const, withdrawal };

  if (!deposit) {
    try {
      assertSameIntent(intent, await resolveIntent(request, ports));
      deposit = await submitLeg(
        'deposit',
        intent,
        await ports.prepareDeposit(intent, withdrawal),
        ports,
        withdrawal,
      );
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
