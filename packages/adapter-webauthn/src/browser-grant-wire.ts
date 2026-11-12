import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import { z } from 'zod';
import { base64url, fromBase64url } from './webauthn.js';

const invalidBase64urlCharacter = /[^A-Za-z0-9_-]/;
export const grantWireHex32 = z
  .string()
  .length(64)
  .regex(/^[0-9a-f]{64}$/);
export const grantWireUint128 = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,38})$/)
  .refine((value) => !/[^0-9]/.test(value) && BigInt(value) < 1n << 128n);
export const chainReference = z
  .string()
  .regex(/^(?:midnight:)?[a-z0-9][a-z0-9-]{0,31}$/)
  .refine((value) => !/[^a-z0-9:-]/.test(value));
export const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const bounds = z
  .strictObject({
    color: grantWireHex32,
    per_call_cap: grantWireUint128,
    cap: grantWireUint128,
    max_coin_value: grantWireUint128,
    expires_at: timestamp,
    recipient: z.strictObject({ kind: z.literal('user'), value: grantWireHex32 }).readonly(),
  })
  .readonly();

export const grantRequest = z
  .strictObject({
    v: z.literal(1),
    chain: chainReference,
    aud: z.string().max(256),
    iat: timestamp,
    exp: timestamp,
    client_id: z.string().max(256),
    redirect_uri: z.string().max(2048),
    account: grantWireHex32.optional(),
    grantee: z.strictObject({
      scheme: z.literal('ecdsa_secp256r1_webauthn'),
      pk: z
        .string()
        .length(128)
        .regex(/^[0-9a-f]{128}$/),
    }),
    grants: z.tuple([
      z.strictObject({
        slot: z.number().int().min(0).max(255),
        scope: z.tuple([z.literal('midnight:account:withdraw_unshielded')]),
        bounds,
      }),
    ]),
    state: z.string().min(22).max(512),
    nonce: grantWireHex32,
  })
  .readonly();

export const grantProof = z.strictObject({
  type: z.literal('webauthn'),
  client_data_json: z.string().max(512),
  authenticator_data: z.string().max(50),
  signature: z.string().max(100),
});

export const maxGrantParameterLength = 8192;

export function invalidBrowserGrant(): never {
  // Never include a received state, signature, nonce, or raw URL in an error.
  throw new PassportConnectorError(
    'GrantScopeInvalid',
    'Invalid or unsupported browser grant request.',
  );
}

export function decodeGrantBytes(value: string): Uint8Array {
  if (!value.length || invalidBase64urlCharacter.test(value)) return invalidBrowserGrant();
  const bytes = fromBase64url(value);
  if (base64url(bytes) !== value) return invalidBrowserGrant();
  return bytes;
}

export function decodeGrantJson(encoded: string): unknown {
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
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
      if (!members || members.has(key)) return invalidBrowserGrant();
      members.add(key);
    }
  }
  return parsed;
}

export function grantFragmentParameters(fragment: string): { request: string; proof: string } {
  if (
    typeof fragment !== 'string' ||
    fragment.length > maxGrantParameterLength * 2 + 16 ||
    !fragment.startsWith('#')
  )
    return invalidBrowserGrant();
  // Keep the exact alphabet bytes and reject encoded names and percent escapes.
  const parameters = new Map<string, string>();
  for (const pair of fragment.slice(1).split('&')) {
    const matched = /^(request|proof)=([A-Za-z0-9_-]+)$/.exec(pair);
    if (!matched?.[1] || !matched[2] || matched[0] !== pair || parameters.has(matched[1]))
      return invalidBrowserGrant();
    parameters.set(matched[1], matched[2]);
  }
  const request = parameters.get('request');
  const proof = parameters.get('proof');
  if (!request || !proof) return invalidBrowserGrant();
  return { request, proof };
}
