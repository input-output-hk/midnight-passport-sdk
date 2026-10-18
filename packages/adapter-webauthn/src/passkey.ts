import {
  PassportConnectorError,
  toPassportError,
} from '@input-output-hk/mn-passport-account/errors';
import type { PasskeyCredential, PasskeySeam } from '@input-output-hk/mn-passport-account/ports';
import {
  assertionMaterial,
  bigintFromBytes,
  clientDataJSON,
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
  // Chromium deliberately adds this GREASE member to roughly one in five assertions. The
  // pinned ACC can verify only wa-json134, so request a fresh assertion before signing rather
  // than submitting bytes the contract will reject. Never rewrite signed client data.
  const greaseSuffix =
    ',"other_keys_can_be_added_here":"do not compare clientDataJSON against a template. See https://goo.gl/yabPex"}';
  const isChromiumGrease = (actual: Uint8Array, expected: Uint8Array): boolean => {
    const canonical = new TextDecoder().decode(expected);
    return new TextDecoder().decode(actual) === canonical.slice(0, -1) + greaseSuffix;
  };
  const getCanonical = async (
    publicKey: PublicKeyCredentialRequestOptions,
    credentialId?: Uint8Array,
  ): Promise<{ id: Uint8Array; proof: WebAuthnAssertion }> => {
    const challenge = publicKey.challenge;
    const expected = clientDataJSON(
      challenge instanceof ArrayBuffer
        ? new Uint8Array(challenge)
        : new Uint8Array(challenge.buffer, challenge.byteOffset, challenge.byteLength),
      policy.origin,
    );
    for (let attempt = 0; attempt < 5; attempt++) {
      const got = (await container().get({ publicKey })) as PublicKeyCredential | null;
      if (!got)
        throw new PassportConnectorError('UserCancelled', 'The passkey prompt was cancelled.');
      const id = new Uint8Array(got.rawId);
      if (credentialId && !equalBytes(id, credentialId)) throw wrongPasskey();
      const response = got.response as AuthenticatorAssertionResponse;
      const actual = new Uint8Array(response.clientDataJSON);
      if (equalBytes(actual, expected))
        return {
          id,
          proof: {
            authenticatorData: new Uint8Array(response.authenticatorData),
            clientDataJSON: actual,
            signature: new Uint8Array(response.signature),
          },
        };
      if (!isChromiumGrease(actual, expected))
        throw new PassportConnectorError(
          'UnsupportedAuthenticator',
          'The authenticator does not match the wa-json134 profile: unsupported or mismatched clientDataJSON',
        );
      if (attempt === 4)
        throw new PassportConnectorError(
          'UnsupportedAuthenticator',
          'The browser did not return the ACC wa-json134 client data after five attempts.',
        );
    }
    throw new PassportConnectorError('InternalError', 'Unreachable WebAuthn retry state.');
  };
  /**
   * One assertion ceremony pinned to a known credential (`allowCredentials`): a different credential
   * fails with WRONG_PASSKEY, a dismissed prompt with UserCancelled.
   */
  const assertion = async (
    credentialId: Uint8Array,
    challenge: Uint8Array,
  ): Promise<WebAuthnAssertion> => {
    return (
      await getCanonical(
        {
          challenge: new Uint8Array(challenge),
          rpId: opts.rpId,
          userVerification: 'required',
          allowCredentials: [{ type: 'public-key', id: new Uint8Array(credentialId) }],
        },
        credentialId,
      )
    ).proof;
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
        const credential = await getCanonical({
          challenge: new Uint8Array(challenge),
          rpId: opts.rpId,
          userVerification: 'required',
        });
        // Kept for `owns`: the same assertion proves which key the picked passkey holds, so binding
        // a registry record to it costs no second prompt (Ruling R10(b)).
        const proof = credential.proof;
        return {
          credentialId: credential.id,
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
