import { x25519 } from '@noble/curves/ed25519.js';
import type { EncryptionKeySource, PrfKeySource } from '@input-output-hk/mn-passport-account/ports';
import { ACC_ENC_DOMAIN } from './lace-recipe.js';

/** Derive the ACC's public encryption key inside a key-source session. Secret bytes never leave it. */
export function recipeEncryptionKey(source: PrfKeySource): EncryptionKeySource {
  return {
    publicKey: (networkId) =>
      source.withSession(async () => {
        const secret = await source.deriveSecret({
          domain: ACC_ENC_DOMAIN,
          context: `${networkId}/0`,
        });
        try {
          if (secret.length !== 32) throw new Error('the ACC encryption secret must be 32 bytes');
          return x25519.getPublicKey(secret);
        } finally {
          secret.fill(0);
        }
      }),
  };
}
