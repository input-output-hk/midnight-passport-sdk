import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { recipeJubjubAuthoriser } from '../packages/keys/dist/index.js';
import {
  JUBJUB_ORDER,
  littleEndianScalar,
  signJubjubChallenge,
} from '../packages/keys/dist/jubjub-signing.js';

const secret = 0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefn;
const nonce = 0x0987654321fedcba0987654321fedcba0987654321fedcba0987654321fedcban;
const address = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const entry = new Uint8Array(32).fill(0x5a);
/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');
/** @type {(pk: {x: bigint, y: bigint}) => (sigR: {x: bigint, y: bigint}, grind: bigint) => Uint8Array} */
const challenge = (pk) => (sigR, grind) =>
  pureCircuits.challenge_add_device_with_jubjub({ bytes: address }, sigR, pk, entry, 7n, grind);

test('JubJub signer matches the upstream ACC reference vector', () => {
  const pk = pureCircuits.compute_public_point_with_jubjub(secret);
  assert.equal(pk.x, 0x09b5a8331d01ee2bae5f0a79aeb181cbf0d0c30624e91b168f92a1ee141f1eb5n);
  assert.equal(pk.y, 0x04cace00c5ac40ee25037dac862ee498605d93ff626ac4930edb43ef08d575c5n);
  assert.equal(
    hex(pureCircuits.derive_device_entry_with_jubjub({ bytes: address }, pk, 0n, 0n)),
    '73b71bbbedfc07c5a859cc3c48e64fef1182818d19527ebf314e7194b2d4a1a8',
  );
  const signed = signJubjubChallenge(pureCircuits, secret, challenge(pk), 3n, nonce);
  assert.equal(signed.sigR.x, 0x1641a65e4fdff32ce13dce7772e2ed907ed69aa145206ad7ef5b4bd7bdaae530n);
  assert.equal(signed.sigR.y, 0x5862a1cc2ca4992c32c2466640959126c2b5532d0422d0470678c6f703383f29n);
  assert.equal(signed.grindNonce, 19n);
  assert.equal(signed.sigS, 0x04a5e09ab29449dcc0b18f36d694dd065922d00b2f0af6ff3ec896402eec03c4n);
  assert.equal(
    hex(challenge(pk)(signed.sigR, 0n)),
    '0150ab7e588d40e7c9ba022405b7a6079104a3a47d93e4dd5150d4dd768607e2',
  );
  assert.equal(littleEndianScalar(Uint8Array.of(0x12, 0x34)), 0x3412n);
});

test('the PRF-backed authoriser batches commitments and clears each secret copy', async () => {
  /** @type {Uint8Array[]} */
  const secrets = [];
  let sessions = 0;
  /** @type {import('../packages/account/dist/ports/index.js').PrfKeySource} */
  const source = {
    async withSession(operation) {
      sessions++;
      return operation();
    },
    async deviceSecret() {
      const bytes = new Uint8Array(32);
      let scalar = secret;
      for (let i = 0; i < 32; i++) {
        bytes[i] = Number(scalar & 255n);
        scalar >>= 8n;
      }
      secrets.push(bytes);
      return bytes;
    },
    async deriveSecret() {
      throw new Error('unused');
    },
  };
  const authoriser = recipeJubjubAuthoriser(source, pureCircuits);
  const pk = await authoriser.devicePublicKey();
  const commitments = await authoriser.deviceCommitments(hex(address), 0n, [0n, 1n]);
  assert.equal(commitments[0], '73b71bbbedfc07c5a859cc3c48e64fef1182818d19527ebf314e7194b2d4a1a8');
  assert.equal(commitments.length, 2);
  assert.equal(sessions, 2);
  assert.ok(secrets.every((bytes) => bytes.every((value) => value === 0)));
  await assert.rejects(
    authoriser.authorise({
      account: hex(address),
      circuit: 'add_device_with_jubjub',
      args: [entry],
      witnessValues: [],
      authNonce: 7n,
      useCounter: 3n,
      challenge: new Uint8Array(32),
    }),
    /binding-built challenge/,
  );
  await assert.rejects(
    authoriser.authorise({
      account: hex(address),
      circuit: 'rotate_enc_key_with_p256',
      args: [entry],
      witnessValues: [],
      authNonce: 7n,
      useCounter: 3n,
      challenge: challenge(pk),
    }),
    /does not use the JubJub arm/,
  );
  const signed = await authoriser.authorise({
    account: hex(address),
    circuit: 'add_device_with_jubjub',
    args: [entry],
    witnessValues: [],
    authNonce: 7n,
    useCounter: 3n,
    challenge: challenge(pk),
  });
  assert.equal(signed.scheme, 'jubjub-schnorr');
  assert.deepEqual(signed.pk, pk);
  assert.equal(signed.useCounter, 3n);
  assert.ok(littleEndianScalar(challenge(pk)(signed.sigR, signed.grindNonce)) < JUBJUB_ORDER);
  assert.deepEqual(await authoriser.devicePublicKey(), pk);
  assert.ok(secrets.every((bytes) => bytes.every((value) => value === 0)));
});
