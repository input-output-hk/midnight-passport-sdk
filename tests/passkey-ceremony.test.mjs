import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  webauthnPasskey,
  passkeyPrf,
  browserPasskey,
} from '../packages/adapter-webauthn/dist/index.js';
import { PassportConnectorError } from '../packages/account/dist/index.js';
import { softwareAuthenticator, ORIGIN, RP, ID } from './fixtures/software-authenticator.mjs';

test('every actual creation/probe/identification/PRF/sign access has a purpose first', async () => {
  const auth = softwareAuthenticator();
  /** @type {string[]} */
  const purposes = [];
  const adapter = webauthnPasskey({
    rpId: RP,
    origin: ORIGIN,
    credentials: auth.container,
    beforeCeremony(event) {
      assert.ok(Object.isFrozen(event));
      assert.deepEqual(Object.keys(event).sort(), ['attempt', 'purpose', 'rpId']);
      assert.equal(event.rpId, RP);
      purposes.push(event.purpose);
      if (event.purpose !== 'create') assert.equal(auth.gets.length, purposes.length - 2);
    },
  });
  await adapter.credentials.create({ name: 'reviewed test' });
  await adapter.credentials.identify();
  await adapter.prf.withSession(async () => {
    (await adapter.prf.deviceSecret()).fill(0);
    (await adapter.prf.deviceSecret()).fill(0);
  });
  await adapter.p256.authorise({
    account: 'test',
    circuit: 'append_inbox_with_p256',
    args: [],
    witnessValues: [],
    authNonce: 0n,
    useCounter: 0n,
    credentialId: ID,
    challenge: new Uint8Array(32).fill(7),
  });
  assert.deepEqual(purposes, ['create', 'verify-created', 'identify', 'derive-keys', 'sign']);
});

for (const purpose of ['create', 'verify-created', 'identify', 'derive-keys', 'sign']) {
  test(`declined ${purpose} explanation prevents that browser access`, async () => {
    const auth = softwareAuthenticator();
    let denied = false;
    const seam = browserPasskey({
      rpId: RP,
      origin: ORIGIN,
      credentials: auth.container,
      beforeCeremony(event) {
        if (event.purpose === purpose) {
          denied = true;
          throw new PassportConnectorError('UserCancelled', 'Declined');
        }
      },
    });
    if (purpose === 'derive-keys') {
      await assert.rejects(
        passkeyPrf({
          rpId: RP,
          credentialId: ID,
          credentials: auth.container,
          beforeCeremony: () => {
            denied = true;
            throw new PassportConnectorError('UserCancelled', 'Declined');
          },
        }),
        { code: 'UserCancelled' },
      );
      assert.equal(auth.gets.length, 0);
    } else if (purpose === 'identify') {
      await assert.rejects(seam.identify(), { code: 'UserCancelled' });
      assert.equal(auth.gets.length, 0);
    } else if (purpose === 'sign') {
      const credential = await seam.create('test');
      const before = auth.gets.length;
      await assert.rejects(seam.sign(credential, new Uint8Array(32)), { code: 'UserCancelled' });
      assert.equal(auth.gets.length, before);
    } else {
      await assert.rejects(seam.create('test'), { code: 'UserCancelled' });
      assert.equal(auth.gets.length, 0);
      assert.equal(auth.creates.length, purpose === 'create' ? 0 : 1);
    }
    assert.ok(denied);
  });
}

test('held create PRF outputs do not claim a new derive-keys browser ceremony', async () => {
  const auth = softwareAuthenticator({ atCreate: 'results' });
  /** @type {string[]} */ const purposes = [];
  const adapter = webauthnPasskey({
    rpId: RP,
    origin: ORIGIN,
    credentials: auth.container,
    beforeCeremony: (event) => {
      purposes.push(event.purpose);
    },
  });
  await adapter.credentials.create({ name: 'held' });
  await adapter.prf.withSession(async () => {
    (await adapter.prf.deviceSecret()).fill(0);
  });
  assert.deepEqual(purposes, ['create', 'verify-created']);
});

test('known browser-profile retries explain each attempt and can be refused independently', async () => {
  const auth = softwareAuthenticator();
  auth.grease.remaining = 2;
  /** @type {number[]} */ const attempts = [];
  await browserPasskey({
    rpId: RP,
    origin: ORIGIN,
    credentials: auth.container,
    beforeCeremony: (event) => {
      attempts.push(event.attempt);
    },
  }).identify();
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.equal(auth.gets.length, 3);

  const refused = softwareAuthenticator();
  refused.grease.remaining = 1;
  await assert.rejects(
    browserPasskey({
      rpId: RP,
      origin: ORIGIN,
      credentials: refused.container,
      beforeCeremony: (event) => {
        if (event.attempt === 2) throw new PassportConnectorError('UserCancelled', 'No retry');
      },
    }).identify(),
    { code: 'UserCancelled' },
  );
  assert.equal(refused.gets.length, 1);
});
