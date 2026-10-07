import { PassportConnectorError, toPassportError } from '@midnight-ntwrk/mn-passport-account';
import { passkeySeed } from '@midnight-ntwrk/mn-passport-adapter-browser';

export interface WalletSeedOptions {
  rpId: string;
  /**
   * The open account's credential id. When set, the PRF ceremony is pinned to it
   * (`allowCredentials`): one prompt, no picker, and any other passkey fails with WRONG_PASSKEY.
   * Without it the user first picks a passkey (discoverable prompt), then confirms the PRF.
   */
  accountCredentialId?: Uint8Array | undefined;
  credentials?: CredentialsContainer | undefined;
}

/** The discoverable prompt, used only when no account is open: which passkey the user picks. */
async function pickPasskey(opts: WalletSeedOptions): Promise<Uint8Array> {
  let picked: PublicKeyCredential | null;
  try {
    picked = (await (opts.credentials ?? navigator.credentials).get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: opts.rpId,
        userVerification: 'required',
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw toPassportError(e);
  }
  if (!picked)
    throw new PassportConnectorError('UserCancelled', 'The passkey prompt was cancelled.');
  return new Uint8Array(picked.rawId);
}

/**
 * The built-in wallet's seed: the passkey's 64-byte BIP-39 seed under the Lace recipe v1 (PRF root
 * -> HKDF wallet entropy -> 24 words -> seed). With an open account the ceremony is pinned to the
 * account's passkey (one prompt); with none, the user picks a passkey first (two prompts). There is
 * no fallback: a passkey without PRF fails with `UnsupportedAuthenticator` and never opens a
 * different, empty wallet (spec §5.5). The web app never holds the genesis (sponsor) seed. The
 * caller zeroes the seed after use.
 */
export async function walletSeed(opts: WalletSeedOptions): Promise<Uint8Array> {
  const credentialId = opts.accountCredentialId ?? (await pickPasskey(opts));
  return passkeySeed({ credentialId, rpId: opts.rpId, credentials: opts.credentials });
}
