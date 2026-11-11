import { utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { grantScopeInvalid as invalid } from './grant-issue-fields.js';
import { grantOriginHash } from './grant-scope.js';
import {
  grantDecimal,
  p256GrantOpeningSchema,
  p256GranteePoint,
  type P256GrantOpeningPure,
} from './p256-grant-opening.js';
import type { LiveP256GrantSpendContext } from './ports/p256-grant-spend.js';
import type { P256PublicKey, PasskeyCredential } from './seams.js';

export const p256GrantSpendSchema = z
  .strictObject({
    opening: p256GrantOpeningSchema,
    amount: grantDecimal,
    spentPrev: grantDecimal,
    requestId: z.uuid().refine((value) => value === value.toLowerCase()),
  })
  .readonly();

export type P256GrantSpendIntent = z.infer<typeof p256GrantSpendSchema>;

export interface P256GrantSpendPure extends Omit<
  P256GrantOpeningPure,
  'derive_grant_scope_digest'
> {
  derive_grant_spent_commit(salt: Uint8Array, spent: bigint): Uint8Array;
  challenge_withdraw_unshielded_with_grant_p256(
    account: { readonly bytes: Uint8Array },
    grantee: P256PublicKey,
    grantId: Uint8Array,
    issuedAt: bigint,
    color: Uint8Array,
    amount: bigint,
    recipient: { readonly bytes: Uint8Array },
    nonce: bigint,
  ): Uint8Array;
}

export function checkP256Spend(
  intent: P256GrantSpendIntent,
  credential: PasskeyCredential,
  pure: P256GrantSpendPure,
) {
  const { scope, grantId, slot, scopeSalt } = intent.opening;
  const point = p256GranteePoint(scope.grantee.publicKey);
  const origin = utf8ToBytes(scope.grantee.origin);
  const rpIdHash = fromHex(scope.grantee.rpIdHash);
  if (
    credential.publicKey.identity !== false ||
    credential.publicKey.x !== point.x ||
    credential.publicKey.y !== point.y ||
    credential.policy.origin.length !== 21 ||
    credential.policy.rp_id_hash.length !== 32 ||
    toHex(credential.policy.origin) !== toHex(origin) ||
    toHex(credential.policy.rp_id_hash) !== scope.grantee.rpIdHash ||
    credential.credentialId.length < 1 ||
    credential.credentialId.length > 1023
  )
    throw new PassportConnectorError(
      'NotAuthorised',
      'The selected passkey does not match this grant.',
    );
  const account = { bytes: fromHex(scope.account) };
  const originHash = grantOriginHash(scope.grantee.origin);
  if (toHex(pure.derive_grant_id_with_p256(account, point, originHash, BigInt(slot))) !== grantId)
    return invalid('grant ID differs from the grantee, origin or slot');
  const salt = fromHex(scopeSalt);
  const color = fromHex(scope.color);
  const recipient = { bytes: fromHex(scope.recipient) };
  const maxCoin = BigInt(scope.maxCoinValue);
  const amount = BigInt(intent.amount);
  const spentPrev = BigInt(intent.spentPrev);
  const perCallCap = BigInt(scope.perCallCap);
  const cap = BigInt(scope.cap);
  const expiresAt = BigInt(scope.expiresAt ?? 0);
  if (amount === 0n || amount > perCallCap || perCallCap > maxCoin || spentPrev + amount > cap)
    return invalid('amount exceeds the admitted scope');
  return {
    credential: {
      credentialId: Uint8Array.from(credential.credentialId),
      publicKey: point,
      policy: { origin, rp_id_hash: rpIdHash },
    },
    account,
    color,
    recipient,
    originHash,
    salt,
    maxCoin,
    amount,
    spentPrev,
    perCallCap,
    cap,
    expiresAt,
    slot: BigInt(slot),
    id: fromHex(grantId),
    rpCommit: toHex(pure.derive_grant_rp_commit(salt, rpIdHash)),
    objectCommit: toHex(pure.derive_grant_object_commit(salt, color, 1n, recipient.bytes, maxCoin)),
    spentCommit: toHex(pure.derive_grant_spent_commit(salt, spentPrev)),
    nextSpentCommit: toHex(pure.derive_grant_spent_commit(salt, spentPrev + amount)),
  };
}

type CheckedSpend = ReturnType<typeof checkP256Spend>;

export function matchesP256Scope(live: LiveP256GrantSpendContext, spend: CheckedSpend): boolean {
  return (
    live.withdrawUnshielded &&
    !live.withdrawShielded &&
    !live.withdrawShieldedToContract &&
    !live.read &&
    live.perCallCap === spend.perCallCap &&
    live.cap === spend.cap &&
    live.expiresAt === spend.expiresAt &&
    toHex(live.rpCommit) === spend.rpCommit &&
    toHex(live.objectCommit) === spend.objectCommit &&
    toHex(live.callerCommit) === '00'.repeat(32)
  );
}

export function assertP256SpendLive(
  live: LiveP256GrantSpendContext | undefined,
  spend: CheckedSpend,
  now: number,
): asserts live is LiveP256GrantSpendContext {
  if (!live) throw new PassportConnectorError('GrantNotFound', 'The grant is absent on chain.');
  if (
    !live.active ||
    live.grantEpoch !== live.deviceEpoch ||
    live.grantGeneration !== live.generation
  )
    throw new PassportConnectorError(
      'GrantRevoked',
      'The grant is inactive in the current ACC epoch.',
    );
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    (live.expiresAt !== 0n && live.expiresAt <= BigInt(now))
  )
    invalid('grant has expired or the current time is invalid');
  if (!matchesP256Scope(live, spend) || toHex(live.spentCommit) !== spend.spentCommit)
    invalid('opening or spent amount differs from the live grant');
  if (live.nonce < 0n || live.nonce >= (1n << 64n) - 1n) invalid('grant nonce cannot advance');
}
