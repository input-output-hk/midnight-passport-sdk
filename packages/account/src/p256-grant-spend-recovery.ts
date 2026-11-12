import { utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { AGENT_GRANT_SPEND_CIRCUIT } from '@input-output-hk/mn-passport-protocol';
import { toHex } from './codec.js';
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

const agentReservationSchema = reservationSchema.extend({
  circuit: z.literal(AGENT_GRANT_SPEND_CIRCUIT),
  epoch: u64,
  generation: u64,
  validUntilSeconds: z.number().int().nonnegative(),
});
export type AgentGrantSpendReservation = z.infer<typeof agentReservationSchema>;

interface GrantSpendRecord<R> {
  readonly reservation: R;
  /** Exact finalized bytes durably identified before broadcast. */
  readonly transaction?: P256GrantSpendTransaction;
  readonly acknowledgedHash?: string;
}

interface GrantSpendReceiptStore<R extends P256GrantSpendReservation> {
  read(requestId: string): ReturnType<P256GrantSpendJournal['read']>;
  readRecord(requestId: string): Promise<GrantSpendRecord<R> | undefined>;
  matchesCallArguments(reservation: R, args: readonly unknown[]): boolean;
  reserve(reservation: R): Promise<boolean>;
  stageTransaction(reservation: R, transaction: P256GrantSpendTransaction): Promise<boolean>;
  recordTransaction(reservation: R, txHash: string): Promise<void>;
}

export type P256GrantSpendRecord = GrantSpendRecord<P256GrantSpendReservation>;
export type P256GrantSpendReceiptStore = GrantSpendReceiptStore<P256GrantSpendReservation>;
export type AgentGrantSpendReceiptStore = GrantSpendReceiptStore<AgentGrantSpendReservation>;

function unsettled(): never {
  throw new PassportConnectorError(
    'MutationUnsettled',
    'The original grant spend record cannot be verified.',
    { retryable: false },
  );
}

function key(requestId: string, kind = 'p256-grant-spend'): string {
  if (!uuid.safeParse(requestId).success) return unsettled();
  return mutationDigest({ kind, requestId }).slice(0, 32);
}

/**
 * Create a receipt journal on a dedicated, trusted crash-durable CAS store.
 * It keeps public correlation data and a digest, with no key, opening or raw transaction.
 */
export function createP256GrantSpendJournal(store: MutationByteStore): P256GrantSpendReceiptStore {
  return createGrantSpendJournal(store, 'p256-grant-spend', reservationSchema);
}

/** Independent receipt namespace for the direct JubJub agent spend circuit. */
export function createAgentGrantSpendJournal(
  store: MutationByteStore,
): AgentGrantSpendReceiptStore {
  const journal = createGrantSpendJournal(
    store,
    'agent-jubjub-grant-spend',
    agentReservationSchema,
  );
  return {
    ...journal,
    async reserve(reservation) {
      const original = agentReservationSchema.parse(reservation);
      const { networkId, account, grantId, issuedAt, epoch, generation, previousNonce } = original;
      const key = mutationDigest({
        kind: 'agent-jubjub-grant-spend-nonce',
        networkId,
        account,
        grantId,
        issuedAt,
        epoch,
        generation,
        previousNonce,
      }).slice(0, 32);
      if (
        !(await store.compareAndSwap(key, undefined, {
          revision: 0,
          bytes: utf8ToBytes(original.requestId),
        }))
      )
        return false;
      return journal.reserve(original);
    },
  };
}

function createGrantSpendJournal<R extends P256GrantSpendReservation>(
  store: MutationByteStore,
  namespace: string,
  schema: z.ZodType<R>,
): GrantSpendReceiptStore<R> {
  const recordSchema = z.strictObject({
    version: z.literal(1),
    reservation: schema,
    transaction: identitySchema.optional(),
    acknowledgedHash: hex.optional(),
  });
  type RecordData = z.infer<typeof recordSchema>;
  async function load(requestId: string) {
    const slot = await store.read(key(requestId, namespace));
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
    return store.compareAndSwap(key(value.reservation.requestId, namespace), expected, {
      revision: (expected ?? -1) + 1,
      bytes: utf8ToBytes(JSON.stringify(value)),
    });
  }
  async function current(reservation: R) {
    const expected = schema.safeParse(reservation);
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
      const parsed = schema.safeParse(reservation);
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
  return observeGrantSpendFinality(reservation.data, original.data, finality);
}

async function observeGrantSpendFinality(
  reservation: P256GrantSpendReservation,
  original: P256GrantSpendTransaction,
  finality: P256GrantSpendFinalitySource,
): Promise<P256GrantSpendRecovery> {
  const seen = await finality.readFinalized(original);
  if (!seen || !Number.isSafeInteger(seen.blockHeight) || seen.blockHeight < 1)
    return { kind: 'unknown' };
  const { blockHeight, ...transaction } = seen;
  const observed = identitySchema.safeParse(transaction);
  if (!observed.success || mutationDigest(observed.data) !== mutationDigest(original))
    return { kind: 'unknown' };
  return {
    kind: 'confirmed',
    requestId: reservation.requestId,
    intentSha256: reservation.intentSha256,
    txHash: original.txHash,
    blockHeight,
  };
}

/** Recover only after exact transaction finality and the original ACC spend state agree. */
export async function recoverAgentGrantSpend(
  requestId: string,
  receipts: Pick<AgentGrantSpendReceiptStore, 'readRecord'>,
  finality: P256GrantSpendFinalitySource,
  grants: import('./ports/p256-grant-spend.js').P256GrantSpendSource,
): Promise<P256GrantSpendRecovery> {
  key(requestId, 'agent-jubjub-grant-spend');
  const record = await receipts.readRecord(requestId);
  if (!record?.transaction) return { kind: 'unknown' };
  const reservation = agentReservationSchema.safeParse(record.reservation);
  const original = identitySchema.safeParse(record.transaction);
  if (
    !reservation.success ||
    !original.success ||
    reservation.data.requestId !== requestId ||
    (record.acknowledgedHash !== undefined && record.acknowledgedHash !== original.data.txHash)
  )
    return unsettled();
  const expected = reservation.data;
  const checkPins = () => {
    if (expected.networkId !== finality.networkId || expected.networkId !== grants.networkId)
      throw new PassportConnectorError(
        'NetworkMismatch',
        'The original spend used another network.',
      );
    if (grants.bindingId !== 'acc-s3r1.1')
      throw new PassportConnectorError(
        'BindingUnsupported',
        'Agent spend recovery requires acc-s3r1.1.',
      );
  };
  checkPins();
  const result = await observeGrantSpendFinality(expected, original.data, finality);
  checkPins();
  if (result.kind === 'unknown') return result;
  const live = await grants.readP256GrantSpendContext(expected.account, expected.grantId);
  checkPins();
  if (
    !live ||
    live.issuedAt.toString() !== expected.issuedAt ||
    live.grantEpoch.toString() !== expected.epoch ||
    live.grantGeneration.toString() !== expected.generation ||
    live.nonce !== BigInt(expected.previousNonce) + 1n ||
    toHex(live.spentCommit) !== expected.expectedSpentCommit
  )
    return { kind: 'unknown' };
  return result;
}
