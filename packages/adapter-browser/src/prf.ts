import { PassportConnectorError, toPassportError } from '@midnight-ntwrk/mn-passport-account';
import {
  accEncryptionKey,
  PRF_LABEL_AUTHORISER,
  PRF_LABEL_ROOT,
  prfSalt,
  seedFromRoot,
} from './lace-recipe.js';
import { equalBytes } from './webauthn.js';

/** The advice shown when a passkey provider cannot evaluate the WebAuthn PRF extension. */
export const PRF_UNSUPPORTED =
  'This passkey does not support the PRF extension, which the Passport account and the built-in ' +
  'wallet need. Create the passkey in Google Password Manager or iCloud Keychain (the "Chrome ' +
  'profile" store and some security keys have no PRF), then try again.';

/** Both PRF outputs of the Lace recipe v1. The caller zeroes them. */
export interface PasskeyPrfOutputs {
  /** Output #1, Lace's ACC authoriser. Unused here: this prototype's authoriser is P-256. */
  readonly authoriser: Uint8Array;
  /** Output #2, the root of the wallet seed and the ACC's encryption key. */
  readonly root: Uint8Array;
}

export interface PasskeyPrfOptions {
  credentialId: Uint8Array;
  rpId: string;
  credentials?: CredentialsContainer;
}

/** A copy of a PRF result, so zeroing it never touches the browser's own buffer. */
const copy = (source: BufferSource): Uint8Array =>
  source instanceof ArrayBuffer
    ? new Uint8Array(source.slice(0))
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();

/**
 * One PRF ceremony on a known credential, evaluating both Lace salts (`first`: the authoriser,
 * `second`: the root). It is a SEPARATE ceremony: PRF output adds authenticator extension data,
 * which the ACC's wa-json134 profile rejects (37-byte authenticator data only), so it can never
 * share a signing assertion. Without PRF it fails with `UnsupportedAuthenticator`; there is no
 * fallback seed, so a passkey without PRF never opens a different, empty wallet.
 */
export async function passkeyPrf(opts: PasskeyPrfOptions): Promise<PasskeyPrfOutputs> {
  let credential: PublicKeyCredential | null;
  try {
    credential = (await (opts.credentials ?? navigator.credentials).get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: opts.rpId,
        userVerification: 'required',
        allowCredentials: [{ type: 'public-key', id: new Uint8Array(opts.credentialId) }],
        extensions: {
          prf: {
            eval: {
              first: new Uint8Array(prfSalt(PRF_LABEL_AUTHORISER)),
              second: new Uint8Array(prfSalt(PRF_LABEL_ROOT)),
            },
          },
        },
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw toPassportError(e);
  }
  if (!credential) {
    throw new PassportConnectorError('UserCancelled', 'The passkey prompt was cancelled.');
  }
  if (!equalBytes(new Uint8Array(credential.rawId), opts.credentialId)) {
    throw new PassportConnectorError(
      'InternalError',
      'The authenticator answered with a different credential than requested.',
    );
  }
  const results = credential.getClientExtensionResults().prf?.results;
  if (!results?.first || !results.second) {
    throw new PassportConnectorError('UnsupportedAuthenticator', PRF_UNSUPPORTED);
  }
  return { authoriser: copy(results.first), root: copy(results.second) };
}

/**
 * The passkey's 64-byte BIP-39 seed (Lace recipe v1), from one PRF ceremony. Both PRF outputs are
 * zeroed here; the caller owns the seed and zeroes it after use.
 */
export async function passkeySeed(opts: PasskeyPrfOptions): Promise<Uint8Array> {
  const { authoriser, root } = await passkeyPrf(opts);
  try {
    return seedFromRoot(root);
  } finally {
    authoriser.fill(0);
    root.fill(0);
  }
}

/**
 * The ACC's `enc_key` for this passkey on `networkId` (MIP-0015 v1, domain
 * `lace-passport:acc-enc:v1`, context `<networkId>/0`), from one PRF ceremony.
 */
export async function accEncryptionKeyFromPasskey(
  opts: PasskeyPrfOptions & { networkId: string },
): Promise<Uint8Array> {
  const seed = await passkeySeed(opts);
  try {
    return accEncryptionKey(seed, opts.networkId);
  } finally {
    seed.fill(0);
  }
}
