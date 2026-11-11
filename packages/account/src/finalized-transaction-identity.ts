import { z } from 'zod';

const hex32 = z.string().regex(/^[0-9a-f]{64}$/);

/** Serialized identity staged before a Ledger 9 wallet forwards the transaction. */
export const finalizedTransactionIdentitySchema = z
  .strictObject({
    txHash: hex32,
    bytesSha256: hex32,
    identifiers: z
      .array(z.string().regex(/^(?:[0-9a-f]{64}|[0-9a-f]{66})$/))
      .min(1)
      .max(64)
      .refine((ids) => new Set(ids).size === ids.length)
      .readonly(),
  })
  .readonly();
