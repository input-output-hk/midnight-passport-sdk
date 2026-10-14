import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACC_ENC_DOMAIN,
  READER_SECRET_DOMAIN,
  deriveSymmetricSecret,
  readerPublicKey,
  recipeReaderKey,
} from '../packages/keys/dist/index.js';

test('reader key follows Lace MIP-0015 domain and network context inside one session', async () => {
  const seed = new Uint8Array(64).fill(7);
  const expected = readerPublicKey(seed, 'undeployed');
  assert.equal(
    Buffer.from(expected).toString('hex'),
    'adf95e0651ea63ab22f90fa54d3ab362551a61ccbf50ae04108dc6f4f4fd282d',
  );
  const secret = deriveSymmetricSecret(seed, {
    domain: READER_SECRET_DOMAIN,
    context: 'undeployed',
  });
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
      assert.deepEqual(params, {
        domain: 'lace-passport:reader:v1',
        context: 'undeployed',
        length: 32,
      });
      return secret;
    },
    async deviceSecret() {
      throw new Error('unused');
    },
  };
  assert.deepEqual(await recipeReaderKey(source).readerPublicKey('undeployed'), expected);
  assert.deepEqual(secret, new Uint8Array(32));
  assert.equal(inSession, false);
  assert.notDeepEqual(expected, readerPublicKey(seed, 'another-network'));
  assert.notEqual(READER_SECRET_DOMAIN, ACC_ENC_DOMAIN);
});

test('reader key clears malformed derived material', async () => {
  const secret = new Uint8Array(31).fill(9);
  /** @type {import('../packages/account/dist/ports/index.js').PrfKeySource} */
  const source = {
    withSession: (operation) => operation(),
    deriveSecret: async () => secret,
    async deviceSecret() {
      throw new Error('unused');
    },
  };
  await assert.rejects(recipeReaderKey(source).readerPublicKey('undeployed'), /32 bytes/);
  assert.deepEqual(secret, new Uint8Array(31));
});
