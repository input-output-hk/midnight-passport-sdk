import { PassportConnectorError } from '@midnight-ntwrk/mn-passport-account';

/** The only network on which the built-in wallet may fall back to an ephemeral seed. */
export const FALLBACK_NETWORK_ID = 'undeployed';

export type WalletSeedSource = 'passkey-prf' | 'ephemeral-random';

/**
 * A fresh random seed for this page only (Ruling R24). The wallet it derives is empty and is lost
 * on reload. It is never the genesis seed 0…01, which is also the service's sponsor seed: the web
 * app ships no funded secret (spec §1.1).
 */
export function ephemeralSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Decides which seed the built-in wallet uses. The passkey's PRF output always wins; without PRF
 * an ephemeral random seed is allowed on the `undeployed` network only. On any other network the
 * missing PRF is surfaced as `UnsupportedAuthenticator` rather than silently using a throwaway
 * wallet. The seed bytes never appear in an error message.
 */
export function resolveWalletSeed(
  prfSeed: Uint8Array | undefined,
  networkId: string,
): { seed: Uint8Array; source: WalletSeedSource } {
  if (prfSeed) return { seed: prfSeed, source: 'passkey-prf' };
  if (networkId !== FALLBACK_NETWORK_ID) {
    throw new PassportConnectorError(
      'UnsupportedAuthenticator',
      `This authenticator does not support the PRF extension, which the built-in wallet needs on ${networkId}.`,
    );
  }
  return { seed: ephemeralSeed(), source: 'ephemeral-random' };
}
