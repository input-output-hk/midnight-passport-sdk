import { utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { grantWireHex32, timestamp } from './grant-request-wire.js';
import { PassportConnectorError } from './errors.js';
import { decodeMutationValue, encodeMutationValue, mutationDigest } from './mutation-codec.js';
import type { MutationByteStore } from './mutation-types.js';

const uint32 = z
  .bigint()
  .min(0n)
  .max((1n << 32n) - 1n);
export const agentIssueRecordSchema = z
  .strictObject({
    requestId: z.uuid(),
    admissionDigest: grantWireHex32,
    admittedAt: timestamp,
    salt: grantWireHex32,
    expectedIssuedAt: z
      .bigint()
      .positive()
      .max((1n << 64n) - 1n),
    epoch: uint32,
    generation: uint32,
  })
  .readonly();

export type AgentGrantIssueRecord = z.infer<typeof agentIssueRecordSchema>;

/** The opening must be retained confidentially, separately from the durable nonce tombstone. */
export interface AgentGrantIssueJournal {
  read(requestId: string): Promise<AgentGrantIssueRecord | undefined>;
  reserve(record: AgentGrantIssueRecord): Promise<boolean>;
}

export class AgentGrantIssueUnsettled extends PassportConnectorError {
  constructor(
    readonly requestId: string,
    cause?: unknown,
  ) {
    super('MutationUnsettled', `Reconcile original agent grant request ${requestId}.`, {
      cause,
      retryable: false,
    });
  }
}

export function parseAgentIssueRecord(input: unknown, requestId: string): AgentGrantIssueRecord {
  const parsed = agentIssueRecordSchema.safeParse(input);
  if (!parsed.success || parsed.data.requestId !== requestId)
    throw new AgentGrantIssueUnsettled(requestId);
  return parsed.data;
}

function key(requestId: string): string {
  if (!z.uuid().safeParse(requestId).success)
    throw new PassportConnectorError('GrantScopeInvalid', 'Invalid grant request ID.');
  return mutationDigest({ kind: 'agent-jubjub-grant-issue', requestId }).slice(0, 32);
}

/** Back this with authenticated, encrypted, atomic and crash-durable storage. */
export function createAgentGrantIssueJournal(store: MutationByteStore): AgentGrantIssueJournal {
  return {
    async read(requestId) {
      const slot = await store.read(key(requestId));
      if (!slot) return undefined;
      try {
        if (slot.bytes.length > 2048 || slot.revision !== 0)
          throw new AgentGrantIssueUnsettled(requestId);
        const encoded = JSON.parse(String.fromCharCode(...slot.bytes));
        return parseAgentIssueRecord(decodeMutationValue(encoded), requestId);
      } catch {
        throw new AgentGrantIssueUnsettled(requestId);
      } finally {
        slot.bytes.fill(0);
      }
    },
    async reserve(record) {
      const checked = parseAgentIssueRecord(record, record.requestId);
      const bytes = utf8ToBytes(JSON.stringify(encodeMutationValue(checked)));
      try {
        return await store.compareAndSwap(key(checked.requestId), undefined, {
          revision: 0,
          bytes,
        });
      } finally {
        bytes.fill(0);
      }
    },
  };
}
