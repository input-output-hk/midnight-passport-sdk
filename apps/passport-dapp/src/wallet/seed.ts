import { passkeySeed, type PasskeyPrfOptions } from '@midnight-ntwrk/mn-passport-adapter-browser';

/**
 * The built-in wallet's seed: the passkey's 64-byte BIP-39 seed under the Lace recipe v1 (PRF root
 * -> HKDF wallet entropy -> 24 words -> seed). There is no fallback: a passkey without PRF fails
 * with `UnsupportedAuthenticator` and never opens a different, empty wallet (spec §5.5). The web
 * app never holds the genesis (sponsor) seed. The caller zeroes the seed after use.
 */
export const walletSeed = (opts: PasskeyPrfOptions): Promise<Uint8Array> => passkeySeed(opts);
