import assert from 'node:assert/strict';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  isAddressedTo,
  openDeviceEnvelope,
  openDeviceRegistration,
  sealDeviceEnvelope,
  sealDeviceRegistration,
} from '../packages/keys/dist/device-envelope.js';
import { openGrantRecord, sealGrantRecord } from '../packages/keys/dist/grant-record.js';
import {
  laceEnvelope,
  laceGrantRecord,
  laceRegistration,
} from './fixtures/lace-suite2-vectors.mjs';

const readerSecret = new Uint8Array(32).fill(0x33);
const readerPublicKey = x25519.getPublicKey(readerSecret);
const rosterKey = new Uint8Array(32).fill(0x55);
const account = 'ac'.repeat(32);
const grant = {
  part: /** @type {const} */ ('grant'),
  grantId: 'ab'.repeat(32),
  slot: 7,
  scopeSalt: 'cd'.repeat(32),
  granteePublicKey: 'ef'.repeat(32),
  readPublicKey: '12'.repeat(32),
};
/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');

/** Lace's known-answer tests fill the ephemeral key and each nonce with 0x22. */
/** @param {import('node:test').TestContext} context */
const fixRandomness = (context) => {
  /** @param {Uint8Array} array */
  const fill = (array) => {
    if (array) new Uint8Array(array.buffer, array.byteOffset, array.byteLength).fill(0x22);
    return array;
  };
  context.mock.method(crypto, 'getRandomValues', fill);
};

test('SDK opens Lace suite 2 envelope, registration and grant record bytes', async () => {
  const envelope = Buffer.from(laceEnvelope, 'hex');
  const registration = Buffer.from(laceRegistration, 'hex');
  const record = Buffer.from(laceGrantRecord, 'hex');
  assert.equal(isAddressedTo(envelope, readerPublicKey), true);
  assert.deepEqual(await openDeviceEnvelope(readerSecret, envelope), {
    secret: new Uint8Array(32).fill(0x44),
    rosterKey,
  });
  assert.deepEqual(await openDeviceRegistration(rosterKey, registration), {
    readerPublicKey: hex(readerPublicKey),
    devicePublicKey: '66'.repeat(32),
  });
  assert.deepEqual(await openGrantRecord(readerSecret, account, record), grant);

  const copiedTag = envelope.slice();
  copiedTag[158] = (copiedTag[158] ?? 0) ^ 1;
  assert.equal(isAddressedTo(copiedTag, readerPublicKey), false);
});

test('SDK writes the exact Lace suite 2 known-answer bytes', async (context) => {
  fixRandomness(context);
  assert.equal(
    hex(
      await sealDeviceEnvelope(readerPublicKey, {
        secret: new Uint8Array(32).fill(0x44),
        rosterKey,
      }),
    ),
    laceEnvelope,
  );
  assert.equal(
    hex(
      await sealDeviceRegistration(rosterKey, {
        readerPublicKey: hex(readerPublicKey),
        devicePublicKey: '66'.repeat(32),
      }),
    ),
    laceRegistration,
  );
  assert.equal(hex(await sealGrantRecord(readerSecret, account, grant)), laceGrantRecord);
});
