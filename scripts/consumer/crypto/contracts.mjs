import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { syntheticKeySource } from './generated-account.mjs';

/** @typedef {Awaited<ReturnType<import('./modules.mjs').loadCryptoModules>>} Modules */
export const cryptoCaseNames = Object.freeze([
  'generated-jubjub-valid-and-tampered',
  'generated-p256-valid-and-tampered',
  'Lace-known-answer-and-separation',
  'keyring-coin-roundtrip-and-tamper',
  'Compact-SHA512-Keccak-known-answers',
  'utils-SHA256-manifest-tamper',
]);
export const cryptoClaims = Object.freeze({
  publicInstalledSdk: true,
  generatedContractSimulation: true,
  nativeProof: false,
  realProvider: false,
  network: false,
  valueSubmission: false,
  releasedPackage: false,
});
/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');

/** Lace's public upstream vectors; same constants as adapter-browser-lace-recipe.test.mjs.
 * @param {Modules} modules */
export function laceKnownAnswers({ keys }) {
  const root = new Uint8Array(32).fill(2),
    seed = keys.seedFromRoot(root);
  try {
    assert.equal(
      keys.mnemonicFromRoot(root),
      'fame coconut utility print giraffe common twin evil alone exclude great echo since cart erode noise icon repair amused drip awake coral hat unveil',
    );
    assert.equal(
      hex(seed),
      'f1e3c3e382a33597bb8e607d3f86bc5ebba3c09419cee76805b0e2b4794809b1aa3e64b74ff514ea6b006a0722377aa37c4f6febfc684fa2d1b3bf419539f9d1',
    );
    assert.equal(
      hex(
        keys.deriveSymmetricSecret(new Uint8Array(64).fill(1), {
          domain: 'lace-passport:acc-enc:v1',
          context: '0',
        }),
      ),
      '483dd05e57a573af91e4c76cb60ea23a74b68bdb9540da22154825a0cfde094d',
    );
    assert.notDeepEqual(
      keys.readerPublicKey(seed, 'undeployed'),
      keys.readerPublicKey(seed, 'preview'),
    );
    assert.deepEqual(root, new Uint8Array(32).fill(2));
  } finally {
    seed.fill(0);
    root.fill(0);
  }
}

/** @param {Modules} modules */
export async function custodyRoundTrip({ keys, binding }) {
  const authoriser = keys.recipeJubjubAuthoriser(syntheticKeySource, binding.pureCircuits);
  const keyringPort = keys.recipeDeviceKeyring(syntheticKeySource);
  const devicePublicKey = await authoriser.devicePublicKeyHex();
  const created = await keyringPort.createKeys('undeployed', { devicePublicKey });
  const keyring = {
    account: 'ab'.repeat(32),
    encKey: created.encKey,
    envelopes: created.envelopes,
  };
  const coin = { nonce: new Uint8Array(32).fill(1), color: new Uint8Array(32).fill(2), value: 5n };
  const entry = await keys.sealInboxCoin(created.encKey, coin),
    tampered = entry.slice();
  tampered[100] = (tampered[100] ?? 0) ^ 1;
  assert.deepEqual(await keyringPort.openCoins('undeployed', keyring, [entry, tampered]), [
    coin,
    null,
  ]);
}

/** @param {Modules} modules */
export function compactHashAnswers({ runtime }) {
  const bytes = new TextEncoder().encode('abc'),
    type = new runtime.CompactTypeBytes(3);
  assert.deepEqual(runtime.toBinaryRepr(type, bytes), bytes);
  assert.equal(hex(runtime.sha512(type, bytes)), createHash('sha512').update(bytes).digest('hex'));
  assert.equal(
    hex(runtime.keccak256(type, bytes)),
    '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45',
  );
}

/** @param {Modules} modules */
export function utilsHashAnswers({ utils }) {
  for (const bytes of [
    new Uint8Array(),
    new TextEncoder().encode('abc'),
    new Uint8Array(257).fill(7),
  ]) {
    const expected = createHash('sha256').update(bytes).digest('hex');
    assert.equal(utils.computeSha256Hex(bytes), expected);
    utils.assertManifestHash(bytes, expected);
    assert.throws(
      () => utils.assertManifestHash(new Uint8Array([...bytes, 1]), expected),
      /integrity verification/,
    );
  }
}

/** @param {unknown} value @returns {value is Record<string,unknown>} */
const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @param {unknown} value */
export function validateCryptoResult(value) {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== 'installed-software-crypto' ||
    value.outcome !== 'passed' ||
    value.failure !== null ||
    !Array.isArray(value.cases) ||
    value.cases.length !== cryptoCaseNames.length ||
    !Array.isArray(value.resolutions) ||
    !value.resolutions.length ||
    !record(value.claims) ||
    JSON.stringify(value.claims) !== JSON.stringify(cryptoClaims)
  )
    throw Error('Incomplete or overclaimed installed crypto result');
  const remaining = new Set(cryptoCaseNames);
  for (const item of value.cases) {
    if (
      !record(item) ||
      typeof item.name !== 'string' ||
      item.outcome !== 'passed' ||
      !remaining.delete(item.name)
    )
      throw Error('Missing, duplicate or failed installed crypto case');
  }
  if (remaining.size) throw Error('Missing installed crypto case');
  return value;
}
