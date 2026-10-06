import {
  PassportConnectorError,
  toPassportError,
  type PasskeySeam,
} from '@midnight-ntwrk/mn-passport-account';
import { assertionMaterial, validateP256Key, webauthnPolicy } from './webauthn.js';

const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const integer = (b: Uint8Array) => b.reduce((n, v) => (n << 8n) | BigInt(v), 0n);

/** wa-json134 passkeys; the private key never leaves the authenticator (spec §4.4). */
export function browserPasskey(opts: {
  rpId: string;
  origin: string;
  credentials?: CredentialsContainer;
}): PasskeySeam {
  const policy = webauthnPolicy(opts.rpId, opts.origin);
  const container = () => opts.credentials ?? navigator.credentials;
  return {
    async create(userName) {
      try {
        const credential = (await container().create({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rp: { id: opts.rpId, name: 'Midnight Passport' },
            user: {
              id: crypto.getRandomValues(new Uint8Array(32)),
              name: userName,
              displayName: userName,
            },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            // Discoverable, so openAccount can find it without a stored id (spec §5.1).
            authenticatorSelection: { userVerification: 'required', residentKey: 'required' },
            attestation: 'none',
          },
        })) as PublicKeyCredential | null;
        if (!credential) {
          throw new PassportConnectorError('UserCancelled', 'Passkey creation was cancelled.');
        }
        const response = credential.response as AuthenticatorAttestationResponse;
        const spki = response.getPublicKey();
        if (response.getPublicKeyAlgorithm() !== -7 || !spki) {
          throw new PassportConnectorError(
            'UnsupportedAuthenticator',
            'The authenticator did not create an ES256 (P-256) key.',
          );
        }
        const key = await crypto.subtle.importKey(
          'spki',
          spki,
          { name: 'ECDSA', namedCurve: 'P-256' },
          true,
          ['verify'],
        );
        const jwk = await crypto.subtle.exportKey('jwk', key);
        const publicKey = {
          x: integer(fromB64url(jwk.x!)),
          y: integer(fromB64url(jwk.y!)),
          identity: false as const,
        };
        validateP256Key(publicKey);
        return { credentialId: new Uint8Array(credential.rawId), publicKey, policy };
      } catch (e) {
        throw toPassportError(e);
      }
    },
    async identify() {
      try {
        const credential = (await container().get({
          publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rpId: opts.rpId,
            userVerification: 'required',
          },
        })) as PublicKeyCredential | null;
        if (!credential) {
          throw new PassportConnectorError('UserCancelled', 'No passkey was chosen.');
        }
        return { credentialId: new Uint8Array(credential.rawId) };
      } catch (e) {
        throw toPassportError(e);
      }
    },
    async sign(credential, challenge) {
      try {
        const got = (await container().get({
          publicKey: {
            challenge: new Uint8Array(challenge),
            rpId: opts.rpId,
            userVerification: 'required',
            allowCredentials: [{ type: 'public-key', id: new Uint8Array(credential.credentialId) }],
          },
        })) as PublicKeyCredential | null;
        if (!got) {
          throw new PassportConnectorError('UserCancelled', 'The passkey prompt was cancelled.');
        }
        const r = got.response as AuthenticatorAssertionResponse;
        const material = assertionMaterial(challenge, credential.policy, credential.publicKey, {
          authenticatorData: new Uint8Array(r.authenticatorData),
          clientDataJSON: new Uint8Array(r.clientDataJSON),
          signature: new Uint8Array(r.signature),
        });
        return { authenticator_data: material.authenticator_data, sig: material.sig };
      } catch (e) {
        throw toPassportError(e);
      }
    },
  };
}
