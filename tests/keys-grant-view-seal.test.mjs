import assert from 'node:assert/strict';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import { openGrantView, recipeDeviceKeyring } from '../packages/keys/dist/index.js';
import { jubjub } from '@noble/curves/misc.js';
import { sealGrantView } from '../packages/keys/dist/grant-view-seal.js';

test('a read grantee opens only the viewing secret sealed to its account and grant', async () => {
  const readSecret = new Uint8Array(32).fill(7);
  const accountSecret = new Uint8Array(32).fill(9);
  const request = {
    grantId: 'ab'.repeat(32),
    account: 'cd'.repeat(32),
    readPublicKey: Buffer.from(x25519.getPublicKey(readSecret)).toString('hex'),
  };
  const seal = await sealGrantView(accountSecret, request);
  const expectedEncKey = x25519.getPublicKey(accountSecret);
  const opening = { ...request, seal, expectedEncKey };
  assert.deepEqual(await openGrantView(readSecret, opening), accountSecret);
  assert.equal(await openGrantView(new Uint8Array(32).fill(8), opening), null);
  assert.equal(await openGrantView(readSecret, { ...opening, grantId: 'ac'.repeat(32) }), null);
  assert.equal(await openGrantView(readSecret, { ...opening, account: 'ce'.repeat(32) }), null);
  assert.equal(
    await openGrantView(readSecret, {
      ...opening,
      expectedEncKey: x25519.getPublicKey(new Uint8Array(32).fill(8)),
    }),
    null,
  );
  const changed = seal.slice();
  changed[70] = (changed[70] ?? 0) ^ 1;
  assert.equal(await openGrantView(readSecret, { ...opening, seal: changed }), null);
  assert.equal(await openGrantView(readSecret, { ...opening, seal: seal.subarray(0, 93) }), null);
  assert.equal(
    await openGrantView(readSecret, { ...opening, seal: Uint8Array.of(2, ...seal.subarray(1)) }),
    null,
  );
  await assert.rejects(openGrantView(new Uint8Array(31), opening), /read secret/);
});

test('another enrolled reader shares ACC access but needs the publisher to export a read-grant seal', async () => {
  const hex = (/** @type {Uint8Array} */ b) => Buffer.from(b).toString('hex');
  const ring = (/** @type {number} */ value) =>
    recipeDeviceKeyring({
      withSession: (work) => work(),
      deriveSecret: async () => new Uint8Array(32).fill(value),
      deviceSecret: async () => new Uint8Array(32).fill(value),
    });
  const owner = ring(1),
    publisher = ring(2);
  const devicePublicKey = hex(jubjub.Point.BASE.toBytes());
  const created = await publisher.createKeys('undeployed', { devicePublicKey });
  const keyring = {
    account: 'cd'.repeat(32),
    encKey: created.encKey,
    envelopes: created.envelopes,
  };
  const delivered = await publisher.sealToDevice('undeployed', keyring, {
    readerPublicKey: hex(await owner.readerPublicKey('undeployed')),
    devicePublicKey: hex(jubjub.Point.BASE.multiply(2n).toBytes()),
    epoch: 0n,
    counter: 0n,
  });
  keyring.envelopes = [...created.envelopes, delivered.envelope];
  const readSecret = new Uint8Array(32).fill(7);
  const request = {
    account: keyring.account,
    grantId: 'ab'.repeat(32),
    readPublicKey: hex(x25519.getPublicKey(readSecret)),
  };
  assert.ok(publisher.sealView);
  const delivery = await publisher.sealView('undeployed', keyring, request);
  // Both can open this live keyring, but only the publisher decrypts its bookkeeping.
  assert.deepEqual(await owner.openInbox('undeployed', keyring, [delivery.entry]), [null]);
  const [opened] = await publisher.openInbox('undeployed', keyring, [delivery.entry]);
  assert.equal(opened?.kind, 'grant');
  assert.ok(opened?.kind === 'grant' && opened.record.part === 'view');
  const seal = Uint8Array.from(Buffer.from(opened.record.seal, 'hex'));
  const secret = await openGrantView(readSecret, {
    ...request,
    seal,
    expectedEncKey: keyring.encKey,
  });
  assert.ok(secret);
  assert.deepEqual(x25519.getPublicKey(secret), keyring.encKey);
  assert.equal(
    await openGrantView(readSecret, {
      ...request,
      seal,
      expectedEncKey: created.encKey.map((v) => v ^ 1),
    }),
    null,
  );
  secret.fill(0);
  readSecret.fill(0);
});
