import { toPassportError } from '@midnight-ntwrk/mn-passport-account';
import { sha256 } from '@noble/hashes/sha2.js';

export const PRF_SALT_PREFIX = 'midnight:passport:wallet:v1:';

/**
 * The built-in wallet's seed, from a SEPARATE ceremony: a PRF extension output
 * adds authenticator extension data, which the ACC's wa-json134 signing profile
 * rejects (37-byte authenticator data only), so it can never share a signing
 * assertion. Network-bound by its salt (spec §5.4). Undefined without PRF.
 */
export async function walletSeedFromPasskey(opts: {
  credentialId: Uint8Array;
  rpId: string;
  networkId: string;
  credentials?: CredentialsContainer;
}): Promise<Uint8Array | undefined> {
  const salt = sha256(new TextEncoder().encode(PRF_SALT_PREFIX + opts.networkId));
  let credential: PublicKeyCredential | null;
  try {
    credential = (await (opts.credentials ?? navigator.credentials).get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: opts.rpId,
        userVerification: 'required',
        allowCredentials: [{ type: 'public-key', id: new Uint8Array(opts.credentialId) }],
        extensions: { prf: { eval: { first: salt } } },
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw toPassportError(e);
  }
  const first = credential?.getClientExtensionResults().prf?.results?.first;
  return first ? new Uint8Array(first as ArrayBuffer).slice(0, 32) : undefined;
}
