import { discoverPasskeySeed, passkeySeed } from '@input-output-hk/mn-passport-adapter-webauthn';
import type { PasskeyCeremonyOptions } from '@input-output-hk/mn-passport-adapter-webauthn';

export interface WalletSeedOptions extends PasskeyCeremonyOptions {
  rpId: string;
  /**
   * The open account's credential id. When set, the PRF ceremony is pinned to it
   * (`allowCredentials`): one prompt, no picker, and any other passkey fails with WRONG_PASSKEY.
   * Without it one discoverable PRF request selects the passkey and derives its wallet seed.
   */
  accountCredentialId?: Uint8Array | undefined;
  credentials?: CredentialsContainer | undefined;
}

/**
 * The built-in wallet's seed: the passkey's 64-byte BIP-39 seed under the Lace recipe v1 (PRF root
 * -> HKDF wallet entropy -> 24 words -> seed). With an open account the ceremony is pinned to the
 * account's passkey (one prompt); with none, one discoverable PRF request selects it. There is
 * no fallback: a passkey without PRF fails with `UnsupportedAuthenticator` and never opens a
 * different, empty wallet (spec §5.5). The web app never holds the genesis (sponsor) seed. The
 * caller zeroes the seed after use.
 */
export async function walletSeed(opts: WalletSeedOptions): Promise<Uint8Array> {
  if (!opts.accountCredentialId) return discoverPasskeySeed(opts);
  return passkeySeed({
    credentialId: opts.accountCredentialId,
    rpId: opts.rpId,
    credentials: opts.credentials,
    beforeCeremony: opts.beforeCeremony,
  });
}
