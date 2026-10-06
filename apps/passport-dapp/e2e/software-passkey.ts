import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import type { PasskeySeam } from '@midnight-ntwrk/mn-passport-account';
import {
  bigintFromBytes,
  clientDataJSON,
  fromBase64url,
  parseES256Signature,
  webauthnPolicy,
} from '@midnight-ntwrk/mn-passport-adapter-browser';

const sha256 = (data: Uint8Array): Uint8Array =>
  new Uint8Array(createHash('sha256').update(data).digest());

/**
 * A P-256 passkey held in memory that signs exactly as a `wa-json134` authenticator does: the
 * signed message is `authenticatorData || SHA-256(clientDataJSON)`, hashed with SHA-256 and
 * DER-encoded, as WebAuthn specifies. For the automated run only; it never touches a browser.
 * The private key lives in this closure and is never exported or logged.
 */
export function softwarePasskey(rpId: string, origin: string): PasskeySeam {
  const { privateKey, publicKey: nodePublicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const jwk = nodePublicKey.export({ format: 'jwk' });
  if (typeof jwk.x !== 'string' || typeof jwk.y !== 'string') {
    throw new Error('the generated P-256 key has no affine coordinates');
  }
  const x = fromBase64url(jwk.x);
  const y = fromBase64url(jwk.y);
  const publicKey = { x: bigintFromBytes(x), y: bigintFromBytes(y), identity: false as const };
  const policy = webauthnPolicy(rpId, origin);
  const credentialId = sha256(new Uint8Array([4, ...x, ...y])).slice(0, 16);
  let counter = 0;
  return {
    async create() {
      return { credentialId, publicKey, policy };
    },
    async identify() {
      return { credentialId };
    },
    async sign(_credential, challenge) {
      counter++;
      // rpIdHash (32) | flags UP+UV (0x05) | signCount, big-endian (4): 37 bytes, no extensions.
      const authData = new Uint8Array(37);
      authData.set(policy.rp_id_hash);
      authData[32] = 5;
      new DataView(authData.buffer).setUint32(33, counter);
      const message = new Uint8Array([
        ...authData,
        ...sha256(clientDataJSON(challenge, policy.origin)),
      ]);
      const der = sign('sha256', message, { key: privateKey, dsaEncoding: 'der' });
      return { authenticator_data: authData, sig: parseES256Signature(new Uint8Array(der)) };
    },
  };
}
