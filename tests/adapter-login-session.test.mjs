// Real ES256 and PRF-derived reader keys, synthetic authenticator/chain only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { webauthnPasskey, webauthnPolicy } from '../packages/adapter-webauthn/dist/index.js';
import { createPassportAccounts } from '../packages/account/dist/index.js';
import { createFakePorts } from '../packages/account/dist/testing/index.js';
import {
  deriveSymmetricSecret,
  prfSalt,
  PRF_LABEL_AUTHORISER,
  PRF_LABEL_ROOT,
  recipeDeviceKeyring,
  recipeJubjubAuthoriser,
  seedFromRoot,
} from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { softwareAuthenticator, ORIGIN, RP, ID } from './fixtures/software-authenticator.mjs';

/** @param {ReturnType<typeof softwareAuthenticator>} auth */
function setup(auth) {
  /** @type {string[]} */
  const purposes = [];
  const adapter = webauthnPasskey({
    rpId: RP,
    origin: ORIGIN,
    credentials: auth.container,
    beforeCeremony: ({ purpose }) => {
      purposes.push(purpose);
    },
  });
  assert.ok(adapter.credentials.withLoginSession);
  const login = adapter.credentials.withLoginSession.bind(adapter.credentials);
  return { ...adapter, login, purposes };
}

/** @param {Uint8Array} pub */
const point = (pub) => p256.Point.fromHex(Buffer.from(pub).toString('hex')).toAffine();
const secretParams = { domain: 'login-regression:v1', context: 'undeployed' };

test('combined login shares one verified request across sequential reader checks with unchanged Lace keys', async () => {
  const auth = softwareAuthenticator();
  const adapter = setup(auth);
  await adapter.login(async () => {
    const identity = await adapter.credentials.identify();
    assert.deepEqual(identity.credentialId, ID);
    assert.deepEqual(Object.keys(identity).sort(), ['credentialId', 'owns']);
    assert.ok(identity.owns(point(auth.pub), webauthnPolicy(RP, ORIGIN)));
    for (let check = 0; check < 2; check++) {
      await adapter.prf.withSession(async () => {
        const owner = await adapter.prf.deviceSecret();
        assert.deepEqual(owner, sha256(prfSalt(PRF_LABEL_AUTHORISER)));
        owner.fill(0);
        const derived = await adapter.prf.deriveSecret(secretParams);
        const seed = seedFromRoot(sha256(prfSalt(PRF_LABEL_ROOT)));
        try {
          assert.deepEqual(derived, deriveSymmetricSecret(seed, secretParams));
        } finally {
          derived.fill(0);
          seed.fill(0);
        }
      });
    }
    assert.equal(auth.gets.length, 1);
    assert.deepEqual(auth.gets[0]?.extensions?.prf?.eval, {
      first: prfSalt(PRF_LABEL_AUTHORISER),
      second: prfSalt(PRF_LABEL_ROOT),
    });
    assert.equal(auth.gets[0]?.allowCredentials, undefined);
  });
  assert.deepEqual(adapter.purposes, ['identify-and-unlock']);
  const after = await adapter.prf.deviceSecret();
  after.fill(0);
  assert.equal(auth.gets.length, 2, 'finished login does not retain PRF access for later actions');
  assert.deepEqual(adapter.purposes, ['identify-and-unlock', 'derive-keys']);
});

test('combined login accepts signed Chromium extra JSON once and refuses another directory key', async () => {
  const auth = softwareAuthenticator();
  const adapter = setup(auth);
  auth.grease.remaining = 1;
  await adapter.login(async () => {
    const identity = await adapter.credentials.identify();
    assert.equal(
      identity.owns(point(softwareAuthenticator().pub), webauthnPolicy(RP, ORIGIN)),
      false,
    );
    assert.equal(identity.owns(point(auth.pub), webauthnPolicy(RP, ORIGIN)), true);
    (await adapter.prf.deviceSecret()).fill(0);
  });
  assert.equal(
    auth.gets.length,
    1,
    'local login validates actual signed JSON without strict-profile retries',
  );
});

for (const failure of ['cancelled', 'unavailable']) {
  test(`combined login ${failure} performs no implicit fallback or repeated prompt`, async () => {
    const auth = softwareAuthenticator();
    auth.prfControl[failure === 'cancelled' ? 'cancelled' : 'unavailable'] = true;
    const adapter = setup(auth);
    let workReached = false;
    await assert.rejects(
      adapter.login(async () => {
        await adapter.credentials.identify();
        workReached = true;
        (await adapter.prf.deviceSecret()).fill(0);
      }),
      { code: failure === 'cancelled' ? 'UserCancelled' : 'UnsupportedAuthenticator' },
    );
    assert.equal(workReached, false);
    assert.equal(auth.gets.length, 1);
    assert.equal(auth.creates.length, 0);
    assert.deepEqual(adapter.purposes, ['identify-and-unlock']);
  });
}

test('declining combined-purpose consent starts no credential call', async () => {
  const auth = softwareAuthenticator();
  const adapter = webauthnPasskey({
    rpId: RP,
    origin: ORIGIN,
    credentials: auth.container,
    beforeCeremony: () => {
      throw Object.assign(new Error('Declined'), { code: 'UserCancelled' });
    },
  });
  assert.ok(adapter.credentials.withLoginSession);
  await assert.rejects(
    adapter.credentials.withLoginSession(async () => adapter.credentials.identify()),
  );
  assert.equal(auth.gets.length, 0);
  assert.equal(auth.creates.length, 0);
});

test('a failed post-identification login releases its PRF scope', async () => {
  const auth = softwareAuthenticator();
  const adapter = setup(auth);
  await assert.rejects(
    adapter.login(async () => {
      const identity = await adapter.credentials.identify();
      assert.ok(identity.owns(point(auth.pub), webauthnPolicy(RP, ORIGIN)));
      (await adapter.prf.deviceSecret()).fill(0);
      throw new Error('Chain unavailable');
    }),
    /Chain unavailable/,
  );
  const later = await adapter.prf.deviceSecret();
  later.fill(0);
  assert.equal(auth.gets.length, 2);
});

test('an active login refuses overlapping login, credential creation and another identification', async () => {
  const auth = softwareAuthenticator();
  const adapter = setup(auth);
  await adapter.login(async () => {
    await adapter.credentials.identify();
    await assert.rejects(adapter.login(async () => undefined));
    await assert.rejects(adapter.credentials.create({ name: 'overlap' }));
    await assert.rejects(adapter.credentials.identify());
    assert.equal(auth.gets.length, 1);
    assert.equal(auth.creates.length, 0);
    (await adapter.prf.deviceSecret()).fill(0);
  });
});

for (const arm of ['p256', 'jubjub']) {
  test(`actual ${arm} account reopening and address recovery each use one credential request`, async () => {
    const auth = softwareAuthenticator();
    const fake = createFakePorts({ binding: { pureCircuits } });
    const first = setup(auth);
    /** @param {ReturnType<typeof setup>} adapter */
    const ports = (adapter) => ({
      ...fake,
      credentials: adapter.credentials,
      authoriser: arm === 'p256' ? adapter.p256 : recipeJubjubAuthoriser(adapter.prf, pureCircuits),
      viewingKey: recipeDeviceKeyring(adapter.prf),
    });
    const created =
      arm === 'p256'
        ? await createPassportAccounts(ports(first)).createAccount({
            userName: 'login-regression',
            retireAuthority: true,
          })
        : await first.login(async () => {
            // Seed an already-active synthetic JubJub ledger; the shared fake mutates P-256 only.
            const identity = await first.credentials.identify();
            const authoriser = recipeJubjubAuthoriser(first.prf, pureCircuits);
            const publicKey = await authoriser.devicePublicKey();
            const address = 'a7'.repeat(32);
            const keyring = recipeDeviceKeyring(first.prf);
            const keys = await keyring.createKeys('undeployed', {
              devicePublicKey: await authoriser.devicePublicKeyHex(),
            });
            const entry = pureCircuits.derive_device_entry_with_jubjub(
              { bytes: Buffer.from(address, 'hex') },
              publicKey,
              0n,
              0n,
            );
            fake.ledger.set(address, {
              boot: new Uint8Array(32),
              encKey: keys.encKey,
              authorityRetired: true,
              booted: true,
              authNonce: 0n,
              deviceEpoch: 0n,
              specVersion: 3,
              inboxEntries: [...keys.envelopes, ...keys.registrations],
              entries: new Set([Buffer.from(entry).toString('hex')]),
            });
            await fake.directory.put('undeployed', {
              address,
              scheme: 'jubjub-schnorr',
              credentialId: identity.credentialId,
              publicKey,
              status: 'active',
            });
            return { address };
          });
    const ledger = fake.ledger.get(created.address);
    assert.ok(ledger);
    ledger.specVersion = 3;
    const fresh = setup(auth);
    const api = createPassportAccounts(ports(fresh));
    const before = auth.gets.length;
    const reopened = await api.openAccount();
    assert.equal(reopened.address, created.address);
    assert.equal(auth.gets.length, before + 1);
    assert.equal(ledger.entries.size, 1, 'login does not add companion ownership');
    assert.ok(api.openAccountAt);
    const recovered = await api.openAccountAt(created.address);
    assert.equal(recovered.address, created.address);
    assert.equal(auth.gets.length, before + 2);
    assert.deepEqual(fresh.purposes, ['identify-and-unlock', 'identify-and-unlock']);
  });
}
