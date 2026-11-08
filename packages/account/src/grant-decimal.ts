import { z } from 'zod';

const decimal = z
  .string()
  .min(1)
  .max(39)
  .refine((value) => !/[^0-9]/.test(value));
const U128_MAX = (1n << 128n) - 1n;

/** Bound untrusted text before conversion; existing grant scopes permit leading zeroes. */
export function parseGrantU128(value: unknown, canonical = false): bigint | undefined {
  const parsed = decimal.safeParse(value);
  if (!parsed.success || (canonical && parsed.data.length > 1 && parsed.data.startsWith('0')))
    return undefined;
  const number = BigInt(parsed.data);
  return number <= U128_MAX ? number : undefined;
}
