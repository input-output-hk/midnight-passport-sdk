// What the fakes share. Platform-neutral: no test framework, no `node:`, no DOM types.
import {
  PASSPORT_ERROR_TYPE,
  isRetryable,
  type PassportErrorCode,
} from '@midnight-ntwrk/mn-passport-protocol';

/** An error the core reads under `code`, made without the account root. */
export const passportError = (code: PassportErrorCode, message: string): Error =>
  Object.assign(new Error(message), {
    name: PASSPORT_ERROR_TYPE,
    type: PASSPORT_ERROR_TYPE,
    code,
    retryable: isRetryable(code),
  });

export const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
export const unhex = (text: string): Uint8Array =>
  Uint8Array.from(text.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
export const ascii = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));
export const sameBytes = (a?: Uint8Array, b?: Uint8Array): boolean =>
  a !== undefined && b !== undefined && hex(a) === hex(b);

/** A deterministic 32-byte digest (FNV-1a, chained): a fake binding's hash, not a cryptographic one. */
export function fakeDigest(text: string): Uint8Array {
  const out = new Uint8Array(32);
  let h = 0x811c9dc5;
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ round, 0x01000193) >>> 0;
    out.set([h >>> 24, (h >>> 16) & 255, (h >>> 8) & 255, h & 255], round * 4);
  }
  return out;
}
