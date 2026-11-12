import { utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { PassportConnectorError } from './errors.js';
import { fromHex, toHex } from './codec.js';
import { decodeMutationValue, mutationDigest } from './mutation-codec.js';
import type { MutationByteStore, MutationValue } from './mutation-types.js';
import { shieldedEffectHex } from './shielded-withdrawal-journal.js';
import { NetworkIdSchema } from './validation.js';

const uuid = z.uuid();
const hex32 = shieldedEffectHex;
export const backfillCircuit = z.enum(['append_inbox_with_p256', 'append_inbox_with_jubjub']);
const slotSchema = z.strictObject({
  networkId: NetworkIdSchema,
  account: hex32,
  commitment: hex32,
});
const recordSchema = slotSchema
  .extend({
    version: z.literal(1),
    withdrawalId: uuid,
    withdrawalTxHash: hex32,
    appendId: uuid,
    circuit: backfillCircuit,
    entry: z.string().regex(/^[0-9a-f]{384}$/),
    encKey: hex32,
    minInboxIndex: z.number().int().min(0).max(4095),
    callArgsSha256: hex32,
  })
  .readonly();

const uint64 = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,19})$/)
  .refine((value) => value.length < 20 || value <= '18446744073709551615');
const continuationSchema = z
  .strictObject({
    intentSha256: hex32,
    signedArgs: z.string().min(1).max(4096),
    deviceEntry: hex32,
    deviceEpoch: uint64,
    authNonce: uint64,
  })
  .readonly();
const resumableRecord = z
  .strictObject({
    version: z.literal(2),
    record: recordSchema,
    continuation: continuationSchema,
  })
  .readonly();
const storedSchema = z.union([recordSchema, resumableRecord]);
const maxRecordBytes = 8192;

export type ShieldedBackfillContinuation = z.input<typeof continuationSchema>;
export type ShieldedBackfillSlot = z.input<typeof slotSchema>;
export type ShieldedBackfillRecord = z.input<typeof recordSchema>;

export interface ShieldedBackfillJournal {
  read(slot: ShieldedBackfillSlot): Promise<ShieldedBackfillRecord | undefined>;
  /** Atomically reserve the original append. A failed or interrupted reserve never authorizes retry. */
  reserve(
    record: ShieldedBackfillRecord,
    continuation?: ShieldedBackfillContinuation,
  ): Promise<boolean>;
  /** Read signed arguments only from protected storage and a matching independent fence. */
  readContinuation?(slot: ShieldedBackfillSlot): Promise<ShieldedBackfillContinuation | undefined>;
}

export function backfillUnsettled(): never {
  throw new PassportConnectorError(
    'MutationUnsettled',
    'Reconcile the original shielded change inbox append before retrying.',
    { retryable: false },
  );
}

function keys(slot: ShieldedBackfillSlot) {
  const parsed = slotSchema.safeParse({
    networkId: slot.networkId,
    account: slot.account,
    commitment: slot.commitment,
  });
  if (!parsed.success) return backfillUnsettled();
  const key = (kind: string) => mutationDigest({ kind, ...parsed.data }).slice(0, 32);
  return { record: key('shielded-backfill'), fence: key('shielded-backfill-fence') };
}

export function readBackfillArguments(
  record: ShieldedBackfillRecord,
  input: ShieldedBackfillContinuation,
): readonly unknown[] {
  try {
    const continuation = continuationSchema.parse(input);
    const args = decodeMutationValue(JSON.parse(continuation.signedArgs) as MutationValue);
    if (
      continuation.intentSha256 !== mutationDigest(record) ||
      !Array.isArray(args) ||
      args.length !== (record.circuit === 'append_inbox_with_p256' ? 2 : 6) ||
      !(args[0] instanceof Uint8Array) ||
      toHex(args[0]) !== record.entry ||
      mutationDigest(args) !== record.callArgsSha256
    )
      return backfillUnsettled();
    return args;
  } catch {
    return backfillUnsettled();
  }
}

/** Keep the encrypted record and opaque change marker in independent, crash-durable CAS stores. */
export function createShieldedBackfillJournal(
  protectedStore: MutationByteStore,
  fence: MutationByteStore,
): ShieldedBackfillJournal {
  if (protectedStore === fence) return backfillUnsettled();
  async function readStored(slot: ShieldedBackfillSlot) {
    const key = keys(slot);
    const stored = await protectedStore.read(key.record);
    if (!stored) {
      if (await fence.read(key.fence)) return backfillUnsettled();
      return undefined;
    }
    try {
      if (stored.revision !== 0 || stored.bytes.length > maxRecordBytes) return backfillUnsettled();
      const value = storedSchema.parse(JSON.parse(String.fromCharCode(...stored.bytes)));
      const record = value.version === 2 ? value.record : value;
      if (keys(record).record !== key.record) return backfillUnsettled();
      return value;
    } catch {
      return backfillUnsettled();
    } finally {
      stored.bytes.fill(0);
    }
  }
  return {
    async read(slot) {
      const stored = await readStored(slot);
      return stored?.version === 2 ? stored.record : stored;
    },
    async readContinuation(slot) {
      const stored = await readStored(slot);
      if (stored?.version !== 2) return undefined;
      const marker = await fence.read(keys(slot).fence);
      if (
        marker?.revision !== 0 ||
        marker.bytes.length !== 32 ||
        toHex(marker.bytes) !== mutationDigest(stored)
      )
        return backfillUnsettled();
      return stored.continuation;
    },
    async reserve(record, continuation) {
      const original = parseBackfillRecord(record);
      const parsed = resumableRecord.safeParse({ version: 2, record: original, continuation });
      if (continuation !== undefined && !parsed.success) return backfillUnsettled();
      const stored = parsed.success ? parsed.data : original;
      if (stored.version === 2) readBackfillArguments(stored.record, stored.continuation);
      const key = keys(original);
      const bytes = utf8ToBytes(JSON.stringify(stored));
      try {
        if (bytes.length > maxRecordBytes) return backfillUnsettled();
        if (
          !(await fence.compareAndSwap(key.fence, undefined, {
            revision: 0,
            bytes: stored.version === 2 ? fromHex(mutationDigest(stored)) : Uint8Array.of(1),
          }))
        )
          return false;
        return await protectedStore.compareAndSwap(key.record, undefined, { revision: 0, bytes });
      } finally {
        bytes.fill(0);
      }
    },
  };
}

export function parseBackfillRecord(record: ShieldedBackfillRecord): ShieldedBackfillRecord {
  const parsed = recordSchema.safeParse(record);
  if (!parsed.success) return backfillUnsettled();
  return parsed.data;
}
