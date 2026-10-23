import assert from 'node:assert/strict';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import { jubjub } from '@noble/curves/misc.js';
import { p256 } from '@noble/curves/nist.js';
import { recipeDeviceKeyring } from '../packages/keys/dist/index.js';
import {
  openDeviceEnvelope,
  openDeviceRegistration,
  sealDeviceEnvelope,
} from '../packages/keys/dist/device-envelope.js';

/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const selfDeviceKey = hex(jubjub.Point.BASE.toBytes());

test('random ACC keys are sealed to the current reader and can be delivered to another device', async () => {
  /** @type {Uint8Array[]} */
  const copies = [];
  let sessions = 0;
  /** @type {import('../packages/account/dist/ports/index.js').PrfKeySource} */
  const source = {
    async withSession(operation) {
      sessions++;
      return operation();
    },
    async deriveSecret(params) {
      assert.deepEqual(params, {
        domain: 'lace-passport:reader:v1',
        context: 'undeployed',
        length: 32,
      });
      const copy = new Uint8Array(32).fill(7);
      copies.push(copy);
      return copy;
    },
    async deviceSecret() {
      throw new Error('unused');
    },
  };
  const keyring = recipeDeviceKeyring(source);
  const readerPublicKey = await keyring.readerPublicKey('undeployed');
  const created = await keyring.createKeys('undeployed', { devicePublicKey: selfDeviceKey });
  assert.equal(created.envelopes.length, 1);
  assert.equal(created.registrations.length, 1);
  assert.equal(created.encKey.length, 32);
  const ownEnvelope = created.envelopes[0];
  const ownRegistration = created.registrations[0];
  assert.ok(ownEnvelope && ownRegistration);
  const ownSecret = new Uint8Array(32).fill(7);
  const opened = await openDeviceEnvelope(ownSecret, ownEnvelope);
  assert.ok(opened);
  assert.deepEqual(x25519.getPublicKey(opened.secret), created.encKey);
  assert.deepEqual(await openDeviceRegistration(opened.rosterKey, ownRegistration), {
    readerPublicKey: hex(readerPublicKey),
    devicePublicKey: selfDeviceKey,
  });

  const joinedReader = x25519.keygen();
  const joining = {
    readerPublicKey: hex(joinedReader.publicKey),
    devicePublicKey: hex(jubjub.Point.BASE.multiply(2n).toBytes()),
    epoch: 0n,
    counter: 0n,
  };
  const account = {
    account: 'ab'.repeat(32),
    encKey: created.encKey,
    envelopes: created.envelopes,
  };
  const delivered = await keyring.sealToDevice('undeployed', account, joining);
  const joinedSecrets = await openDeviceEnvelope(joinedReader.secretKey, delivered.envelope);
  assert.ok(joinedSecrets);
  assert.deepEqual(joinedSecrets.secret, opened.secret);
  assert.deepEqual(joinedSecrets.rosterKey, opened.rosterKey);
  assert.deepEqual(await openDeviceRegistration(opened.rosterKey, delivered.registration), {
    readerPublicKey: joining.readerPublicKey,
    devicePublicKey: joining.devicePublicKey,
  });

  const rotated = await keyring.createKeys('undeployed', {
    devicePublicKey: selfDeviceKey,
    keyring: account,
    registrations: [ownRegistration, delivered.registration],
    readers: [joining],
    rotateRoster: true,
  });
  assert.notDeepEqual(rotated.encKey, created.encKey);
  assert.equal(rotated.envelopes.length, 2);
  assert.equal(rotated.registrations.length, 2);
  const rotatedOwnEnvelope = rotated.envelopes[0];
  const rotatedJoinedEnvelope = rotated.envelopes[1];
  assert.ok(rotatedOwnEnvelope && rotatedJoinedEnvelope);
  const rotatedOwn = await openDeviceEnvelope(ownSecret, rotatedOwnEnvelope);
  const rotatedJoined = await openDeviceEnvelope(joinedReader.secretKey, rotatedJoinedEnvelope);
  assert.ok(rotatedOwn && rotatedJoined);
  assert.deepEqual(rotatedOwn.secret, rotatedJoined.secret);
  assert.notDeepEqual(rotatedOwn.rosterKey, opened.rosterKey);
  assert.equal(sessions, 4);
  assert.ok(copies.every((copy) => copy.every((byte) => byte === 0)));

  for (const secrets of [opened, joinedSecrets, rotatedOwn, rotatedJoined]) {
    secrets.secret.fill(0);
    secrets.rosterKey.fill(0);
  }
  ownSecret.fill(0);
  joinedReader.secretKey.fill(0);
});

test('keyring refuses a ledger key mismatch and an unregistered rotation reader', async () => {
  /** @type {import('../packages/account/dist/ports/index.js').PrfKeySource} */
  const source = {
    withSession: (operation) => operation(),
    deriveSecret: async () => new Uint8Array(32).fill(5),
    async deviceSecret() {
      throw new Error('unused');
    },
  };
  const keyring = recipeDeviceKeyring(source);
  const created = await keyring.createKeys('undeployed', { devicePublicKey: selfDeviceKey });
  const account = {
    account: 'ab'.repeat(32),
    encKey: created.encKey,
    envelopes: created.envelopes,
  };
  const fake = x25519.keygen();
  const other = {
    readerPublicKey: hex(fake.publicKey),
    devicePublicKey: hex(jubjub.Point.BASE.multiply(3n).toBytes()),
    epoch: 0n,
    counter: 0n,
  };
  await assert.rejects(
    keyring.createKeys('undeployed', {
      devicePublicKey: selfDeviceKey,
      keyring: account,
      readers: [other],
    }),
    /not a unique live roster member/,
  );
  await assert.rejects(
    keyring.sealToDevice('undeployed', { ...account, encKey: new Uint8Array(32) }, other),
    /EncryptionKeyMismatch/,
  );
  await assert.rejects(
    keyring.createKeys('undeployed', {
      devicePublicKey: selfDeviceKey,
      keyring: account,
      removed: { devicePublicKey: other.devicePublicKey, epoch: 0n, counter: 0n },
    }),
    /fresh roster key/,
  );
  fake.secretKey.fill(0);
});

test('P-256 owner and JubJub device can open a mixed-roster rotation', async () => {
  /** @type {import('../packages/account/dist/ports/index.js').PrfKeySource} */
  const source = {
    withSession: (operation) => operation(),
    deriveSecret: async () => new Uint8Array(32).fill(9),
    async deviceSecret() {
      throw new Error('unused');
    },
  };
  const keyring = recipeDeviceKeyring(source);
  const p256Key = hex(p256.Point.BASE.toBytes(true));
  const created = await keyring.createKeys('undeployed', {
    scheme: 'p256-webauthn',
    devicePublicKey: p256Key,
  });
  const ownRegistration = created.registrations[0];
  assert.ok(ownRegistration);
  const ownerReader = new Uint8Array(32).fill(9);
  const originalEnvelope = created.envelopes[0];
  assert.ok(originalEnvelope);
  const original = await openDeviceEnvelope(ownerReader, originalEnvelope);
  assert.ok(original);
  assert.deepEqual(await openDeviceRegistration(original.rosterKey, ownRegistration), {
    readerPublicKey: hex(x25519.getPublicKey(ownerReader)),
    scheme: 'p256-webauthn',
    devicePublicKey: p256Key,
  });
  const remote = x25519.keygen();
  const joining = {
    readerPublicKey: hex(remote.publicKey),
    devicePublicKey: hex(jubjub.Point.BASE.multiply(3n).toBytes()),
    epoch: 0n,
    counter: 0n,
  };
  const account = {
    account: 'ab'.repeat(32),
    encKey: created.encKey,
    envelopes: created.envelopes,
  };
  const delivered = await keyring.sealToDevice('undeployed', account, joining);
  const rotated = await keyring.createKeys('undeployed', {
    scheme: 'p256-webauthn',
    devicePublicKey: p256Key,
    keyring: account,
    registrations: [ownRegistration, delivered.registration],
    readers: [joining],
    rotateRoster: true,
  });
  assert.equal(rotated.envelopes.length, 2);
  assert.equal(rotated.registrations.length, 2);
  const ownerEnvelope = rotated.envelopes[0];
  const remoteEnvelope = rotated.envelopes[1];
  assert.ok(ownerEnvelope && remoteEnvelope);
  const ownerRotated = await openDeviceEnvelope(ownerReader, ownerEnvelope);
  const remoteRotated = await openDeviceEnvelope(remote.secretKey, remoteEnvelope);
  assert.ok(ownerRotated && remoteRotated);
  assert.deepEqual(ownerRotated.secret, remoteRotated.secret);
  assert.deepEqual(x25519.getPublicKey(ownerRotated.secret), rotated.encKey);
  for (const opened of [original, ownerRotated, remoteRotated]) {
    opened.secret.fill(0);
    opened.rosterKey.fill(0);
  }
  ownerReader.fill(0);
  remote.secretKey.fill(0);
});

test('historical key overflow refuses instead of silently hiding old holdings', async () => {
  const source = {
    withSession: async (/** @type {()=>Promise<any>} */ work) => work(),
    deviceSecret: async () => new Uint8Array(32).fill(7),
    deriveSecret: async () => new Uint8Array(32).fill(7),
  };
  const ring = recipeDeviceKeyring(source);
  const keys = await ring.createKeys('undeployed', { devicePublicKey: selfDeviceKey });
  const envelopes = [...keys.envelopes];
  for (let n = 0; n < 17; n++)
    envelopes.unshift(
      await sealDeviceEnvelope(await ring.readerPublicKey('undeployed'), {
        secret: new Uint8Array(32).fill(40 + n),
        rosterKey: new Uint8Array(32).fill(90 + n),
      }),
    );
  await assert.rejects(
    ring.openInbox(
      'undeployed',
      { account: 'ab'.repeat(32), encKey: keys.encKey, envelopes },
      keys.registrations,
    ),
    /Too many distinct historical viewing keys/,
  );
});
