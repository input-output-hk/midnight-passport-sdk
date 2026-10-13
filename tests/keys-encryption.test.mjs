import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACC_ENC_DOMAIN,
  accEncryptionKey,
  deriveSymmetricSecret,
  recipeEncryptionKey,
} from '../packages/keys/dist/index.js';

test('the encryption key source uses the Lace domain, network context, and a session', async () => {
  const seed = new Uint8Array(64).fill(7);
  const secret = deriveSymmetricSecret(seed, {
    domain: ACC_ENC_DOMAIN,
    context: 'undeployed/0',
  });
  const expected = accEncryptionKey(seed, 'undeployed');
  let inSession = false;
  /** @type {import('../packages/account/dist/ports/index.js').PrfKeySource} */
  const source = {
    async withSession(operation) {
      inSession = true;
      try {
        return await operation();
      } finally {
        inSession = false;
      }
    },
    async deriveSecret(params) {
      assert.equal(inSession, true);
      assert.deepEqual(params, { domain: ACC_ENC_DOMAIN, context: 'undeployed/0' });
      return secret;
    },
    async deviceSecret() {
      throw new Error('unused in this test');
    },
  };
  assert.deepEqual(await recipeEncryptionKey(source).publicKey('undeployed'), expected);
  assert.deepEqual(secret, new Uint8Array(32));
  assert.equal(inSession, false);
});

test('the encryption key source rejects and clears a malformed secret', async () => {
  const secret = new Uint8Array(31).fill(7);
  /** @type {import('../packages/account/dist/ports/index.js').PrfKeySource} */
  const source = {
    withSession: (operation) => operation(),
    deriveSecret: async () => secret,
    async deviceSecret() {
      throw new Error('unused in this test');
    },
  };
  await assert.rejects(recipeEncryptionKey(source).publicKey('undeployed'), /32 bytes/);
  assert.deepEqual(secret, new Uint8Array(31));
});
