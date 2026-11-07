import {
  PassportConnectorError,
  toPassportError,
} from '@input-output-hk/mn-passport-account/errors';
import type { PasskeyIdentity, WebAuthnPolicy } from '@input-output-hk/mn-passport-account/ports';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { beforePasskeyCeremony, type PasskeyCeremonyOptions } from './ceremony.js';
import { validLoginExtensions } from './login-cbor.js';
import { lacePrfSalts, PRF_UNAVAILABLE, type PasskeyPrfOutputs } from './prf.js';
import {
  base64url,
  equalBytes,
  parseES256Signature,
  validateP256Key,
  webauthnPolicy,
} from './webauthn.js';

const invalidLogin = (): PassportConnectorError =>
  new PassportConnectorError(
    'UnsupportedAuthenticator',
    'The passkey returned an invalid login assertion.',
  );

/** Copy a bounded browser buffer before retaining it across asynchronous account lookup. */
function assertionBytes(source: unknown, minimum: number, maximum: number): Uint8Array {
  if (
    !(source instanceof ArrayBuffer) ||
    source.byteLength < minimum ||
    source.byteLength > maximum
  )
    throw invalidLogin();
  return new Uint8Array(source.slice(0));
}

function prfOutput(source: unknown): Uint8Array {
  if (source instanceof ArrayBuffer) return assertionBytes(source, 32, 32);
  if (ArrayBuffer.isView(source) && source.byteLength === 32)
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
  throw new PassportConnectorError('UnsupportedAuthenticator', PRF_UNAVAILABLE);
}

function validateClientData(bytes: Uint8Array, challenge: Uint8Array, origin: string): void {
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalidLogin();
  const data = parsed as Record<string, unknown>;
  if (
    data.type !== 'webauthn.get' ||
    data.challenge !== base64url(challenge) ||
    data.origin !== origin ||
    data.crossOrigin !== false
  )
    throw invalidLogin();
}

function validateAuthenticatorData(data: Uint8Array, policy: WebAuthnPolicy): void {
  const flags = data[32] ?? 0;
  // UP + UV, optional BE/BS and ED only; BS requires BE. AT/reserved bits never belong here.
  if (
    !equalBytes(data.subarray(0, 32), policy.rp_id_hash) ||
    (flags & 5) !== 5 ||
    (flags & ~0x9d) !== 0 ||
    ((flags & 0x10) !== 0 && (flags & 8) === 0)
  )
    throw invalidLogin();
  if (flags & 0x80) {
    if (!validLoginExtensions(data.subarray(37))) throw invalidLogin();
  } else if (data.length !== 37) throw invalidLogin();
}

/**
 * One discoverable login assertion evaluates both Lace PRF salts. This local ownership proof
 * accepts signed additional JSON members and bounded CBOR extensions, unlike ACC wa-json134.
 * It is never transaction material: strict enrolment/signing validation remains unchanged.
 * The caller owns and zeroes both output copies; the identity retains public proof bytes only.
 */
export async function identifyPasskeyWithPrf(
  opts: PasskeyCeremonyOptions & {
    rpId: string;
    origin: string;
    credentials?: CredentialsContainer;
  },
): Promise<{ identity: PasskeyIdentity; outputs: PasskeyPrfOutputs }> {
  let authoriser: Uint8Array | undefined;
  let root: Uint8Array | undefined;
  try {
    const policy = webauthnPolicy(opts.rpId, opts.origin);
    const pageOrigin = globalThis.location?.origin;
    if (pageOrigin !== undefined && pageOrigin !== opts.origin) throw invalidLogin();
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    await beforePasskeyCeremony(opts, 'identify-and-unlock');
    const credential = (await (opts.credentials ?? navigator.credentials).get({
      publicKey: {
        challenge: new Uint8Array(challenge),
        rpId: opts.rpId,
        userVerification: 'required',
        extensions: { prf: { eval: lacePrfSalts() } },
      },
    })) as PublicKeyCredential | null;
    if (!credential)
      throw new PassportConnectorError('UserCancelled', 'The passkey prompt was cancelled.');
    const credentialId = assertionBytes(credential.rawId, 1, 1023);
    const response = credential.response as AuthenticatorAssertionResponse;
    if (!response) throw invalidLogin();
    const client = assertionBytes(response.clientDataJSON, 1, 8192);
    const data = assertionBytes(response.authenticatorData, 37, 4133);
    const signature = assertionBytes(response.signature, 8, 72);
    validateClientData(client, challenge, opts.origin);
    validateAuthenticatorData(data, policy);
    parseES256Signature(signature);
    const results = credential.getClientExtensionResults().prf?.results;
    if (!results?.first || !results.second)
      throw new PassportConnectorError('UnsupportedAuthenticator', PRF_UNAVAILABLE);
    authoriser = prfOutput(results.first);
    root = prfOutput(results.second);
    const message = new Uint8Array(data.length + 32);
    message.set(data);
    message.set(sha256(client), data.length);
    const identity: PasskeyIdentity = {
      credentialId,
      owns(key, keyPolicy) {
        try {
          if (
            !equalBytes(keyPolicy.origin, policy.origin) ||
            !equalBytes(keyPolicy.rp_id_hash, policy.rp_id_hash)
          )
            return false;
          validateP256Key(key);
          return p256.verify(signature, message, p256.Point.fromAffine(key).toBytes(false), {
            format: 'der',
            lowS: false,
          });
        } catch {
          return false;
        }
      },
    };
    return { identity, outputs: { authoriser, root } };
  } catch (error) {
    authoriser?.fill(0);
    root?.fill(0);
    throw toPassportError(error);
  }
}
