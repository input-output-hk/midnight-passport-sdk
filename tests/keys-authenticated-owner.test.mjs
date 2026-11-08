import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import {
  createAuthenticatedJubjubOwner,
  recipeJubjubAuthoriser,
  deriveSymmetricSecret,
  READER_SECRET_DOMAIN,
} from '../packages/keys/dist/index.js';

const context = {
  account: 'ab'.repeat(32),
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  credentialId: Uint8Array.of(1, 2),
};
const material = () => ({
  authoriser: new Uint8Array(32).fill(7),
  walletSeed: new Uint8Array(64).fill(9),
});
test('authenticated owner is the deterministic existing Lace PRF-1 owner, with a distinct companion reader', async () => {
  const m = material();
  const native = createAuthenticatedJubjubOwner({
    context,
    ...m,
    pure: pureCircuits,
    companionReader: false,
    check() {},
  });
  const companion = createAuthenticatedJubjubOwner({
    context,
    ...m,
    pure: pureCircuits,
    companionReader: true,
    check() {},
  });
  const repeated = createAuthenticatedJubjubOwner({
    context,
    ...m,
    pure: pureCircuits,
    companionReader: true,
    check() {},
  });
  const reference = recipeJubjubAuthoriser(
    {
      withSession: (work) => work(),
      deviceSecret: async () => m.authoriser.slice(),
      deriveSecret: async (p) => deriveSymmetricSecret(m.walletSeed, p),
    },
    pureCircuits,
  );
  assert.equal(companion.publicKey, await reference.devicePublicKeyHex());
  assert.equal(companion.publicKey, native.publicKey);
  assert.equal(repeated.publicKey, companion.publicKey);
  assert.equal(repeated.readerPublicKey, companion.readerPublicKey);
  assert.notEqual(companion.readerPublicKey, native.readerPublicKey);
  const journal = {
    domain: 'mn-passport-demo:grant-journal:v1',
    context: `${context.networkId}:${context.account}`,
    length: 32,
  };
  assert.deepEqual(
    await companion.prf.deriveSecret(journal),
    await native.prf.deriveSecret(journal),
  );
  assert.deepEqual(
    await companion.originalReaderPrf.deriveSecret({
      domain: READER_SECRET_DOMAIN,
      context: context.networkId,
    }),
    await native.prf.deriveSecret({ domain: READER_SECRET_DOMAIN, context: context.networkId }),
  );
  const identity = await companion.credentials.identify();
  companion.context.credentialId.fill(99);
  context.credentialId.fill(88);
  assert.deepEqual(identity.credentialId, Uint8Array.of(1, 2));
  assert.deepEqual((await companion.credentials.identify()).credentialId, Uint8Array.of(1, 2));
  context.credentialId.set([1, 2]);
  for (const key of [native, companion, repeated]) key.dispose();
});

test('authenticated owner signs owner administration and value calls; expiry/lock and foreign contexts refuse', async () => {
  let allowed = true;
  const key = createAuthenticatedJubjubOwner({
    context,
    ...material(),
    pure: pureCircuits,
    companionReader: true,
    check() {
      if (!allowed) throw Error('expired');
    },
  });
  for (const circuit of [
    'add_device_with_jubjub',
    'remove_device_with_jubjub',
    'rotate_enc_key_with_jubjub',
    'issue_grant_with_jubjub',
    'revoke_grant_with_jubjub',
    'revoke_all_grants_with_jubjub',
    'withdraw_unshielded_with_jubjub',
    'append_inbox_with_jubjub',
  ]) {
    const signed = await key.authoriser.authorise({
      account: context.account,
      circuit,
      useCounter: 3n,
      args: [],
      witnessValues: [],
      authNonce: 4n,
      challenge: () => Uint8Array.of(1, ...new Uint8Array(31)),
    });
    assert.equal(signed.scheme, 'jubjub-schnorr');
    assert.equal(signed.useCounter, 3n);
    const left = jubjub.Point.fromAffine(
      pureCircuits.compute_public_point_with_jubjub(signed.sigS),
    );
    const right = jubjub.Point.fromAffine(signed.sigR).add(jubjub.Point.fromAffine(signed.pk));
    assert.ok(left.equals(right), circuit);
  }
  await assert.rejects(
    key.authoriser.authorise({
      account: 'cd'.repeat(32),
      circuit: 'rotate_enc_key_with_jubjub',
      args: [],
      witnessValues: [],
      authNonce: 0n,
      useCounter: 0n,
    }),
    /account mismatch/,
  );
  await assert.rejects(
    key.authoriser.deviceCommitments('cd'.repeat(32), 0n, [0n]),
    /account mismatch/,
  );
  await assert.rejects(
    key.prf.deriveSecret({ domain: READER_SECRET_DOMAIN, context: 'other' }),
    /network mismatch/,
  );
  allowed = false;
  await assert.rejects(key.credentials.identify(), /expired/);
  await assert.rejects(
    key.authoriser.withKeySession(async () => assert.fail()),
    /expired/,
  );
  allowed = true;
  key.dispose();
  await assert.rejects(key.prf.deviceSecret(), /locked/);
  await assert.rejects(
    key.originalReaderPrf.deriveSecret({
      domain: READER_SECRET_DOMAIN,
      context: context.networkId,
    }),
    /locked/,
  );
  await assert.rejects(key.authoriser.devicePublicKey(), /locked/);
});

test('private owner reads recheck completion, while mutation receipts survive local expiry', async () => {
  let valid = true;
  const key = createAuthenticatedJubjubOwner({
    context,
    ...material(),
    pure: pureCircuits,
    companionReader: false,
    check() {
      if (!valid) throw Error('expired');
    },
  });
  for (const read of [
    () =>
      key.prf.withSession(async () => {
        valid = false;
        return 'private';
      }),
    () =>
      key.authoriser.withKeySession(
        async () => {
          valid = false;
          return 'private';
        },
        { kind: 'read-holdings' },
      ),
  ]) {
    valid = true;
    await assert.rejects(read(), /expired/);
  }
  valid = true;
  assert.deepEqual(
    await key.authoriser.withKeySession(
      async () => {
        valid = false;
        return { txHash: 'original' };
      },
      { kind: 'rotate-encryption-key', account: context.account },
    ),
    { txHash: 'original' },
  );
  key.dispose();
});

test('authenticated owner copies Node Buffer seed and credential material', async () => {
  const walletSeed = Buffer.alloc(64, 9);
  const credentialId = Buffer.from([1, 2]);
  const owner = createAuthenticatedJubjubOwner({
    context: { ...context, credentialId },
    authoriser: Buffer.alloc(32, 7),
    walletSeed,
    pure: pureCircuits,
    companionReader: false,
    check() {},
  });
  try {
    const params = { domain: READER_SECRET_DOMAIN, context: context.networkId };
    const original = await owner.prf.deriveSecret(params);
    walletSeed.fill(0);
    credentialId.fill(0);
    assert.deepEqual(await owner.prf.deriveSecret(params), original);
    assert.deepEqual([...(await owner.credentials.identify()).credentialId], [1, 2]);
    walletSeed.fill(9);
    owner.dispose();
    assert.deepEqual([...walletSeed], Array(64).fill(9), 'dispose only clears owned bytes');
  } finally {
    owner.dispose();
  }
});
