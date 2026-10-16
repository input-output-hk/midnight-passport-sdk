import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { grantOriginHash, granteePoint, type GrantScopePure } from './grant-scope.js';
import type { CurvePoint } from './ports/index.js';

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
