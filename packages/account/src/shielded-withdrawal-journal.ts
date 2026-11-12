import { utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { finalizedTransactionIdentitySchema } from './finalized-transaction-identity.js';
import { mutationDigest } from './mutation-codec.js';
import type { MutationByteStore } from './mutation-types.js';
import type { QualifiedShieldedCoin } from './ports/index.js';
import { AmountSchema, NetworkIdSchema } from './validation.js';

export const shieldedEffectHex = z.string().regex(/^[0-9a-f]{64}$/);
export const shieldedWithdrawCircuit = z.enum([
  'withdraw_shielded_with_p256',
  'withdraw_shielded_with_jubjub',
]);

const reservationFields = z.strictObject({
  requestId: z.uuid(),
  networkId: NetworkIdSchema,
  bindingId: z.literal('acc-s3r1.1'),
  account: shieldedEffectHex,
  circuit: shieldedWithdrawCircuit,
  callArgsSha256: shieldedEffectHex,
  publicIntentSha256: shieldedEffectHex.optional(),
  inputNullifier: shieldedEffectHex,
  payoutCommitment: shieldedEffectHex,
  changeCommitment: shieldedEffectHex,
  change: z
    .strictObject({ nonce: shieldedEffectHex, color: shieldedEffectHex, value: AmountSchema })
    .readonly(),
});
const distinctOutputs = (value: z.infer<typeof reservationFields>) =>
  value.changeCommitment !== value.payoutCommitment;
export const shieldedWithdrawalReservation = reservationFields
  .extend({ heldCoinSha256: shieldedEffectHex })
  .refine(distinctOutputs)
  .readonly();
export const retainedShieldedWithdrawalReservation = reservationFields
  .extend({ heldCoinSha256: shieldedEffectHex.optional() })
  .refine(distinctOutputs)
  .readonly();

export const shieldedWithdrawalDispatch = z
  .strictObject({
    identity: finalizedTransactionIdentitySchema,
    // Ledger 9 communication commitments have variable-width hex encodings.
    callCommitment: z.string().regex(/^(?:[0-9a-f]{2}){1,64}$/),
  })
  .readonly();
const record = z
  .strictObject({
    version: z.union([z.literal(1), z.literal(2)]),
    reservation: retainedShieldedWithdrawalReservation,
    dispatch: shieldedWithdrawalDispatch.optional(),
  })
  .readonly();

/** Contains a private change coin. Retain it only in protected storage. */
export type ShieldedWithdrawalReservation = z.input<typeof shieldedWithdrawalReservation>;
export type ShieldedWithdrawalDispatch = z.infer<typeof shieldedWithdrawalDispatch>;
export type ShieldedWithdrawalRecord = Omit<z.infer<typeof record>, 'version'>;

export interface ShieldedWithdrawalJournal {
  read(requestId: string): Promise<ShieldedWithdrawalRecord | undefined>;
  reserve(reservation: ShieldedWithdrawalReservation): Promise<boolean>;
  matchesInvocation(
    reservation: ShieldedWithdrawalReservation,
    args: readonly unknown[],
    heldCoin: QualifiedShieldedCoin,
  ): boolean;
  /** Call after verifying the finalized call and before forwarding. Only the first CAS wins. */
  stageDispatch(
    reservation: ShieldedWithdrawalReservation,
    original: ShieldedWithdrawalDispatch,
  ): Promise<boolean>;
}

const cancellationScope = reservationFields.pick({
  requestId: true,
  networkId: true,
  bindingId: true,
  account: true,
});

export type ShieldedWithdrawalCancellation = z.input<typeof cancellationScope>;

export interface CancellableShieldedWithdrawalJournal extends ShieldedWithdrawalJournal {
  /** True only if this original is durably excluded from submission. */
  cancelBeforeDispatch(scope: ShieldedWithdrawalCancellation): Promise<boolean>;
}

const fenceStates = { reserved: '02', dispatch: '03', cancelled: '04' } as const;
type FenceState = keyof typeof fenceStates;

function fenceBytes(state: FenceState, reservation: ShieldedWithdrawalRecord['reservation']) {
  return fromHex(fenceStates[state] + mutationDigest({ state, reservation }));
}

function unsettled(): never {
  throw new PassportConnectorError(
    'MutationUnsettled',
    'The original shielded withdrawal record cannot be verified.',
    { retryable: false },
  );
}

function slotKey(
  requestId: string,
  kind: 'shielded-withdrawal' | 'shielded-withdrawal-fence',
): string {
  if (!z.uuid().safeParse(requestId).success) return unsettled();
  return mutationDigest({ kind, requestId: requestId.toLowerCase() }).slice(0, 32);
}

/**
 * Use independent crash-durable CAS stores. The record store must encrypt and
 * authenticate, consume write buffers before resolving, and return owned read buffers.
 */
export function createShieldedWithdrawalJournal(
  store: MutationByteStore,
  requestFence: MutationByteStore,
): CancellableShieldedWithdrawalJournal {
  if (store === requestFence) return unsettled();
  const recordKey = (requestId: string) => slotKey(requestId, 'shielded-withdrawal');
  const fenceKey = (requestId: string) => slotKey(requestId, 'shielded-withdrawal-fence');
  async function load(requestId: string) {
    const slot = await store.read(recordKey(requestId));
    if (!slot) return undefined;
    try {
      if (slot.bytes.length > 8192) return unsettled();
      const value = record.parse(JSON.parse(String.fromCharCode(...slot.bytes)));
      if (
        value.reservation.requestId.toLowerCase() !== requestId.toLowerCase() ||
        slot.revision !== (value.dispatch ? 1 : 0)
      )
        return unsettled();
      return value;
    } catch {
      return unsettled();
    } finally {
      slot.bytes.fill(0);
    }
  }
  async function save(value: z.infer<typeof record>, expected: number | undefined) {
    const bytes = utf8ToBytes(JSON.stringify(value));
    try {
      return await store.compareAndSwap(recordKey(value.reservation.requestId), expected, {
        revision: (expected ?? -1) + 1,
        bytes,
      });
    } finally {
      bytes.fill(0);
    }
  }
  async function claimFence(
    reservation: ShieldedWithdrawalRecord['reservation'],
    terminal: Exclude<FenceState, 'reserved'>,
  ) {
    const key = fenceKey(reservation.requestId);
    const current = await requestFence.read(key);
    if (!current || current.bytes.length !== 33) return false;
    const actual = toHex(current.bytes);
    const next = fenceBytes(terminal, reservation);
    if (current.revision === 1) return terminal === 'cancelled' && actual === toHex(next);
    if (current.revision !== 0 || actual !== toHex(fenceBytes('reserved', reservation)))
      return false;
    return requestFence.compareAndSwap(key, 0, { revision: 1, bytes: next });
  }
  return {
    matchesInvocation(reservation, args, heldCoin) {
      return (
        mutationDigest(args) === reservation.callArgsSha256 &&
        mutationDigest(heldCoin) === reservation.heldCoinSha256
      );
    },
    async read(requestId) {
      const original = await load(requestId);
      return original && { reservation: original.reservation, dispatch: original.dispatch };
    },
    async reserve(input) {
      const reservation = shieldedWithdrawalReservation.safeParse(input);
      if (!reservation.success) return unsettled();
      const key = fenceKey(reservation.data.requestId);
      if (
        !(await requestFence.compareAndSwap(key, undefined, {
          revision: 0,
          bytes: fenceBytes('reserved', reservation.data),
        }))
      )
        return false;
      return save({ version: 2, reservation: reservation.data }, undefined);
    },
    async stageDispatch(input, proposed) {
      const reservation = shieldedWithdrawalReservation.safeParse(input);
      const original = shieldedWithdrawalDispatch.safeParse(proposed);
      if (!reservation.success || !original.success) return unsettled();
      const { requestId } = reservation.data;
      const stored = await load(requestId);
      if (
        !stored ||
        mutationDigest(stored.reservation) !==
          mutationDigest({ ...reservation.data, requestId: stored.reservation.requestId })
      )
        return unsettled();
      if (stored.dispatch) return false;
      if (stored.version === 2 && !(await claimFence(stored.reservation, 'dispatch'))) return false;
      if (stored.version === 1) {
        const legacyFence = await requestFence.read(fenceKey(requestId));
        if (
          legacyFence?.revision !== 0 ||
          legacyFence.bytes.length !== 1 ||
          legacyFence.bytes[0] !== 1
        )
          return false;
      }
      return save({ ...stored, dispatch: original.data }, 0);
    },
    async cancelBeforeDispatch(input) {
      const scope = cancellationScope.safeParse(input);
      if (!scope.success) return false;
      const stored = await load(scope.data.requestId);
      if (!stored || stored.version !== 2 || stored.dispatch) return false;
      const { account, bindingId, networkId } = stored.reservation;
      if (
        account !== scope.data.account ||
        bindingId !== scope.data.bindingId ||
        networkId !== scope.data.networkId
      )
        return false;
      return claimFence(stored.reservation, 'cancelled');
    },
  };
}
