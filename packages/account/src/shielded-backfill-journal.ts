import { utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { PassportConnectorError } from './errors.js';
import { mutationDigest } from './mutation-codec.js';
import type { MutationByteStore } from './mutation-types.js';
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

export type ShieldedBackfillSlot = z.input<typeof slotSchema>;
export type ShieldedBackfillRecord = z.input<typeof recordSchema>;

export interface ShieldedBackfillJournal {
  read(slot: ShieldedBackfillSlot): Promise<ShieldedBackfillRecord | undefined>;
  /** Atomically reserve the original append. A failed or interrupted reserve never authorizes retry. */
  reserve(record: ShieldedBackfillRecord): Promise<boolean>;
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

/** Keep the encrypted record and opaque change marker in independent, crash-durable CAS stores. */
export function createShieldedBackfillJournal(
  protectedStore: MutationByteStore,
  fence: MutationByteStore,
): ShieldedBackfillJournal {
  if (protectedStore === fence) return backfillUnsettled();
  return {
    async read(slot) {
      const key = keys(slot);
      const stored = await protectedStore.read(key.record);
      if (!stored) {
        if (await fence.read(key.fence)) return backfillUnsettled();
        return undefined;
      }
      try {
        if (stored.revision !== 0 || stored.bytes.length > 4096) return backfillUnsettled();
        const value = recordSchema.parse(JSON.parse(String.fromCharCode(...stored.bytes)));
        if (keys(value).record !== key.record) return backfillUnsettled();
        return value;
      } catch {
        return backfillUnsettled();
      } finally {
        stored.bytes.fill(0);
      }
    },
    async reserve(record) {
      const parsed = recordSchema.safeParse(record);
      if (!parsed.success) return backfillUnsettled();
      const key = keys(parsed.data);
      if (
        !(await fence.compareAndSwap(key.fence, undefined, {
          revision: 0,
          bytes: Uint8Array.of(1),
        }))
      )
        return false;
      const bytes = utf8ToBytes(JSON.stringify(parsed.data));
      try {
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
