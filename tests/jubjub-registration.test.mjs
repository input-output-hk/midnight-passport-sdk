import assert from 'node:assert/strict';
import { test } from 'node:test';
import { webauthnPasskey, browserPasskey } from '../packages/adapter-webauthn/dist/index.js';
import { seedFromRoot, prfSalt, PRF_LABEL_ROOT } from '../packages/keys/dist/index.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { creationWorld } from './fixtures/creation-world.mjs';
import { softwareAuthenticator, ID, RP, ORIGIN } from './fixtures/software-authenticator.mjs';

for (const arm of /** @type {const} */ (['p256', 'jubjub']))
  for (const atCreate of /** @type {const} */ (['results', 'enabled'])) {
    test(`${arm} creation (${atCreate}) registers its owner and shares one scoped handoff`, async () => {
      const w = creationWorld(arm, atCreate);
      let callbacks = 0;
      /** @type {import('../packages/adapter-webauthn/dist/index.js').PasskeyLoginKeys|undefined} */ let retained;
      w.onCreated(async (account) => {
        callbacks++;
        assert.equal(account.scheme, arm === 'p256' ? 'p256-webauthn' : 'jubjub-schnorr');
        const state = await account.state();
        assert.equal(state.entryCount, 1);
        assert.equal(w.sim.ledger().booted, true);
        assert.equal([...w.sim.ledger().inbox].length, 2);
        retained = w.adapter.readCreationKeys(account.credentialId);
        assert.deepEqual(Object.keys(retained), ['deriveWalletSeed']);
        const first = retained.deriveWalletSeed(),
          second = retained.deriveWalletSeed();
        const expected = seedFromRoot(sha256(prfSalt(PRF_LABEL_ROOT)));
        assert.deepEqual(first, expected);
        first.fill(0);
        assert.deepEqual(second, expected);
        second.fill(0);
        expected.fill(0);
        assert.throws(() => w.adapter.readCreationKeys(Uint8Array.of(99)), {
          code: 'NotAuthorised',
        });
      });
      const api = w.api();
      const account = await api.createAccount({ userName: 'signing-mode', retireAuthority: true });
      assert.equal(callbacks, 1);
      assert.equal(w.auth.creates.length, 1);
      assert.equal(
        w.auth.gets.length,
        arm === 'p256' ? (atCreate === 'results' ? 3 : 4) : atCreate === 'results' ? 0 : 1,
      );
      assert.equal(w.purposes.filter((p) => p === 'verify-created').length, arm === 'p256' ? 1 : 0);
      assert.equal(w.purposes.filter((p) => p === 'sign').length, arm === 'p256' ? 2 : 0);
      assert.throws(() => retained?.deriveWalletSeed(), { code: 'NotAuthorised' });
      assert.throws(() => w.adapter.readCreationKeys(ID), { code: 'NotAuthorised' });
      const before = w.auth.gets.length;
      const reopened = await api.openAccount();
      assert.equal(reopened.address, account.address);
      assert.equal(callbacks, 1);
      assert.equal(w.auth.gets.length, before + 1);
      assert.equal(w.effects.filter((e) => e === 'deploy').length, 1);
    });
  }

test('PRF-only registration refuses direct P-256 operations before any browser assertion', async () => {
  const auth = softwareAuthenticator({ atCreate: 'results' });
  const adapter = webauthnPasskey({
    rpId: RP,
    origin: ORIGIN,
    credentials: auth.container,
    registrationProfile: 'jubjub-prf',
  });
  await adapter.credentials.create({ name: 'prf-only' });
  await assert.rejects(adapter.p256.devicePublicKey(), { code: 'BindingUnsupported' });
  assert.ok(adapter.p256.withKeySession);
  await assert.rejects(
    adapter.p256.withKeySession(async () => assert.fail('must not run')),
    { code: 'BindingUnsupported' },
  );
  const seam = browserPasskey({
    rpId: RP,
    origin: ORIGIN,
    credentials: auth.container,
    registrationProfile: 'jubjub-prf',
  });
  await assert.rejects(seam.identify(), { code: 'BindingUnsupported' });
  assert.equal(auth.gets.length, 0);
});

test('missing PRF and cancelled fallback refuse before deployment or handoff', async () => {
  for (const unavailable of [false, true]) {
    const w = creationWorld('jubjub', 'enabled');
    w.auth.prfControl.unavailable = unavailable;
    w.auth.prfControl.cancelled = !unavailable;
    let handoffs = 0;
    w.onCreated(async () => {
      handoffs++;
    });
    await assert.rejects(w.api().createAccount({ userName: 'refused', retireAuthority: true }));
    assert.equal(w.sim.state, undefined);
    assert.equal(handoffs, 0);
    assert.equal(w.auth.creates.length, 1);
  }
});

test('failed creation handoff preserves the original active account for one-request reopening', async () => {
  const w = creationWorld('jubjub', 'results');
  w.onCreated(async () => {
    throw Error('host adoption failed');
  });
  const api = w.api();
  await assert.rejects(
    api.createAccount({ userName: 'retained', retireAuthority: true }),
    /host adoption failed/,
  );
  assert.equal(w.hint()?.status, 'active');
  assert.equal(w.effects.filter((e) => e === 'deploy').length, 1);
  const reopened = await api.openAccount();
  assert.equal(reopened.address, w.sim.address);
  assert.equal(w.auth.gets.length, 1);
});

test('invalid registration profile is rejected synchronously', () => {
  assert.throws(
    () =>
      Reflect.apply(webauthnPasskey, undefined, [
        { rpId: RP, origin: ORIGIN, registrationProfile: 'other' },
      ]),
    { code: 'InternalError' },
  );
});
