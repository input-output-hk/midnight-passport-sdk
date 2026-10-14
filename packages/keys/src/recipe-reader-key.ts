import { x25519 } from '@noble/curves/ed25519.js';
import type { PrfKeySource } from '@input-output-hk/mn-passport-account/ports';
import { READER_SECRET_DOMAIN } from './lace-recipe.js';

/**
 * The public half of Lace's per-network device reader key. The PRF-derived secret is used only
 * inside a key-source session and zeroed even if key derivation fails. This key opens envelopes;
 * it is not the random account viewing secret carried by those envelopes.
 */
export function recipeReaderKey(source: PrfKeySource): {
  readerPublicKey(networkId: string): Promise<Uint8Array>;
} {
  return {
    readerPublicKey: (networkId) =>
      source.withSession(async () => {
        const secret = await source.deriveSecret({
          domain: READER_SECRET_DOMAIN,
          context: networkId,
          length: 32,
        });
        try {
          if (secret.length !== 32) throw new Error('the reader secret must be 32 bytes');
          return x25519.getPublicKey(secret);
        } finally {
          secret.fill(0);
        }
      }),
  };
}
