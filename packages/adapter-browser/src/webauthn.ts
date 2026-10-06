// Ported from the planning workspace's contract/src/wallet/webauthn.ts at
// revision 45721e1 (Apache-2.0): profile wa-json134 helpers, unchanged.
// (Only `?? 0` / `?? -1` guards for noUncheckedIndexedAccess; behaviour is identical.)
// Browser-compatible transport and strict adapter for profile wa-json134.
// Client validation gives useful errors; the circuit independently rebuilds
// these signed bytes and checks RP, flags, challenge and the enrolled origin.
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

export const WEBAUTHN_PROFILE = 'wa-json134';
export const WEBAUTHN_ORIGIN_BYTES = 21;
export interface WebAuthnPolicy {
  rp_id_hash: Uint8Array;
  origin: Uint8Array;
}
export interface P256PublicKey {
  x: bigint;
  y: bigint;
  identity: boolean;
}
export interface WebAuthnAssertion {
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
}
export type AssertionProvider = (challenge: Uint8Array) => Promise<WebAuthnAssertion>;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
const fromBase64url = (s: string): Uint8Array =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const integer = (b: Uint8Array): bigint => b.reduce((n, v) => (n << 8n) | BigInt(v), 0n);

export function webauthnPolicy(rpId: string, origin: string): WebAuthnPolicy {
  const url = new URL(origin);
  if (url.origin !== origin || !/^[\x21-\x7e]+$/.test(origin) || /["\\]/.test(origin)) {
    throw new Error('WebAuthn origin must be a canonical ASCII origin');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost')) {
    throw new Error('WebAuthn requires HTTPS (or http://localhost)');
  }
  if (
    !rpId ||
    rpId !== rpId.toLowerCase() ||
    !(url.hostname === rpId || url.hostname.endsWith(`.${rpId}`))
  ) {
    throw new Error('WebAuthn RP ID must match the origin host or a registrable parent');
  }
  const bytes = encoder.encode(origin);
  if (bytes.length !== WEBAUTHN_ORIGIN_BYTES) {
    throw new Error(`${WEBAUTHN_PROFILE} requires a ${WEBAUTHN_ORIGIN_BYTES}-byte origin`);
  }
  return { rp_id_hash: sha256(encoder.encode(rpId)), origin: bytes };
}

export function clientDataJSON(challenge: Uint8Array, origin: Uint8Array): Uint8Array {
  if (challenge.length !== 32) throw new Error('WebAuthn challenge must be 32 bytes');
  if (origin.length !== WEBAUTHN_ORIGIN_BYTES)
    throw new Error('unsupported WebAuthn origin length');
  return encoder.encode(
    JSON.stringify({
      type: 'webauthn.get',
      challenge: base64url(challenge),
      origin: decoder.decode(origin),
      crossOrigin: false,
    }),
  );
}

/** Strict DER conversion: no BER lengths, negatives, redundant zeroes, tails,
 * zero or out-of-range scalars. High-S is valid ES256 and is preserved. */
export function parseES256Signature(der: Uint8Array): { r: bigint; s: bigint } {
  if (der.length < 8 || der.length > 72 || der[0] !== 0x30 || der[1] !== der.length - 2) {
    throw new Error('invalid ES256 DER sequence');
  }
  let offset = 2;
  const read = (): bigint => {
    if (der[offset++] !== 2) throw new Error('invalid ES256 DER integer');
    const length = der[offset++] ?? 0;
    const bytes = der.slice(offset, offset + length);
    offset += length;
    if (
      length < 1 ||
      length > 33 ||
      bytes.length !== length ||
      (bytes[0] ?? 0) & 0x80 ||
      (length > 1 && bytes[0] === 0 && !((bytes[1] ?? 0) & 0x80))
    ) {
      throw new Error('noncanonical ES256 DER integer');
    }
    const n = integer(bytes);
    if (n === 0n || n >= p256.Point.Fn.ORDER) throw new Error('ES256 scalar outside [1,n)');
    return n;
  };
  const r = read(),
    s = read();
  if (offset !== der.length) throw new Error('trailing ES256 DER bytes');
  return { r, s };
}

export function validateP256Key(pk: P256PublicKey): void {
  if (pk.identity) throw new Error('identity P-256 credential');
  p256.Point.fromAffine({ x: pk.x, y: pk.y }).assertValidity();
}

export function assertionMaterial(
  challenge: Uint8Array,
  policy: WebAuthnPolicy,
  pk: P256PublicKey,
  assertion: WebAuthnAssertion,
) {
  if (!equalBytes(assertion.clientDataJSON, clientDataJSON(challenge, policy.origin))) {
    throw new Error(`unsupported or mismatched clientDataJSON (${WEBAUTHN_PROFILE})`);
  }
  const data = assertion.authenticatorData;
  if (data.length !== 37 || !equalBytes(data.slice(0, 32), policy.rp_id_hash)) {
    throw new Error('WebAuthn authenticatorData length or RP mismatch');
  }
  if (![5, 13, 29].includes(data[32] ?? -1))
    throw new Error('WebAuthn requires UP+UV, no extensions, valid backup flags');
  const sig = parseES256Signature(assertion.signature);
  validateP256Key(pk);
  const message = new Uint8Array(69);
  message.set(data);
  message.set(sha256(assertion.clientDataJSON), 37);
  const key = p256.Point.fromAffine(pk).toBytes(false);
  if (!p256.verify(assertion.signature, message, key, { format: 'der', lowS: false })) {
    throw new Error('invalid WebAuthn ES256 signature');
  }
  return { pk, policy, authenticator_data: new Uint8Array(data), sig };
}
