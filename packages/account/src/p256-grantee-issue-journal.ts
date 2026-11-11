import { utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { decodeMutationValue, encodeMutationValue, mutationDigest } from './mutation-codec.js';
import type { MutationByteStore } from './mutation-types.js';
import { p256GrantOpeningSchema } from './p256-grant-opening.js';
import {
  P256GranteeIssueUnsettled,
  type P256GranteeIssueFence,
  type P256GranteeIssueJournal,
  type P256GranteeIssueRecord,
} from './p256-grantee-issue.js';
import { NetworkIdSchema } from './validation.js';

const u32 = z
  .bigint()
  .min(0n)
  .max((1n << 32n) - 1n);
const u64 = z
  .bigint()
  .min(1n)
  .max((1n << 64n) - 1n);
const txHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const recordSchema = z
  .strictObject({
    requestId: z.uuid(),
    networkId: NetworkIdSchema,
    opening: p256GrantOpeningSchema,
    intentSha256: txHashSchema,
    expectedIssuedAt: u64,
    deviceEpoch: u32,
    grantGeneration: u32,
    txHash: txHashSchema.optional(),
  })
  .readonly();

type ParsedRecord = z.infer<typeof recordSchema>;

function fail(requestId: string): never {
  throw new P256GranteeIssueUnsettled(requestId);
}

function key(requestId: string): string {
  if (!z.uuid().safeParse(requestId).success) return fail(requestId);
  return mutationDigest({ kind: 'p256-grantee-issue', requestId }).slice(0, 32);
}

/** The underlying CAS store must authenticate and encrypt all bytes and persist before resolving. */
export function createP256GranteeIssueJournal(store: MutationByteStore): P256GranteeIssueJournal {
  async function load(requestId: string) {
    const slot = await store.read(key(requestId)).catch(() => fail(requestId));
    if (!slot) return undefined;
    if (slot.bytes.length > 8192) return fail(requestId);
    try {
      const raw = JSON.parse(String.fromCharCode(...slot.bytes));
      const value = recordSchema.parse(decodeMutationValue(raw));
      if (value.requestId !== requestId || slot.revision !== (value.txHash ? 1 : 0))
        return fail(requestId);
      return { value, revision: slot.revision };
    } catch {
      return fail(requestId);
    } finally {
      slot.bytes.fill(0);
    }
  }
  async function save(value: ParsedRecord, expected: number | undefined) {
    const bytes = utf8ToBytes(JSON.stringify(encodeMutationValue(value)));
    try {
      return await store.compareAndSwap(key(value.requestId), expected, {
        revision: (expected ?? -1) + 1,
        bytes,
      });
    } finally {
      bytes.fill(0);
    }
  }
  async function matches(original: ParsedRecord) {
    const slot = await load(original.requestId);
    if (!slot) return fail(original.requestId);
    const { txHash: acknowledged, ...retained } = slot.value;
    if (mutationDigest(retained) !== mutationDigest(original)) return fail(original.requestId);
    return { ...slot, acknowledged };
  }
  return {
    async read(requestId) {
      const slot = await load(requestId);
      if (!slot) return undefined;
      const { txHash, ...record } = slot.value;
      return { ...record, ...(txHash && { txHash }) };
    },
    async reserve(record) {
      const parsed = recordSchema.safeParse(record);
      if (!parsed.success || parsed.data.txHash !== undefined) return fail(record.requestId);
      return save(parsed.data, undefined);
    },
    async recordTransaction(record: P256GranteeIssueRecord, txHash) {
      const parsed = recordSchema.safeParse(record);
      if (
        !parsed.success ||
        parsed.data.txHash !== undefined ||
        !txHashSchema.safeParse(txHash).success
      )
        return fail(record.requestId);
      const slot = await matches(parsed.data);
      if (slot.acknowledged) {
        if (slot.acknowledged !== txHash) return fail(record.requestId);
        return;
      }
      if (await save({ ...slot.value, txHash }, slot.revision)) return;
      if ((await matches(parsed.data)).acknowledged !== txHash) return fail(record.requestId);
    },
  };
}

/** A separate durable store for opaque request tombstones, independent of the opening key and files. */
export function createP256GranteeIssueFence(store: MutationByteStore): P256GranteeIssueFence {
  const fenceKey = (requestId: string) => {
    if (!z.uuid().safeParse(requestId).success) return fail(requestId);
    return mutationDigest({ kind: 'p256-grantee-issue-fence', requestId }).slice(0, 32);
  };
  return {
    async has(requestId) {
      return (await store.read(fenceKey(requestId))) !== undefined;
    },
    reserve(requestId) {
      return store.compareAndSwap(fenceKey(requestId), undefined, {
        revision: 0,
        bytes: Uint8Array.of(1),
      });
    },
  };
}
