import assert from 'node:assert/strict';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  isAddressedTo,
  openDeviceEnvelope,
  openDeviceRegistration,
  sealDeviceEnvelope,
  sealDeviceRegistration,
} from '../packages/keys/dist/device-envelope.js';

/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');
/** @param {string} value */
const text = (value) => new TextEncoder().encode(value);

test('device envelope matches the Lace wire layout and opens only for its reader', async () => {
  const reader = x25519.keygen();
  const other = x25519.keygen();
  const secrets = { secret: new Uint8Array(32).fill(17), rosterKey: new Uint8Array(32).fill(29) };
  const entry = await sealDeviceEnvelope(reader.publicKey, secrets);

  assert.equal(entry.length, 192);
  assert.deepEqual([...entry.subarray(0, 2)], [0xd1, 1]);
  assert.ok(entry.subarray(158).every((byte) => byte === 0));
  assert.deepEqual(
    entry.subarray(2, 34),
    sha256(
      Buffer.concat([
        text('lace:passport:envelope-tag:v1'),
        reader.publicKey,
        entry.subarray(34, 66),
      ]),
    ),
  );
  assert.equal(isAddressedTo(entry, reader.publicKey), true);
  assert.equal(isAddressedTo(entry, other.publicKey), false);
  assert.deepEqual(await openDeviceEnvelope(reader.secretKey, entry), secrets);
  assert.equal(await openDeviceEnvelope(other.secretKey, entry), null);

  // Independently decrypt the wire bytes with Lace's HKDF label and AEAD offsets.
  const shared = x25519.getSharedSecret(reader.secretKey, entry.subarray(34, 66));
  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(),
      info: text('lace:passport:device-envelope:v1'),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: entry.subarray(66, 78), additionalData: entry.subarray(0, 78) },
      key,
      Buffer.concat([entry.subarray(94, 158), entry.subarray(78, 94)]),
    ),
  );
  assert.deepEqual(plaintext, Uint8Array.from(Buffer.concat([secrets.secret, secrets.rosterKey])));

  for (const offset of [0, 1, 2, 34, 66, 78, 94, 158, 191]) {
    const tampered = entry.slice();
    tampered[offset] = (tampered[offset] ?? 0) ^ 1;
    assert.equal(await openDeviceEnvelope(reader.secretKey, tampered), null, `offset ${offset}`);
  }
  assert.equal(await openDeviceEnvelope(reader.secretKey, entry.subarray(0, 191)), null);
  shared.fill(0);
  reader.secretKey.fill(0);
  other.secretKey.fill(0);
});

test('device registration authenticates the reader/device pairing under the roster key', async () => {
  const rosterKey = new Uint8Array(32).fill(3);
  const device = { readerPublicKey: 'ab'.repeat(32), devicePublicKey: 'cd'.repeat(32) };
  const entry = await sealDeviceRegistration(rosterKey, device);
  assert.equal(entry.length, 192);
  assert.deepEqual([...entry.subarray(0, 2)], [0xd2, 1]);
  assert.ok(entry.subarray(94).every((byte) => byte === 0));
  assert.deepEqual(await openDeviceRegistration(rosterKey, entry), device);
  assert.equal(await openDeviceRegistration(new Uint8Array(32).fill(4), entry), null);
  const changed = entry.slice();
  changed[50] = (changed[50] ?? 0) ^ 1;
  assert.equal(await openDeviceRegistration(rosterKey, changed), null);
  assert.equal(await openDeviceRegistration(rosterKey, entry.subarray(0, 191)), null);
  assert.equal(hex(entry.subarray(0, 2)), 'd201');
});
