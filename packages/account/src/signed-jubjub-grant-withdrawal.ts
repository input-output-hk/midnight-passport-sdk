import { AGENT_GRANT_SPEND_CIRCUIT } from '@input-output-hk/mn-passport-protocol';
import { z } from 'zod';
import { fromHex, toHex } from './codec.js';
import { compactJubjubPoint, compactLittleEndian, verifyCompactJubjub } from './compact-jubjub.js';
import { PassportConnectorError } from './errors.js';
import type { UnshieldedGrantCallPure } from './grant-holder.js';
import { grantWireHex32, timestamp } from './grant-request-wire.js';
import { mutationDigest } from './mutation-codec.js';
import type { AgentGrantSpendReservation } from './p256-grant-spend-recovery.js';
import type { P256GrantSpendSource } from './ports/index.js';
import { AmountSchema, NetworkIdSchema } from './validation.js';

const bytes32 = z
  .instanceof(Uint8Array)
  .refine((value) => value.length === 32)
  .transform((value) => Uint8Array.from(value));
const integer = z.bigint().nonnegative();
const uint128 = integer.max((1n << 128n) - 1n);
const uint64 = integer.max((1n << 64n) - 1n);
const point = z.strictObject({ x: integer, y: integer });
const argumentsSchema = z.tuple([
  bytes32,
  uint128.positive(),
  z.strictObject({ bytes: bytes32 }),
  point,
  bytes32,
  integer.max(255n),
  bytes32,
  z.literal(1n),
  bytes32,
  uint128,
  uint128,
  point,
  integer,
  uint64,
]);
const inputSchema = z.strictObject({
  requestId: z.uuid(),
  account: grantWireHex32,
  args: argumentsSchema,
});

export interface SignedJubjubGrantWithdrawalPorts {
  readonly networkId: string;
  readonly grants: P256GrantSpendSource;
  readonly pure: UnshieldedGrantCallPure & {
    derive_grant_rp_commit(salt: Uint8Array, rpIdHash: Uint8Array): Uint8Array;
  };
  readonly nowSeconds?: () => number;
}

function refuse(message: string): never {
  throw new PassportConnectorError('GrantScopeInvalid', message);
}

function verifySignature(
  args: z.infer<typeof argumentsSchema>,
  account: Uint8Array,
  grantId: Uint8Array,
  issuedAt: bigint,
  nonce: bigint,
  pure: UnshieldedGrantCallPure,
) {
  const [color, amount, recipient, grantee, , , , , , , , sigR, sigS, grindNonce] = args;
  try {
    const key = compactJubjubPoint(grantee);
    const commitment = compactJubjubPoint(sigR);
    const challenge = pure.challenge_withdraw_unshielded_with_grant_jubjub(
      { bytes: account },
      sigR,
      grantee,
      grantId,
      issuedAt,
      color,
      amount,
      recipient,
      nonce,
      grindNonce,
    );
    return (
      challenge.length === 32 &&
      verifyCompactJubjub(key, commitment, sigS, compactLittleEndian(challenge))
    );
  } catch {
    return false;
  }
}

/**
 * Admit an externally signed fixed-recipient JubJub withdrawal before reserving its nonce.
 * Reads only. A host still owns request authorization, atomic reservation and submission.
 */
export async function prepareSignedJubjubGrantWithdrawal(
  input: unknown,
  ports: SignedJubjubGrantWithdrawalPorts,
): Promise<{
  readonly args: readonly unknown[];
  readonly reservation: AgentGrantSpendReservation;
}> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return refuse('Malformed signed grant withdrawal.');
  const { args, requestId, account } = parsed.data;
  const [
    color,
    amount,
    recipient,
    grantee,
    originHash,
    slot,
    salt,
    ,
    openedRecipient,
    maxCoin,
    spent,
  ] = args;
  const { pure, grants } = ports;
  const networkId = NetworkIdSchema.parse(ports.networkId);
  const checkPins = () => {
    if (grants.networkId !== networkId)
      throw new PassportConnectorError(
        'NetworkMismatch',
        'Signed grant withdrawal requires a pinned network.',
      );
    if (grants.bindingId !== 'acc-s3r1.1')
      throw new PassportConnectorError(
        'BindingUnsupported',
        'Signed grant withdrawal requires acc-s3r1.1.',
      );
  };
  if (toHex(recipient.bytes) !== toHex(openedRecipient) || amount > maxCoin)
    return refuse('The payout differs from the grant opening.');
  try {
    compactJubjubPoint(grantee);
  } catch {
    return refuse('Invalid Compact JubJub grantee.');
  }
  const self = fromHex(account);
  const grantId = pure.derive_grant_id_with_jubjub({ bytes: self }, grantee, originHash, slot);
  checkPins();
  const live = await grants.readP256GrantSpendContext(account, toHex(grantId));
  checkPins();
  if (
    !live?.active ||
    live.deviceEpoch !== live.grantEpoch ||
    live.generation !== live.grantGeneration
  )
    return refuse('The original grant is not active.');
  const now = timestamp.parse((ports.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))());
  if (
    live.expiresAt <= BigInt(now) ||
    live.expiresAt > BigInt(Number.MAX_SAFE_INTEGER) ||
    live.read ||
    !live.withdrawUnshielded ||
    live.withdrawShielded ||
    live.withdrawShieldedToContract ||
    amount > live.perCallCap ||
    spent + amount > live.cap ||
    toHex(live.callerCommit) !== '00'.repeat(32) ||
    toHex(live.rpCommit) !== toHex(pure.derive_grant_rp_commit(salt, new Uint8Array(32))) ||
    toHex(live.objectCommit) !==
      toHex(pure.derive_grant_object_commit(salt, color, 1n, openedRecipient, maxCoin)) ||
    toHex(live.spentCommit) !== toHex(pure.derive_grant_spent_commit(salt, spent)) ||
    !verifySignature(args, self, grantId, live.issuedAt, live.nonce, pure)
  )
    return refuse('The signed withdrawal differs from the active grant and spend state.');
  const fields = {
    requestId,
    circuit: AGENT_GRANT_SPEND_CIRCUIT,
    networkId,
    account,
    grantId: toHex(grantId),
    color: toHex(color),
    amount: AmountSchema.parse(amount.toString()),
    recipient: toHex(recipient.bytes),
    issuedAt: live.issuedAt.toString(),
    epoch: live.grantEpoch.toString(),
    generation: live.grantGeneration.toString(),
    previousNonce: live.nonce.toString(),
    validUntilSeconds: Number(live.expiresAt) - 1,
    expectedSpentCommit: toHex(pure.derive_grant_spent_commit(salt, spent + amount)),
    callArgsSha256: mutationDigest(args),
  } as const;
  return {
    args,
    reservation: Object.freeze({ ...fields, intentSha256: mutationDigest(fields) }),
  };
}
