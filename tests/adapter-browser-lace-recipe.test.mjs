// The Lace passkey recipe v1 and MIP-0015 v1, against fixed vectors. The root 0x02 × 32, the
// words, the BIP-39 seed and every deriveSymmetricSecret vector below are lace-platform main's
// own (packages/lib/passkey/test/recipe-v1.test.ts, packages/lib/crypto/test/
// derive-mnemonic.test.ts and derive-symmetric-secret.test.ts); the ACC secret and enc_key at
// `<network>/0` were computed by this implementation from that seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { x25519 } from '@noble/curves/ed25519.js';

const b = await import(new URL('../packages/adapter-browser/dist/index.js', import.meta.url).href);
/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const ROOT = new Uint8Array(32).fill(2);
const WORDS =
  'fame coconut utility print giraffe common twin evil alone exclude great echo since cart erode noise icon repair amused drip awake coral hat unveil';
const SEED =
  'f1e3c3e382a33597bb8e607d3f86bc5ebba3c09419cee76805b0e2b4794809b1aa3e64b74ff514ea6b006a0722377aa37c4f6febfc684fa2d1b3bf419539f9d1';

test('the root derives Lace v1 words and BIP-39 seed', () => {
  const words = b.mnemonicFromRoot(ROOT);
  assert.equal(words, WORDS);
  assert.equal(words.split(' ').length, 24);
  const seed = b.seedFromRoot(ROOT);
  assert.equal(seed.length, 64);
  assert.equal(hex(seed.subarray(0, 8)), 'f1e3c3e382a33597');
  assert.equal(hex(seed), SEED);
  assert.deepEqual(ROOT, new Uint8Array(32).fill(2), 'the root is left untouched');
  assert.throws(() => b.mnemonicFromRoot(new Uint8Array(31)), /32 bytes/);
});

test('the ACC encryption secret and enc_key are MIP-0015 at <network>/0', () => {
  const seed = b.seedFromRoot(ROOT);
  const secret = b.accEncryptionSecret(seed, 'undeployed');
  assert.equal(hex(secret), '20ac89673d439ded9fa0f5786125694ef69c474d29ae4544b56828af14d430e3');
  assert.deepEqual(
    secret,
    b.deriveSymmetricSecret(seed, { domain: 'lace-passport:acc-enc:v1', context: 'undeployed/0' }),
  );
  const encKey = b.accEncryptionKey(seed, 'undeployed');
  assert.equal(hex(encKey), '17ca01cde52fe15a6dc61aa4a0a46211694e3f256400e303a684c1cf164c6265');
  assert.deepEqual(encKey, x25519.getPublicKey(secret));
  assert.equal(
    hex(b.accEncryptionKey(seed, 'preview')),
    'be12f5cf2b445c9b1abad45785463c989a6051a05f2164cb4a3e4ef5b3672c22',
  );
});

test("deriveSymmetricSecret reproduces Lace's golden vectors", () => {
  const seedOf = (/** @type {number} */ byte) => new Uint8Array(64).fill(byte);
  const acc = { domain: 'lace-passport:acc-enc:v1', context: '0' };
  const derive = (/** @type {object} */ params, byte = 1) =>
    hex(b.deriveSymmetricSecret(seedOf(byte), { ...acc, ...params }));
  assert.equal(derive({}), '483dd05e57a573af91e4c76cb60ea23a74b68bdb9540da22154825a0cfde094d');
  assert.equal(
    derive({ length: 64 }),
    '483dd05e57a573af91e4c76cb60ea23a74b68bdb9540da22154825a0cfde094d334e335644a9ad794cad7f57ebc843991995e8f09f41f9b747c848c60eda69b0',
  );
  assert.equal(derive({ length: 16 }), '483dd05e57a573af91e4c76cb60ea23a');
  assert.equal(
    derive({ domain: 'lace-passport:other:v1' }),
    'cc9bbaee5c8e0d42844a4ae1bf8150f5aa142e1f8d9925fcc41f2d61d00dc10f',
  );
  assert.equal(
    derive({ context: '1' }),
    '01b0c7f1b3e9b4dbd96ef57cae05e710847a63ac851d07afc8f5841a66642f0c',
  );
  assert.equal(derive({}, 2), '803ef34e29cf88c1fdbb22d322528d800b9f4711cb14d9390dfd6f7abb8e1bc4');
  const cafe = '5408572080de9c059b7ce63a8f663747fab186c71c2585e6d97eb2d48a5aa64b';
  assert.equal(derive({ domain: 'café' }), cafe);
  assert.equal(derive({ domain: 'café' }), cafe, 'the domain is NFC-normalised');
  assert.equal(b.deriveSymmetricSecret(seedOf(1), { ...acc, context: '' }).length, 32);
  assert.equal(
    b.deriveSymmetricSecret(seedOf(1), { domain: 'd'.repeat(256), context: '0' }).length,
    32,
  );
});

test('deriveSymmetricSecret enforces the MIP-0015 bounds and leaves the seed untouched', () => {
  const seed = new Uint8Array(64).fill(1);
  const derive = (/** @type {object} */ params) =>
    b.deriveSymmetricSecret(seed, { domain: 'lace-passport:acc-enc:v1', context: '0', ...params });
  assert.throws(() => derive({ domain: '' }), /domain must encode to 1\.\.256 bytes, got 0/);
  assert.throws(
    () => derive({ domain: 'é'.repeat(129) }),
    /domain must encode to 1\.\.256 bytes, got 258/,
  );
  assert.throws(
    () => derive({ context: 'c'.repeat(1025) }),
    /context must encode to at most 1024 bytes, got 1025/,
  );
  for (const length of [15, 65, 32.5]) {
    assert.throws(() => derive({ length }), /length must be an integer in 16\.\.64/);
  }
  assert.deepEqual(seed, new Uint8Array(64).fill(1));
});
