import { utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { PassportConnectorError } from './errors.js';
import { finalizedTransactionIdentitySchema as identitySchema } from './finalized-transaction-identity.js';
import { mutationDigest } from './mutation-codec.js';
import type { MutationByteStore } from './mutation-types.js';
import type { P256GrantSpendJournal, P256GrantSpendReservation } from './p256-grant-holder.js';
import { AmountSchema, NetworkIdSchema } from './validation.js';

const hex = z.string().regex(/^[0-9a-f]{64}$/);
const uuid = z.uuid();
const u64 = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,19})$/)
  .refine((value) => value.length < 20 || (/^[0-9]{20}$/.test(value) && BigInt(value) < 1n << 64n));
const reservationSchema = z.strictObject({
  requestId: uuid,
  intentSha256: hex,
  networkId: NetworkIdSchema,
  account: hex,
  grantId: hex,
  color: hex,
  amount: AmountSchema,
  recipient: hex,
  issuedAt: u64,
  previousNonce: u64,
  expectedSpentCommit: hex,
  callArgsSha256: hex,
});
export type P256GrantSpendTransaction = z.infer<typeof identitySchema>;

const recordSchema = z.strictObject({
  version: z.literal(1),
  reservation: reservationSchema,
  transaction: identitySchema.optional(),
  acknowledgedHash: hex.optional(),
});

type RecordData = z.infer<typeof recordSchema>;

export interface P256GrantSpendRecord {
  readonly reservation: P256GrantSpendReservation;
  /** Exact finalized bytes were durably identified before the network submit was attempted. */
  readonly transaction?: P256GrantSpendTransaction;
  readonly acknowledgedHash?: string;
}

export interface P256GrantSpendReceiptStore extends P256GrantSpendJournal {
  readRecord(requestId: string): Promise<P256GrantSpendRecord | undefined>;
  /** Compare a local Compact invocation to the original reviewed signed arguments. */
  matchesCallArguments(reservation: P256GrantSpendReservation, args: readonly unknown[]): boolean;
  /** Persist an immutable dispatch record. A false result refuses a second forward. */
  stageTransaction(
    reservation: P256GrantSpendReservation,
    transaction: P256GrantSpendTransaction,
  ): Promise<boolean>;
}

function unsettled(): never {
  throw new PassportConnectorError(
    'MutationUnsettled',
    'The original P-256 grant spend record cannot be verified.',
    { retryable: false },
  );
}

function key(requestId: string): string {
  if (!uuid.safeParse(requestId).success) return unsettled();
  return mutationDigest({ kind: 'p256-grant-spend', requestId }).slice(0, 32);
}

/**
 * Create a receipt journal on a dedicated, trusted crash-durable CAS store.
 * It keeps public correlation data and a digest, with no key, opening or raw transaction.
 */
export function createP256GrantSpendJournal(store: MutationByteStore): P256GrantSpendReceiptStore {
  async function load(requestId: string) {
    const slot = await store.read(key(requestId));
    if (!slot) return undefined;
    if (slot.bytes.length > 8192) return unsettled();
    try {
      const value = recordSchema.parse(JSON.parse(String.fromCharCode(...slot.bytes)));
      if (
        value.reservation.requestId !== requestId ||
        (value.acknowledgedHash !== undefined &&
          value.acknowledgedHash !== value.transaction?.txHash) ||
        slot.revision !== (value.acknowledgedHash ? 2 : value.transaction ? 1 : 0)
      )
        return unsettled();
      return { value, revision: slot.revision };
    } catch {
      return unsettled();
    }
  }
  async function save(value: RecordData, expected: number | undefined) {
    return store.compareAndSwap(key(value.reservation.requestId), expected, {
      revision: (expected ?? -1) + 1,
      bytes: utf8ToBytes(JSON.stringify(value)),
    });
  }
  async function current(reservation: P256GrantSpendReservation) {
    const expected = reservationSchema.safeParse(reservation);
    if (!expected.success) return unsettled();
    const slot = await load(expected.data.requestId);
    if (!slot || mutationDigest(slot.value.reservation) !== mutationDigest(expected.data))
      return unsettled();
    return slot;
  }
  return {
    matchesCallArguments(reservation, args) {
      return mutationDigest(args) === reservation.callArgsSha256;
    },
    async read(requestId) {
      const row = await load(requestId);
      if (!row) return undefined;
      return row.value.acknowledgedHash ? { txHash: row.value.acknowledgedHash } : {};
    },
    async readRecord(requestId) {
      const row = await load(requestId);
      if (!row) return undefined;
      const { reservation, transaction, acknowledgedHash } = row.value;
      return {
        reservation,
        ...(transaction && { transaction }),
        ...(acknowledgedHash && { acknowledgedHash }),
      };
    },
    async reserve(reservation) {
      const parsed = reservationSchema.safeParse(reservation);
      if (!parsed.success) return unsettled();
      return save({ version: 1, reservation: parsed.data }, undefined);
    },
    async stageTransaction(reservation, transaction) {
      const parsed = identitySchema.safeParse(transaction);
      if (!parsed.success) return unsettled();
      const slot = await current(reservation);
      if (slot.value.transaction) return false;
      return save({ ...slot.value, transaction: parsed.data }, slot.revision);
    },
    async recordTransaction(reservation, txHash) {
      const slot = await current(reservation);
      if (slot.value.transaction?.txHash !== txHash) return unsettled();
      if (slot.value.acknowledgedHash === txHash) return;
      if (await save({ ...slot.value, acknowledgedHash: txHash }, slot.revision)) return;
      if ((await current(reservation)).value.acknowledgedHash !== txHash) return unsettled();
    },
  };
}

export interface P256GrantSpendFinalitySource {
  readonly networkId: string;
  /** Return success for this exact original transaction only after finality. Observation never sends. */
  readFinalized(
    transaction: P256GrantSpendTransaction,
  ): Promise<(P256GrantSpendTransaction & { readonly blockHeight: number }) | undefined>;
}

export type P256GrantSpendRecovery =
  | { readonly kind: 'unknown' }
  | {
      readonly kind: 'confirmed';
      readonly requestId: string;
      readonly intentSha256: string;
      readonly txHash: string;
      readonly blockHeight: number;
    };

/** Observe the exact durable transaction after restart, without signer, proof or submit ports. */
export async function recoverP256GrantSpend(
  requestId: string,
  receipts: Pick<P256GrantSpendReceiptStore, 'readRecord'>,
  finality: P256GrantSpendFinalitySource,
): Promise<P256GrantSpendRecovery> {
  key(requestId);
  const record = await receipts.readRecord(requestId);
  if (!record?.transaction) return { kind: 'unknown' };
  const reservation = reservationSchema.safeParse(record.reservation);
  const original = identitySchema.safeParse(record.transaction);
  if (!reservation.success || !original.success || reservation.data.requestId !== requestId)
    return unsettled();
  if (reservation.data.networkId !== finality.networkId)
    throw new PassportConnectorError('NetworkMismatch', 'The original spend used another network.');
  const seen = await finality.readFinalized(original.data);
  if (!seen || !Number.isSafeInteger(seen.blockHeight) || seen.blockHeight < 1)
    return { kind: 'unknown' };
  const { blockHeight, ...transaction } = seen;
  const observed = identitySchema.safeParse(transaction);
  if (!observed.success || mutationDigest(observed.data) !== mutationDigest(original.data))
    return { kind: 'unknown' };
  return {
    kind: 'confirmed',
    requestId,
    intentSha256: reservation.data.intentSha256,
    txHash: original.data.txHash,
    blockHeight,
  };
}
