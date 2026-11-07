import { z } from 'zod';
import type { AccountHint } from '@input-output-hk/mn-passport-account/ports';
import { fromHex } from './hex.js';

const hex = (maximum: number) =>
  z
    .string()
    .min(2)
    .max(maximum)
    .regex(/^(?:[0-9a-f]{2})+$/i);
const coordinate = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[0-9a-f]+$/i);
const hintSchema = z.object({
  address: z.string().regex(/^[0-9a-f]{64}$/),
  scheme: z.enum(['p256-webauthn', 'jubjub-schnorr', 'k256-ecdsa']),
  publicKey: z.object({ x: coordinate, y: coordinate }),
  credentialId: hex(2048).optional(),
  salt: hex(64).length(64).optional(),
  keyEntries: z
    .array(z.string().regex(/^[0-9a-f]{384}$/))
    .max(16)
    .optional(),
  policy: z.object({ rp_id_hash: hex(64).length(64), origin: hex(2048) }).optional(),
  status: z.enum(['deployed', 'active']),
});

/** Shape/size validation only. The account core still verifies hints against the live ledger. */
export function directoryHint(value: unknown): AccountHint {
  const parsed = hintSchema.safeParse(value);
  if (!parsed.success) throw new Error('Invalid directory hint.');
  const hint = parsed.data;
  return {
    address: hint.address,
    scheme: hint.scheme,
    publicKey: { x: BigInt(`0x${hint.publicKey.x}`), y: BigInt(`0x${hint.publicKey.y}`) },
    ...(hint.credentialId !== undefined && { credentialId: fromHex(hint.credentialId) }),
    ...(hint.salt !== undefined && { salt: fromHex(hint.salt) }),
    ...(hint.keyEntries !== undefined && { keyEntries: hint.keyEntries.map(fromHex) }),
    ...(hint.policy !== undefined && {
      policy: { rp_id_hash: fromHex(hint.policy.rp_id_hash), origin: fromHex(hint.policy.origin) },
    }),
    status: hint.status,
  };
}
