import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import { bigintFromBytes, fromBase64url, validateP256Key } from './webauthn.js';

/** Registration metadata remains required for PRF-only credentials; it is not an ACC signing probe. */
export async function registrationKey(response: AuthenticatorAttestationResponse) {
  const spki = response.getPublicKey();
  if (response.getPublicKeyAlgorithm() !== -7 || !spki)
    throw new PassportConnectorError(
      'UnsupportedAuthenticator',
      'The authenticator did not create an ES256 (P-256) key.',
    );
  const key = await crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', key);
  if (!jwk.x || !jwk.y)
    throw new PassportConnectorError(
      'UnsupportedAuthenticator',
      'Missing registration public key.',
    );
  const publicKey = {
    x: bigintFromBytes(fromBase64url(jwk.x)),
    y: bigintFromBytes(fromBase64url(jwk.y)),
    identity: false as const,
  };
  validateP256Key(publicKey);
  return publicKey;
}
