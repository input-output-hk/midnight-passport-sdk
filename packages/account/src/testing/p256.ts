// The P-256 arm's assertion as wa-json134 shapes it, over Web Crypto, which browsers and Node both
// have: the fakes sign with fixed test keys, and the suites verify any adapter's authorisation.
import type { CurvePoint, P256Authorisation, WebAuthnPolicy } from '../ports/index.js';
import { ascii, hex, sameBytes, unhex } from './support.js';

/** Web Crypto's members used here; the package compiles without DOM types. */
interface Subtle {
  importKey(f: 'jwk', key: object, alg: object, x: boolean, use: string[]): Promise<unknown>;
  sign(alg: object, key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  verify(alg: object, key: unknown, sig: Uint8Array, data: Uint8Array): Promise<boolean>;
  digest(alg: 'SHA-256', data: Uint8Array): Promise<ArrayBuffer>;
}
const web = globalThis as unknown as { crypto: { subtle: Subtle }; btoa(text: string): string };
const ES256 = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };

/** Two fixed P-256 test keys, for two devices. Test only: published, so worthless. */
export const FAKE_P256_KEYS = [
  {
    d: 0x26eaff00cd3db2a5b8edf05f0b91e906c69726731e572ebd70372d526b6d56a6n,
    x: 0xfe75afe8affae8ec7152483b001f9ae4bf6713f4a92235bafacfbbc0d9134415n,
    y: 0xde04c654dcc0a6f73307e4f839e815defa7387a01b394c86dd7926594c8c4e4cn,
  },
  {
    d: 0x672551498b15bf9c84f2085dcfde24d93a1d2ab1f1a2e60fca878c5f521bfe71n,
    x: 0x6f282782b5ff8846ff5c5aed34a06054378d9d94c48313e242c670b0ba74cfc2n,
    y: 0x75cea496c446ec3f24a9158b23e698576e1d57f090ecf66e912aa15b48e40335n,
  },
] as const;

const be32 = (n: bigint) => unhex(n.toString(16).padStart(64, '0'));
const b64url = (bytes: Uint8Array) =>
  web
    .btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const jwk = (key: CurvePoint & { d?: bigint }) => ({
  kty: 'EC',
  crv: 'P-256',
  x: b64url(be32(key.x)),
  y: b64url(be32(key.y)),
  ...(key.d !== undefined && { d: b64url(be32(key.d)) }),
});

/** What the authenticator signs: authenticatorData, then SHA-256 of wa-json134's clientDataJSON. */
async function signedBytes(data: Uint8Array, challenge: Uint8Array, origin: Uint8Array) {
  const clientData = JSON.stringify({
    type: 'webauthn.get',
    challenge: b64url(challenge),
    origin: String.fromCharCode(...origin),
    crossOrigin: false,
  });
  const digest = await web.crypto.subtle.digest('SHA-256', ascii(clientData));
  return Uint8Array.from([...data, ...new Uint8Array(digest)]);
}

/** A wa-json134 assertion over `challenge` by `key`, with UP and UV set. */
export async function signP256(
  key: CurvePoint & { d: bigint },
  challenge: Uint8Array,
  policy: WebAuthnPolicy,
): Promise<Pick<P256Authorisation, 'authenticatorData' | 'sig'>> {
  const authenticatorData = Uint8Array.from([...policy.rp_id_hash, 5, 0, 0, 0, 0]);
  const subtle = web.crypto.subtle;
  const signer = await subtle.importKey('jwk', jwk(key), ES256, false, ['sign']);
  const message = await signedBytes(authenticatorData, challenge, policy.origin);
  const sig = new Uint8Array(await subtle.sign(ES256, signer, message));
  const big = (b: Uint8Array) => BigInt(`0x${hex(b)}`);
  return { authenticatorData, sig: { r: big(sig.slice(0, 32)), s: big(sig.slice(32)) } };
}

/** Whether `auth` is a wa-json134 assertion over `challenge` by its own `pk`, under `policy`. */
export async function verifyP256(
  auth: Pick<P256Authorisation, 'pk' | 'authenticatorData' | 'sig'>,
  challenge: Uint8Array,
  policy: WebAuthnPolicy,
): Promise<boolean> {
  const data = auth.authenticatorData;
  const flags = data[32] ?? 0;
  if (data.length !== 37 || !sameBytes(data.slice(0, 32), policy.rp_id_hash)) return false;
  if (![5, 13, 29].includes(flags)) return false;
  try {
    const subtle = web.crypto.subtle;
    const key = await subtle.importKey('jwk', jwk(auth.pk), ES256, false, ['verify']);
    const sig = Uint8Array.from([...be32(auth.sig.r), ...be32(auth.sig.s)]);
    return await subtle.verify(ES256, key, sig, await signedBytes(data, challenge, policy.origin));
  } catch {
    return false; // not a point on the curve, say
  }
}
