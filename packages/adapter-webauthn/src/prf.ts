import {
  PassportConnectorError,
  toPassportError,
} from '@input-output-hk/mn-passport-account/errors';
import type { PasskeyCredential } from '@input-output-hk/mn-passport-account/ports';
import { takeCreatePrf } from './create-prf.js';
import {
  accEncryptionKey,
  PRF_LABEL_AUTHORISER,
  PRF_LABEL_ROOT,
  prfSalt,
  seedFromRoot,
} from '@input-output-hk/mn-passport-keys';
import { equalBytes } from './webauthn.js';
import { beforePasskeyCeremony, type PasskeyCeremonyOptions } from './ceremony.js';

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
  /** Output #1, Lace's JubJub ACC authoriser. P-256 uses its passkey key instead. */
  readonly authoriser: Uint8Array;
  /** Output #2, the root of the wallet seed and this device's reader key. */
  readonly root: Uint8Array;
}

export interface PasskeyPrfOptions extends PasskeyCeremonyOptions {
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

/** PRF discovery is for local key derivation, not an ACC P-256 ownership/signature proof. */
export interface DiscoverPasskeySeedOptions extends PasskeyCeremonyOptions {
  rpId: string;
  credentials?: CredentialsContainer | undefined;
}

const noPrf = () => new PassportConnectorError('UnsupportedAuthenticator', PRF_UNAVAILABLE);

function checkedOutput(source: unknown): Uint8Array {
  if (source instanceof ArrayBuffer && source.byteLength === 32)
    return new Uint8Array(source.slice(0));
  if (ArrayBuffer.isView(source) && source.byteLength === 32)
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();
  throw noPrf();
}

function checkedOutputs(
  results: { first?: unknown; second?: unknown } | undefined,
): PasskeyPrfOutputs {
  let authoriser: Uint8Array | undefined;
  try {
    authoriser = checkedOutput(results?.first);
    return { authoriser, root: checkedOutput(results?.second) };
  } catch (error) {
    authoriser?.fill(0);
    throw error;
  }
}

function checkedCredentialId(source: unknown): Uint8Array {
  const bytes = source instanceof ArrayBuffer ? new Uint8Array(source) : source;
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 1023)
    throw new PassportConnectorError('UnsupportedAuthenticator', 'Invalid passkey credential ID.');
  return Uint8Array.from(bytes);
}

async function requestPrf(
  opts: DiscoverPasskeySeedOptions,
  credentialId?: Uint8Array,
): Promise<PasskeyPrfOutputs> {
  try {
    await beforePasskeyCeremony(opts, credentialId ? 'derive-keys' : 'identify-and-unlock');
    const credential = (await (opts.credentials ?? navigator.credentials).get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: opts.rpId,
        userVerification: 'required',
        ...(credentialId && {
          allowCredentials: [{ type: 'public-key', id: new Uint8Array(credentialId) }],
        }),
        extensions: { prf: { eval: lacePrfSalts() } },
      },
    })) as PublicKeyCredential | null;
    if (!credential)
      throw new PassportConnectorError('UserCancelled', 'The passkey prompt was cancelled.');
    const selected = checkedCredentialId(credential.rawId);
    if (credentialId && !equalBytes(selected, credentialId)) throw wrongPasskey();
    return checkedOutputs(credential.getClientExtensionResults().prf?.results);
  } catch (error) {
    throw toPassportError(error);
  }
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
  const credentialId = checkedCredentialId(opts.credentialId);
  if (opts.created) {
    if (!equalBytes(opts.created.credentialId, credentialId)) {
      throw new PassportConnectorError(
        'InternalError',
        'passkeyPrf: `created` is not the credential named by `credentialId`.',
      );
    }
    const atCreate = takeCreatePrf(opts.created);
    if (atCreate) {
      // The creation holder already owns these copies; transfer them once without duplicating
      // their custody, and refuse malformed outputs rather than requesting another credential.
      if (atCreate.authoriser.length === 32 && atCreate.root.length === 32) return atCreate;
      atCreate.authoriser.fill(0);
      atCreate.root.fill(0);
      throw noPrf();
    }
  }
  return requestPrf(opts, credentialId);
}

/** One discoverable UV-required PRF request, independent of ACC wa-json134 origin/profile.
 * Both Lace outputs are validated and erased; caller owns and zeroes the resulting wallet seed.
 * There is no separate identification request, retry, fallback seed or account ownership claim.
 */
export async function discoverPasskeySeed(opts: DiscoverPasskeySeedOptions): Promise<Uint8Array> {
  const outputs = await requestPrf(opts);
  try {
    return seedFromRoot(outputs.root);
  } finally {
    outputs.authoriser.fill(0);
    outputs.root.fill(0);
  }
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
 * @deprecated Earlier deterministic-key prototype ACC derivation. Current sealed ACCs use a
 * random viewing secret and passkey-derived reader envelopes in `recipeDeviceKeyring`.
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
