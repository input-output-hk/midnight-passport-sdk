import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { grantOriginHash, granteePoint, type GrantScopePure } from './grant-scope.js';
import type { Authoriser, Chain, CurvePoint } from './ports/index.js';
import type { FlowOptions, PassportTxResult } from '@input-output-hk/mn-passport-protocol';

/** The first holder flow accepts only a recipient-pinned unshielded spend. */
export interface UnshieldedGrantIntent {
  readonly account: string;
  readonly grantId: string;
  readonly granteePublicKey: string;
  readonly origin: string;
  readonly slot: number;
  readonly scopeSalt: string;
  readonly color: string;
  readonly amount: string;
  readonly recipient: string;
  readonly maxCoinValue: string;
  readonly spentPrev: string;
}

/** One chain snapshot. The holder must reread this before each signature. */
export interface UnshieldedGrantContext {
  readonly active: boolean;
  readonly issuedAt: bigint;
  readonly nonce: bigint;
  readonly spentCommit: Uint8Array;
  readonly objectCommit: Uint8Array;
  readonly withdrawUnshielded: boolean;
  readonly perCallCap: bigint;
  readonly cap: bigint;
  readonly expiresAt: bigint;
}

export interface UnshieldedGrantPure extends Pick<
  GrantScopePure,
  'derive_grant_id_with_jubjub' | 'derive_grant_object_commit'
> {
  derive_grant_spent_commit(salt: Uint8Array, spent: bigint): Uint8Array;
}

export interface UnshieldedGrantCallPure extends UnshieldedGrantPure {
  challenge_withdraw_unshielded_with_grant_jubjub(
    account: { readonly bytes: Uint8Array },
    sigR: CurvePoint,
    grantee: CurvePoint,
    grantId: Uint8Array,
    issuedAt: bigint,
    color: Uint8Array,
    amount: bigint,
    recipient: { readonly bytes: Uint8Array },
    grantNonce: bigint,
    grindNonce: bigint,
  ): Uint8Array;
}

export interface UnshieldedGrantSpendPorts {
  readonly pure: UnshieldedGrantCallPure;
  readonly source: {
    readGrantSpendContext(
      account: string,
      grantId: string,
    ): Promise<UnshieldedGrantContext | undefined>;
  };
  /** Must be value-capable: the fee-only Passport sponsor cannot balance this withdrawal. */
  readonly chain: Chain;
  readonly grantee: Authoriser;
  /** The host must show and approve these exact public fields before a grantee signs. */
  readonly review: (intent: {
    readonly account: string;
    readonly grantId: string;
    readonly color: string;
    readonly amount: string;
    readonly recipient: string;
    readonly remainingCap: string;
  }) => Promise<boolean>;
  readonly nowSeconds?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly attempts?: number;
}

export interface UnshieldedGrantSpendResult extends PassportTxResult {
  readonly grantId: string;
  readonly spentTotal: bigint;
  readonly grantNonce: bigint;
}

/** A submitted call with uncertain publication; the caller must reconcile this exact hash. */
export class SubmittedGrantSpendError extends PassportConnectorError {
  constructor(readonly txHash: string) {
    super(
      'GrantRosterUnsettled',
      `Grant spend ${txHash} was submitted but did not settle in the live grant map. Inspect this transaction before retrying.`,
      { retryable: false },
    );
  }
}

const U128 = (1n << 128n) - 1n;
const invalid = (message: string): never => {
  throw new PassportConnectorError('GrantScopeInvalid', message);
};
const bytes32 = (name: string, value: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/.test(value)) invalid(`${name} must be 32-byte lowercase hex.`);
  return fromHex(value);
};
const decimal = (name: string, value: string): bigint => {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) invalid(`${name} must be a decimal integer.`);
  const parsed = BigInt(value);
  if (parsed > U128) invalid(`${name} exceeds 128 bits.`);
  return parsed;
};
const same = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export interface CheckedUnshieldedGrant {
  readonly account: Uint8Array;
  readonly grantId: Uint8Array;
  readonly grantee: CurvePoint;
  readonly originHash: Uint8Array;
  readonly slot: bigint;
  readonly scopeSalt: Uint8Array;
  readonly color: Uint8Array;
  readonly amount: bigint;
  readonly recipient: Uint8Array;
  readonly maxCoinValue: bigint;
  readonly spentPrev: bigint;
  readonly issuedAt: bigint;
  readonly nonce: bigint;
}

/** Refuse a stale, revoked or changed opening before the grantee signs or moves value. */
export function checkUnshieldedGrant(
  intent: UnshieldedGrantIntent,
  live: UnshieldedGrantContext | undefined,
  pure: UnshieldedGrantPure,
  nowSeconds: number,
): CheckedUnshieldedGrant {
  if (!live) throw new PassportConnectorError('GrantNotFound', 'The grant is absent on chain.');
  if (!live.active) throw new PassportConnectorError('GrantRevoked', 'The grant is revoked.');
  if (!live.withdrawUnshielded) invalid('The grant does not authorize an unshielded withdrawal.');
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) invalid('The current time is invalid.');
  if (!Number.isSafeInteger(intent.slot) || intent.slot < 0 || intent.slot > 255)
    invalid('The grant slot is invalid.');
  const account = bytes32('account', intent.account);
  const grantId = bytes32('grantId', intent.grantId);
  const scopeSalt = bytes32('scopeSalt', intent.scopeSalt);
  const color = bytes32('color', intent.color);
  const recipient = bytes32('recipient', intent.recipient);
  const amount = decimal('amount', intent.amount);
  const maxCoinValue = decimal('maxCoinValue', intent.maxCoinValue);
  const spentPrev = decimal('spentPrev', intent.spentPrev);
  if (amount === 0n || amount > maxCoinValue || amount > live.perCallCap)
    invalid('Amount exceeds this grant’s per-call or coin bound.');
  if (spentPrev + amount > live.cap) invalid('Amount exceeds the grant’s remaining cap.');
  if (live.expiresAt !== 0n && BigInt(nowSeconds) >= live.expiresAt)
    invalid('The grant has expired.');
  const grantee = granteePoint(intent.granteePublicKey);
  const originHash = grantOriginHash(intent.origin);
  const slot = BigInt(intent.slot);
  if (
    toHex(pure.derive_grant_id_with_jubjub({ bytes: account }, grantee, originHash, slot)) !==
    intent.grantId
  )
    invalid('The grant ID does not match the grantee, origin and slot.');
  if (
    !same(
      pure.derive_grant_object_commit(scopeSalt, color, 1n, recipient, maxCoinValue),
      live.objectCommit,
    )
  )
    invalid('The fixed recipient and asset do not match the live grant.');
  if (!same(pure.derive_grant_spent_commit(scopeSalt, spentPrev), live.spentCommit))
    invalid('The grant spend opening is stale or differs from the chain.');
  return {
    account,
    grantId,
    grantee,
    originHash,
    slot,
    scopeSalt,
    color,
    amount,
    recipient,
    maxCoinValue,
    spentPrev,
    issuedAt: live.issuedAt,
    nonce: live.nonce,
  };
}

/** Sign one grant-holder spend and confirm its live nonce and spent commitment. */
export async function spendUnshieldedWithGrant(
  intent: UnshieldedGrantIntent,
  ports: UnshieldedGrantSpendPorts,
  options: FlowOptions = {},
): Promise<UnshieldedGrantSpendResult> {
  const { grantee, pure, source, chain } = ports;
  if (grantee.scheme !== 'jubjub-schnorr' || !grantee.withKeySession)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'A JubJub grantee key session is required.',
    );
  const attempts = ports.attempts ?? 30;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 120)
    invalid('Invalid settlement polling bound.');
  const sleep =
    ports.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) =>
        (globalThis as unknown as { setTimeout(run: () => void, ms: number): unknown }).setTimeout(
          resolve,
          milliseconds,
        ),
      ));
  return grantee.withKeySession(async () => {
    if (options.signal?.aborted)
      throw new PassportConnectorError('Aborted', 'Grant spend cancelled.');
    const read = () => source.readGrantSpendContext(intent.account, intent.grantId);
    const live = await read();
    const checked = checkUnshieldedGrant(
      intent,
      live,
      pure,
      (ports.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))(),
    );
    const selected = await grantee.devicePublicKey();
    if (selected.x !== checked.grantee.x || selected.y !== checked.grantee.y)
      throw new PassportConnectorError(
        'NotAuthorised',
        'The selected grantee key differs from the grant.',
      );
    const approved = await ports.review({
      account: intent.account,
      grantId: intent.grantId,
      color: intent.color,
      amount: intent.amount,
      recipient: intent.recipient,
      remainingCap: (live!.cap - checked.spentPrev).toString(),
    });
    if (!approved) throw new PassportConnectorError('UserCancelled', 'Grant spend was declined.');
    const circuit = 'withdraw_unshielded_with_grant_jubjub';
    const signature = await grantee.authorise({
      account: intent.account,
      circuit,
      args: [checked.color, checked.amount, { bytes: checked.recipient }],
      witnessValues: [],
      authNonce: 0n,
      useCounter: 0n,
      challenge: (sigR, grindNonce) =>
        pure.challenge_withdraw_unshielded_with_grant_jubjub(
          { bytes: checked.account },
          sigR,
          checked.grantee,
          checked.grantId,
          checked.issuedAt,
          checked.color,
          checked.amount,
          { bytes: checked.recipient },
          checked.nonce,
          grindNonce,
        ),
    });
    if (
      signature.scheme !== 'jubjub-schnorr' ||
      signature.pk.x !== checked.grantee.x ||
      signature.pk.y !== checked.grantee.y
    )
      throw new PassportConnectorError('NotAuthorised', 'The signature names another grantee.');
    const latest = await read();
    if (
      !latest?.active ||
      latest.issuedAt !== checked.issuedAt ||
      latest.nonce !== checked.nonce ||
      latest.withdrawUnshielded !== live!.withdrawUnshielded ||
      latest.perCallCap !== live!.perCallCap ||
      latest.cap !== live!.cap ||
      latest.expiresAt !== live!.expiresAt ||
      !same(latest.objectCommit, live!.objectCommit) ||
      !same(latest.spentCommit, live!.spentCommit)
    )
      throw new PassportConnectorError(
        'GrantRosterUnsettled',
        'The grant changed before submission.',
      );
    if (options.signal?.aborted)
      throw new PassportConnectorError('Aborted', 'Grant spend cancelled.');
    const tx = await chain.call({
      address: intent.account,
      circuit,
      args: [
        checked.color,
        checked.amount,
        { bytes: checked.recipient },
        signature.pk,
        checked.originHash,
        checked.slot,
        checked.scopeSalt,
        1n,
        checked.recipient,
        checked.maxCoinValue,
        checked.spentPrev,
        signature.sigR,
        signature.sigS,
        signature.grindNonce,
      ],
      ...options,
    });
    const spentTotal = checked.spentPrev + checked.amount;
    const expected = pure.derive_grant_spent_commit(checked.scopeSalt, spentTotal);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const settled = await read();
      if (settled?.nonce === checked.nonce + 1n && same(settled.spentCommit, expected))
        return { ...tx, grantId: intent.grantId, spentTotal, grantNonce: settled.nonce };
      if (attempt + 1 < attempts) await sleep(1000);
    }
    throw new SubmittedGrantSpendError(tx.txHash);
  });
}
