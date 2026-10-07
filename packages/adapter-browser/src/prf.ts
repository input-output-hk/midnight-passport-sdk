import {
  PassportConnectorError,
  toPassportError,
  type PasskeyCredential,
} from '@midnight-ntwrk/mn-passport-account';
import { copyPrfOutput, takeCreatePrf } from './create-prf.js';
import {
  accEncryptionKey,
  PRF_LABEL_AUTHORISER,
  PRF_LABEL_ROOT,
  prfSalt,
  seedFromRoot,
} from './lace-recipe.js';
import { equalBytes } from './webauthn.js';

/** Creation refused: the provider the passkey was saved in cannot evaluate PRF. */
export const PRF_UNSUPPORTED_AT_CREATE =
  'This passkey provider does not support the PRF extension, which the Passport account and the ' +
  'built-in wallet need. When the browser asks where to save the passkey, choose a PRF-capable ' +
  'provider: Google Password Manager or iCloud Keychain (the "Chrome profile" store and some ' +
  'security keys have no PRF). Then create the account again.';

/** A later PRF ceremony got no output: the passkey has no PRF, or it is not the account's. */
export const PRF_UNAVAILABLE =
  'This passkey returned no PRF output. Either it has no PRF support (a passkey saved in the ' +
  '"Chrome profile" store, or some security keys), or it is a different passkey from the one ' +
  "this account was created with. Choose the account's own passkey, saved in Google Password " +
  'Manager or iCloud Keychain.';

/** A pinned ceremony answered with another credential than the account's. */
export const WRONG_PASSKEY =
  'This is not the passkey this account was created with; choose that passkey.';

/**
 * The browser offered, and the user picked, a passkey other than the one the ceremony was pinned
 * to. `AccountNotFound`, as in spec §5.3: this passkey opens no account here, and the remedy is to
 * choose the right one.
 */
export const wrongPasskey = (): PassportConnectorError =>
  new PassportConnectorError('AccountNotFound', WRONG_PASSKEY);

/** Both Lace v1 salts (`first`: the authoriser, `second`: the root), as a PRF `eval` input. */
export const lacePrfSalts = (): AuthenticationExtensionsPRFValues => ({
  first: new Uint8Array(prfSalt(PRF_LABEL_AUTHORISER)),
  second: new Uint8Array(prfSalt(PRF_LABEL_ROOT)),
});

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
  credentials?: CredentialsContainer | undefined;
  /**
   * The credential `browserPasskey().create` just returned, whose id is `credentialId`. When its
   * provider already answered both salts at creation, those outputs are used, once, instead of a
   * new ceremony (create-prf.ts). Pass it only from the create flow's encryption-key seam.
   */
  created?: PasskeyCredential | undefined;
}

/**
 * Both Lace salts on a known credential (`first`: the authoriser, `second`: the root). It is a
 * SEPARATE ceremony: PRF output adds authenticator extension data, which the ACC's wa-json134
 * profile rejects (37-byte authenticator data only), so it can never share a signing assertion.
 * The ceremony is pinned to `credentialId` (`allowCredentials`); another credential fails with
 * {@link WRONG_PASSKEY}. Without PRF it fails with `UnsupportedAuthenticator`; there is no
 * fallback seed, so a passkey without PRF never opens a different, empty wallet.
 *
 * With `created`, the outputs the provider returned at creation are taken instead, if any: no
 * prompt at all.
 */
export async function passkeyPrf(opts: PasskeyPrfOptions): Promise<PasskeyPrfOutputs> {
  if (opts.created) {
    if (!equalBytes(opts.created.credentialId, opts.credentialId)) {
      throw new PassportConnectorError(
        'InternalError',
        'passkeyPrf: `created` is not the credential named by `credentialId`.',
      );
    }
    const atCreate = takeCreatePrf(opts.created);
    if (atCreate) return atCreate;
  }
  let credential: PublicKeyCredential | null;
  try {
    credential = (await (opts.credentials ?? navigator.credentials).get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: opts.rpId,
        userVerification: 'required',
        allowCredentials: [{ type: 'public-key', id: new Uint8Array(opts.credentialId) }],
        extensions: { prf: { eval: lacePrfSalts() } },
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw toPassportError(e);
  }
  if (!credential) {
    throw new PassportConnectorError('UserCancelled', 'The passkey prompt was cancelled.');
  }
  if (!equalBytes(new Uint8Array(credential.rawId), opts.credentialId)) throw wrongPasskey();
  const results = credential.getClientExtensionResults().prf?.results;
  if (!results?.first || !results.second) {
    throw new PassportConnectorError('UnsupportedAuthenticator', PRF_UNAVAILABLE);
  }
  return { authoriser: copyPrfOutput(results.first), root: copyPrfOutput(results.second) };
}

/**
 * The passkey's 64-byte BIP-39 seed (Lace recipe v1), from one PRF ceremony (or the create-time
 * outputs, see `created`). Both PRF outputs are zeroed here; the caller owns the seed and zeroes it
 * after use.
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
 * `lace-passport:acc-enc:v1`, context `<networkId>/0`), from one PRF ceremony, or from the
 * create-time outputs when `created` carries them.
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
