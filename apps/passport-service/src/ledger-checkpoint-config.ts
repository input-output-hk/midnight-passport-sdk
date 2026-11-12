import { z } from 'zod';

export const checkpointHash = z.string().regex(/^[0-9a-f]{64}$/);
const httpUrl = z.url({ protocol: /^https?$/ });
export const ledgerCheckpointConfig = z.strictObject({
  directory: z.string().min(1),
  nodeUrl: httpUrl,
  indexerUrl: httpUrl,
  genesisHash: checkpointHash,
  metadataSha256: checkpointHash,
  retainedBlocks: z.number().int().min(2).max(128).default(32),
  blocksPerAdvance: z.number().int().min(1).max(32).default(8),
});
export type LedgerCheckpointConfig = z.output<typeof ledgerCheckpointConfig>;
export const ledgerCheckpointJob = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('advance'),
    throughHeight: z.number().int().nonnegative().optional(),
  }),
  z.object({ kind: z.literal('read'), blockHash: checkpointHash }),
]);
export type LedgerCheckpointJob = z.output<typeof ledgerCheckpointJob>;
