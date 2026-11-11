import { p256 } from '@noble/curves/nist.js';
import { z } from 'zod';
import { fromHex, toHex } from './codec.js';
import { parseGrantU128 } from './grant-decimal.js';
import {
  activeGrantIds,
  freshGrantScopeSalt,
  grantScopeInvalid,
  selectGrantSlot,
} from './grant-issue-fields.js';
import { grantOriginHash, type GrantScopeArgs, type GrantScopePure } from './grant-scope.js';
import type { P256PublicKey } from './seams.js';

const hex32 = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]+$/);
const decimal = z
  .string()
  .max(39)
  .refine((value) => parseGrantU128(value, true) !== undefined);
const seconds = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const canonicalUrl = z.url({ normalize: true });
const policyOrigin = z
  .string()
  .length(21)
  .regex(/^[\x21-\x7e]+$/)
  .refine((value) => {
    if (!/^https:\/\//.test(value) && !/^http:\/\/localhost(?::[1-9][0-9]*)?$/.test(value))
      return false;
    if (value.includes('@')) return false;
    const canonical = canonicalUrl.safeParse(value);
    return canonical.success && canonical.data === value + '/';
  });

const scope = z
  .strictObject({
    account: hex32,
    grantee: z
      .strictObject({
        scheme: z.literal('p256-webauthn'),
        publicKey: z
          .string()
          .length(66)
          .regex(/^0[23][0-9a-f]{64}$/),
        origin: policyOrigin,
        rpIdHash: hex32,
      })
      .readonly(),
    color: hex32,
    recipient: hex32,
    maxCoinValue: decimal,
    perCallCap: decimal,
    cap: decimal,
    expiresAt: seconds.nullable(),
  })
  .readonly();
const preparation = z.strictObject({
  scope,
  activeGrantIds: z.array(hex32).max(16).readonly(),
  nowSeconds: seconds,
});

export type P256UnshieldedGrantScope = z.infer<typeof scope>;
export type PrepareP256UnshieldedGrantInput = z.infer<typeof preparation>;

/** Serializable opening for a direct, fixed-recipient P-256 grant. Deliver it only to the grantee. */
export interface P256UnshieldedGrantOpening {
  readonly scope: P256UnshieldedGrantScope;
  readonly grantId: string;
  readonly slot: number;
  readonly scopeSalt: string;
}

export interface P256GrantOpeningPure extends Pick<
  GrantScopePure,
  'derive_grant_object_commit' | 'derive_grant_scope_digest'
> {
  derive_grant_id_with_p256(
    account: { readonly bytes: Uint8Array },
    grantee: P256PublicKey,
    originHash: Uint8Array,
    slot: bigint,
  ): Uint8Array;
  derive_grant_rp_commit(salt: Uint8Array, rpIdHash: Uint8Array): Uint8Array;
}

export interface PreparedP256UnshieldedGrant {
  readonly opening: P256UnshieldedGrantOpening;
  /** Arguments for either pinned owner issue circuit, before the final salt and owner signature. */
  readonly scopeArgs: GrantScopeArgs;
  readonly scopeDigest: Uint8Array;
  readonly objectCommit: Uint8Array;
  readonly rpCommit: Uint8Array;
}

function granteePoint(compressed: string): P256PublicKey {
  try {
    const point = p256.Point.fromBytes(fromHex(compressed));
    return { ...point.toAffine(), identity: false };
  } catch {
    return grantScopeInvalid('grantee public key is not a P-256 point');
  }
}

/** Build owner-review and issue-circuit fields. The host retains the opening before issuing. */
export function prepareP256UnshieldedGrant(
  input: PrepareP256UnshieldedGrantInput,
  pure: P256GrantOpeningPure,
  random?: (length: number) => Uint8Array,
): PreparedP256UnshieldedGrant {
  const parsed = preparation.safeParse(input);
  if (!parsed.success) return grantScopeInvalid('malformed P-256 unshielded grant preparation');
  const { scope, nowSeconds } = parsed.data;
  const { grantee } = scope;
  const maxCoin = BigInt(scope.maxCoinValue);
  const perCall = BigInt(scope.perCallCap);
  const cap = BigInt(scope.cap);
  if (perCall === 0n || perCall > cap || perCall > maxCoin)
    return grantScopeInvalid('invalid fixed-recipient spend limits');
  if (scope.expiresAt !== null && scope.expiresAt <= nowSeconds)
    return grantScopeInvalid('expiresAt must be in the future');
  const point = granteePoint(grantee.publicKey);
  const account = { bytes: fromHex(scope.account) };
  const originHash = grantOriginHash(grantee.origin);
  const active = activeGrantIds(parsed.data.activeGrantIds);
  const identity = selectGrantSlot(active, (slot) =>
    pure.derive_grant_id_with_p256(account, point, originHash, slot),
  );
  const salt = freshGrantScopeSalt(random);
  const color = fromHex(scope.color);
  const recipient = fromHex(scope.recipient);
  const rpIdHash = fromHex(grantee.rpIdHash);
  const args: GrantScopeArgs = [
    true,
    false,
    false,
    false,
    color,
    1n,
    recipient,
    maxCoin,
    perCall,
    cap,
    BigInt(scope.expiresAt ?? 0),
    rpIdHash,
    new Uint8Array(32),
    0n,
    0n,
    { is_some: false, value: { bytes: new Uint8Array(32) } },
  ];
  const scopeDigest = pure.derive_grant_scope_digest(salt, ...args);
  const objectCommit = pure.derive_grant_object_commit(salt, color, 1n, recipient, maxCoin);
  const rpCommit = pure.derive_grant_rp_commit(salt, rpIdHash);
  if ([scopeDigest, objectCommit, rpCommit].some((commit) => commit.length !== 32))
    return grantScopeInvalid('binding returned an invalid grant commitment');
  return {
    opening: { scope, ...identity, scopeSalt: toHex(salt) },
    scopeArgs: args,
    scopeDigest,
    objectCommit,
    rpCommit,
  };
}
