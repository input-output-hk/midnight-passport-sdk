import { PassportConnectorError } from '@midnight-ntwrk/mn-passport-account';

/** The only network on which the built-in wallet may fall back to the well-known dev seed. */
export const FALLBACK_NETWORK_ID = 'undeployed';

export type WalletSeedSource = 'passkey-prf' | 'fallback-dev-seed';

/**
 * The genesis-funded dev seed (0…01). It is public knowledge: anyone can derive the same wallet,
 * so it is only ever acceptable on a standalone network that holds no value.
 */
export function fallbackDevSeed(): Uint8Array {
  const seed = new Uint8Array(32);
  seed[31] = 1;
  return seed;
}

/**
 * Decides which seed the built-in wallet uses. The passkey's PRF output always wins; without PRF
 * the genesis dev seed is allowed on the `undeployed` network only. On any other network the
 * missing PRF is surfaced as `UnsupportedAuthenticator` rather than silently using a public seed.
 * The seed bytes never appear in an error message.
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
  return { seed: fallbackDevSeed(), source: 'fallback-dev-seed' };
}
