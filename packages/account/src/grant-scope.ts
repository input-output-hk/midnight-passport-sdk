import { jubjub } from '@noble/curves/misc.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import type { CurvePoint } from './ports/index.js';

export type GrantOperation =
  'withdraw-unshielded' | 'withdraw-shielded' | 'withdraw-shielded-to-contract';
export type GrantRecipient =
  | { readonly kind: 'any' }
  | {
      readonly kind: 'user-address' | 'coin-public-key' | 'contract-address';
      readonly value: string;
    };

/** Lace PR #2845's owner request shape, with decimal strings for unsigned 128-bit amounts. */
export interface GrantScopeInput {
  readonly grantee: { readonly scheme: 'jubjub-schnorr'; readonly publicKey: string };
  readonly operations: readonly GrantOperation[];
  readonly color: string;
  readonly recipient: GrantRecipient;
  readonly maxCoinValue: string;
  readonly perCallCap: string;
  readonly cap: string;
  readonly expiresAt: number | null;
  readonly window?: { readonly lengthSeconds: number; readonly cap: string };
  readonly read?: boolean;
  readonly readPublicKey?: string;
  readonly caller?: string;
  readonly rpId?: string;
}

export type GrantScopeArgs = readonly [
  boolean,
  boolean,
  boolean,
  boolean,
  Uint8Array,
  bigint,
  Uint8Array,
  bigint,
  bigint,
  bigint,
  bigint,
  Uint8Array,
  Uint8Array,
  bigint,
  bigint,
  { readonly is_some: boolean; readonly value: { readonly bytes: Uint8Array } },
];

/** Pure circuits from the pinned ACC binding; the package does not import its heavy runtime. */
export interface GrantScopePure {
  derive_grant_id_with_jubjub(
    account: { readonly bytes: Uint8Array },
    grantee: CurvePoint,
    originHash: Uint8Array,
    slot: bigint,
  ): Uint8Array;
  derive_grant_object_commit(
    salt: Uint8Array,
    color: Uint8Array,
    recipientKind: bigint,
    recipient: Uint8Array,
    maxCoinValue: bigint,
  ): Uint8Array;
  derive_grant_scope_digest(salt: Uint8Array, ...scope: GrantScopeArgs): Uint8Array;
}

export interface PrepareJubjubGrantInput {
  readonly account: string;
  /** The relying-party id of the consumer issuing this grant. */
  readonly origin: string;
  readonly scope: GrantScopeInput;
  /** Active ids from the live ACC roster; revoked tombstones do not occupy a slot. */
  readonly activeGrantIds: readonly string[];
  readonly nowSeconds: number;
}

export interface PreparedJubjubGrant {
  readonly grantId: string;
  readonly originHash: Uint8Array;
  readonly slot: number;
  readonly scopeSalt: Uint8Array;
  readonly scopeDigest: Uint8Array;
  readonly objectCommit: Uint8Array;
  readonly granteePoint: CurvePoint;
  /** The sixteen plaintext scope fields in the generated issue circuit's order. */
  readonly scopeArgs: GrantScopeArgs;
}

const MAX_GRANTS = 16;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const CURVE25519_PRIME = (1n << 255n) - 19n;
const ORIGIN_TAG = utf8ToBytes('midnight:account:grant:origin:v1');
const EMPTY = new Uint8Array(32);
const LOW_ORDER_X25519 = new Set([
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
  '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'cdeb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b880',
  '4c9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f11d7',
  'd9ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  'daffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
  'dbffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
]);

const invalid = (message: string): never => {
  throw new PassportConnectorError('GrantScopeInvalid', `Invalid grant scope: ${message}`);
};
const bytes32 = (name: string, value: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/.test(value)) invalid(`${name} must be 32-byte lowercase hex`);
  return fromHex(value);
};
const decimal = (name: string, value: string): bigint => {
  if (!/^\d+$/.test(value)) invalid(`${name} must be a non-negative decimal integer`);
  const parsed = BigInt(value);
  if (parsed > UINT128_MAX) invalid(`${name} exceeds 128 bits`);
  return parsed;
};
const seconds = (name: string, value: number): bigint => {
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${name} must be whole seconds`);
  const parsed = BigInt(value);
  if (parsed > UINT64_MAX) invalid(`${name} exceeds 64 bits`);
  return parsed;
};
const readKey = (value: string): Uint8Array => {
  const bytes = bytes32('read public key', value);
  let coordinate = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) coordinate = (coordinate << 8n) | BigInt(bytes[i]!);
  if (coordinate >= CURVE25519_PRIME || LOW_ORDER_X25519.has(value))
    invalid('read public key is not a sealable X25519 point');
  return bytes;
};
const granteePoint = (value: string): CurvePoint => {
  let point: ReturnType<typeof jubjub.Point.fromBytes>;
  try {
    point = jubjub.Point.fromBytes(bytes32('grantee public key', value));
  } catch {
    return invalid('grantee public key is not a JubJub point');
  }
  if (point.isSmallOrder()) invalid('grantee public key has small order');
  return point.toAffine();
};
const same = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** Validate Lace's request rules and the pinned contract's issue assertions before any ceremony. */
function scopeArgs(
  scope: GrantScopeInput,
  nowSeconds: number,
): {
  args: GrantScopeArgs;
  grantee: CurvePoint;
} {
  const grantee = granteePoint(scope.grantee.publicKey);
  if (scope.grantee.scheme !== 'jubjub-schnorr') invalid('grantee must use JubJub');
  if (scope.operations.length === 0) invalid('a grant needs a withdrawal operation');
  const operations = new Set(scope.operations);
  if (
    [...operations].some(
      (op) =>
        op !== 'withdraw-unshielded' &&
        op !== 'withdraw-shielded' &&
        op !== 'withdraw-shielded-to-contract',
    )
  )
    invalid('unknown operation');
  const unshielded = operations.has('withdraw-unshielded');
  const shielded = operations.has('withdraw-shielded');
  const toContract = operations.has('withdraw-shielded-to-contract');
  const read = scope.read ?? false;
  if ((shielded || toContract) && !read) invalid('shielded spend requires read');
  if (read && !scope.rpId) invalid('read requires an rp id');
  if (read && !scope.readPublicKey) invalid('read requires a public key');
  if (!read && scope.readPublicKey !== undefined) invalid('read key requires a read grant');
  const keyHash = read ? sha256(readKey(scope.readPublicKey!)) : EMPTY;
  const color = bytes32('color', scope.color);
  const recipientKind =
    scope.recipient.kind === 'any'
      ? 0n
      : scope.recipient.kind === 'user-address'
        ? 1n
        : scope.recipient.kind === 'coin-public-key'
          ? 2n
          : scope.recipient.kind === 'contract-address'
            ? 3n
            : invalid('unknown recipient kind');
  const recipient =
    scope.recipient.kind === 'any' ? EMPTY : bytes32('recipient value', scope.recipient.value);
  const maxCoin = decimal('maxCoinValue', scope.maxCoinValue);
  const perCall = decimal('perCallCap', scope.perCallCap);
  const cap = decimal('cap', scope.cap);
  if (perCall > cap || cap === 0n) invalid('spend cap is below the per-call cap or zero');
  if (maxCoin < perCall) invalid('coin bound is below the per-call cap');
  if (
    scope.expiresAt !== null &&
    seconds('expiresAt', scope.expiresAt) <= seconds('now', nowSeconds)
  )
    invalid('expiresAt must be in the future');
  if (scope.window !== undefined) invalid('rolling windows are reserved by this ACC binding');
  const caller = scope.caller === undefined ? undefined : bytes32('caller', scope.caller);
  if (caller !== undefined && !unshielded && !shielded && !toContract)
    invalid('read-only grant cannot pin a caller');
  const args: GrantScopeArgs = [
    unshielded,
    shielded,
    toContract,
    read,
    color,
    recipientKind,
    recipient,
    maxCoin,
    perCall,
    cap,
    seconds('expiresAt', scope.expiresAt ?? 0),
    EMPTY,
    keyHash,
    0n,
    0n,
    { is_some: caller !== undefined, value: { bytes: caller ?? EMPTY } },
  ];
  return { args, grantee };
}

/**
 * Prepare the generated JubJub issue-circuit fields from a live active-id roster. This does not
 * issue a grant: the owner flow must still pin the caller, sign, submit, settle and store sealed
 * bookkeeping. The caller must provide the on-chain roster and current time.
 */
export function prepareJubjubGrant(
  input: PrepareJubjubGrantInput,
  pure: GrantScopePure,
  random: (length: number) => Uint8Array = (length) =>
    (
      globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }
    ).crypto.getRandomValues(new Uint8Array(length)),
): PreparedJubjubGrant {
  const account = bytes32('account', input.account);
  if (!input.origin || input.origin.trim() !== input.origin)
    invalid('origin must be a nonempty rp id');
  if (!Number.isSafeInteger(input.nowSeconds) || input.nowSeconds < 0)
    invalid('nowSeconds must be whole seconds');
  const active = new Set(input.activeGrantIds.map((id) => toHex(bytes32('active grant id', id))));
  if (active.size >= MAX_GRANTS)
    throw new PassportConnectorError(
      'GrantLimitReached',
      'Account has the maximum 16 active grants.',
    );
  const { args, grantee } = scopeArgs(input.scope, input.nowSeconds);
  const tag = new Uint8Array(32);
  tag.set(ORIGIN_TAG);
  const originBytes = utf8ToBytes(input.origin);
  const preimage = new Uint8Array(tag.length + originBytes.length);
  preimage.set(tag);
  preimage.set(originBytes, tag.length);
  const originHash = sha256(preimage);
  let slot = -1;
  let grantId: Uint8Array | undefined;
  for (let candidate = 0; candidate < 256; candidate++) {
    const id = pure.derive_grant_id_with_jubjub(
      { bytes: account },
      grantee,
      originHash,
      BigInt(candidate),
    );
    if (id.length !== 32) invalid('binding returned an invalid grant id');
    if (!active.has(toHex(id))) {
      slot = candidate;
      grantId = id;
      break;
    }
  }
  if (slot < 0 || grantId === undefined)
    throw new PassportConnectorError('GrantLimitReached', 'No grant slot is free.');
  const salt = random(32);
  if (salt.length !== 32 || same(salt, EMPTY))
    invalid('scope salt must be fresh 32-byte randomness');
  const digest = pure.derive_grant_scope_digest(salt, ...args);
  const objectCommit = pure.derive_grant_object_commit(salt, args[4], args[5], args[6], args[7]);
  if (digest.length !== 32 || objectCommit.length !== 32)
    invalid('binding returned an invalid grant commitment');
  return {
    grantId: toHex(grantId),
    originHash,
    slot,
    scopeSalt: salt,
    scopeDigest: digest,
    objectCommit,
    granteePoint: grantee,
    scopeArgs: args,
  };
}
