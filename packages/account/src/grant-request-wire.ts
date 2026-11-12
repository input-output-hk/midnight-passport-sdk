import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { PassportConnectorError } from './errors.js';
import { parseGrantU128 } from './grant-decimal.js';

export const maxGrantParameterLength = 8192;
const domain = new Uint8Array(64);
domain.set(utf8ToBytes('midnight:account:grant:request:v1'));

// These standard globals exist in supported browsers and Node. Keep their
// structural types local so SDK consumers can use an ES-only TypeScript lib.
const web = globalThis as typeof globalThis & {
  atob(value: string): string;
  btoa(value: string): string;
  TextDecoder: new (
    encoding: string,
    options: { fatal: boolean; ignoreBOM: boolean },
  ) => { decode(value: Uint8Array): string };
};

function invalidGrantParameter(): never {
  throw new PassportConnectorError('GrantScopeInvalid', 'Invalid grant parameter.');
}

function checkParameter(value: string): void {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > maxGrantParameterLength ||
    /[^A-Za-z0-9_-]/.test(value)
  )
    invalidGrantParameter();
}

/** Hash the exact transmitted request value. Parsing or re-encoding would change what was signed. */
export function grantRequestDigest(request: string): Uint8Array {
  checkParameter(request);
  return sha256(concatBytes(domain, utf8ToBytes(request)));
}

export const grantWireHex32 = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]{64}$/);
export const grantWireUint128 = z
  .string()
  .refine((value) => parseGrantU128(value, true) !== undefined);
export const chainReference = z
  .string()
  .regex(/^(?:midnight:)?[a-z0-9][a-z0-9-]{0,31}$/)
  .refine((value) => !/[^a-z0-9:-]/.test(value));
export const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

function decodeGrantBytes(value: string): Uint8Array {
  checkParameter(value);
  const bytes = Uint8Array.from(web.atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  );
  const encoded = web
    .btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  if (encoded !== value) return invalidGrantParameter();
  return bytes;
}

export function decodeGrantJson(encoded: string): unknown {
  const source = new web.TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
    decodeGrantBytes(encoded),
  );
  const parsed: unknown = JSON.parse(source);
  // JSON.parse has validated the grammar. Scan entire string tokens so colons
  // and braces inside strings never count as structure. Decode property names
  // to reject aliases such as "slot" and "\\u0073lot".
  const objects: Set<string>[] = [];
  for (const match of source.matchAll(/"(?:[^"\\]|\\.)*"\s*:?|[{}]/gs)) {
    const token = match[0];
    if (token === '{') objects.push(new Set());
    else if (token === '}') objects.pop();
    else if (token.endsWith(':')) {
      const key: string = JSON.parse(token.slice(0, -1));
      const members = objects.at(-1);
      if (!members || members.has(key)) return invalidGrantParameter();
      members.add(key);
    }
  }
  return parsed;
}
