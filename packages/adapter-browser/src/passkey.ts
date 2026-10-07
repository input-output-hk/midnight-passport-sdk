import {
  PassportConnectorError,
  toPassportError,
  type PasskeyCredential,
  type PasskeySeam,
} from '@midnight-ntwrk/mn-passport-account';
import {
  assertionMaterial,
  bigintFromBytes,
  equalBytes,
  fromBase64url,
  validateP256Key,
  webauthnPolicy,
  type WebAuthnAssertion,
} from './webauthn.js';
import { holdCreatePrf } from './create-prf.js';
import { lacePrfSalts, PRF_UNSUPPORTED_AT_CREATE, wrongPasskey } from './prf.js';

/** WebAuthn L3 `hints`, which TypeScript's DOM lib does not declare yet. */
type CreationOptionsWithHints = PublicKeyCredentialCreationOptions & {
  hints?: ('client-device' | 'security-key' | 'hybrid')[];
};

/** wa-json134 passkeys; the private key never leaves the authenticator (spec §4.4). */
export function browserPasskey(opts: {
  rpId: string;
  origin: string;
  credentials?: CredentialsContainer;
}): PasskeySeam {
  const policy = webauthnPolicy(opts.rpId, opts.origin);
  const container = () => opts.credentials ?? navigator.credentials;
  /**
   * One assertion ceremony pinned to a known credential (`allowCredentials`): a different credential
   * fails with WRONG_PASSKEY, a dismissed prompt with UserCancelled.
   */
  const assertion = async (
    credentialId: Uint8Array,
    challenge: Uint8Array,
  ): Promise<WebAuthnAssertion> => {
    const got = (await container().get({
      publicKey: {
        challenge: new Uint8Array(challenge),
        rpId: opts.rpId,
        userVerification: 'required',
        allowCredentials: [{ type: 'public-key', id: new Uint8Array(credentialId) }],
      },
    })) as PublicKeyCredential | null;
    if (!got)
      throw new PassportConnectorError('UserCancelled', 'The passkey prompt was cancelled.');
    if (!equalBytes(new Uint8Array(got.rawId), credentialId)) throw wrongPasskey();
    const r = got.response as AuthenticatorAssertionResponse;
    return {
      authenticatorData: new Uint8Array(r.authenticatorData),
      clientDataJSON: new Uint8Array(r.clientDataJSON),
      signature: new Uint8Array(r.signature),
    };
  };
  return {
    async create(userName) {
      try {
        // The signed origin is fixed at enrolment (21 bytes, wa-json134); enrolling from another
        // page would bind a credential the contract can never accept.
        const pageOrigin = globalThis.location?.origin;
        if (pageOrigin !== undefined && pageOrigin !== opts.origin) {
          throw new PassportConnectorError(
            'InternalError',
            `Passkey enrolment origin mismatch: the page is ${pageOrigin}, the policy is ${opts.origin}.`,
          );
        }
        const options: CreationOptionsWithHints = {
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
          // Steer the browser to a passkey provider on this device (Google Password Manager,
          // iCloud Keychain) rather than a security key, which often has no PRF.
          hints: ['client-device'],
          // PRF at creation with both Lace salts, as the Lace key source does: some providers enable
          // PRF only for credentials created with the extension, and some evaluate it right away.
          extensions: { prf: { eval: lacePrfSalts() } },
        };
        const credential = (await container().create({
          publicKey: options,
        })) as PublicKeyCredential | null;
        if (!credential) {
          throw new PassportConnectorError('UserCancelled', 'Passkey creation was cancelled.');
        }
        // A provider that says it cannot do PRF (e.g. the "Chrome profile" store) is refused here,
        // before the probe and any deploy. One that says nothing is not refused yet: the PRF
        // ceremony for the encryption key runs before the deploy and refuses it cleanly if PRF
        // returns no results, so a PRF-capable provider that omits `enabled` still works.
        const prf = credential.getClientExtensionResults?.().prf;
        if (prf?.enabled === false) {
          throw new PassportConnectorError('UnsupportedAuthenticator', PRF_UNSUPPORTED_AT_CREATE);
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
          x: bigintFromBytes(fromBase64url(jwk.x!)),
          y: bigintFromBytes(fromBase64url(jwk.y!)),
          identity: false as const,
        };
        validateP256Key(publicKey);
        const credentialId = new Uint8Array(credential.rawId);
        // Enrolment probe: one throwaway assertion proves this authenticator produces the exact
        // wa-json134 material (flags, 37-byte authData, origin, ES256) before anything is deployed.
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const probe = await assertion(credentialId, challenge);
        try {
          assertionMaterial(challenge, policy, publicKey, probe);
        } catch (e) {
          throw new PassportConnectorError(
            'UnsupportedAuthenticator',
            `The authenticator does not match the wa-json134 profile: ${e instanceof Error ? e.message : String(e)}`,
            { cause: e },
          );
        }
        const created: PasskeyCredential = { credentialId, publicKey, policy };
        // Outputs the provider returned at creation are held (never on `created` itself) for the
        // encryption-key seam, which then needs no PRF prompt of its own (create-prf.ts).
        holdCreatePrf(created, prf?.results);
        return created;
      } catch (e) {
        throw toPassportError(e);
      }
    },
    async identify() {
      try {
        const challenge = crypto.getRandomValues(new Uint8Array(32));
        const credential = (await container().get({
          publicKey: {
            challenge: new Uint8Array(challenge),
            rpId: opts.rpId,
            userVerification: 'required',
          },
        })) as PublicKeyCredential | null;
        if (!credential) {
          throw new PassportConnectorError('UserCancelled', 'No passkey was chosen.');
        }
        const r = credential.response as AuthenticatorAssertionResponse;
        // Kept for `owns`: the same assertion proves which key the picked passkey holds, so binding
        // a registry record to it costs no second prompt (Ruling R10(b)).
        const proof: WebAuthnAssertion = {
          authenticatorData: new Uint8Array(r.authenticatorData),
          clientDataJSON: new Uint8Array(r.clientDataJSON),
          signature: new Uint8Array(r.signature),
        };
        return {
          credentialId: new Uint8Array(credential.rawId),
          owns(publicKey, keyPolicy) {
            try {
              assertionMaterial(challenge, keyPolicy, publicKey, proof);
              return true;
            } catch {
              return false;
            }
          },
        };
      } catch (e) {
        throw toPassportError(e);
      }
    },
    async sign(credential, challenge) {
      try {
        const material = assertionMaterial(
          challenge,
          credential.policy,
          credential.publicKey,
          await assertion(credential.credentialId, challenge),
        );
        return { authenticator_data: material.authenticator_data, sig: material.sig };
      } catch (e) {
        throw toPassportError(e);
      }
    },
  };
}
