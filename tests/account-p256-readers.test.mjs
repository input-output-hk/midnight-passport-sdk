import assert from 'node:assert/strict';
import { test } from 'node:test';
import { p256 } from '@noble/curves/nist.js';
import { jubjub } from '@noble/curves/misc.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { resolveRegisteredReaders } from '../packages/account/dist/index.js';
import { recipeDeviceKeyring } from '../packages/keys/dist/index.js';

const account = 'ab'.repeat(32);
const self = { bytes: Buffer.from(account, 'hex') };
/** @param {Uint8Array} value */
const hex = (value) => Buffer.from(value).toString('hex');
const policy = { rp_id_hash: new Uint8Array(32).fill(4), origin: new Uint8Array(21).fill(5) };
const p256Point = { ...p256.Point.BASE.toAffine(), identity: false };
const jubjubPoint = pureCircuits.compute_public_point_with_jubjub(3n);
const keyring = recipeDeviceKeyring({
  withSession: async (operation) => operation(),
  deviceSecret: async () => new Uint8Array(32),
  deriveSecret: async () => new Uint8Array(32),
});
assert.ok(keyring.decodeDevicePublicKey);
assert.ok(keyring.decodeP256DevicePublicKey);
const base = {
  account,
  epoch: 2n,
  pure: pureCircuits,
  p256Pure: pureCircuits,
  decodeDevicePublicKey: keyring.decodeDevicePublicKey,
  decodeP256DevicePublicKey: keyring.decodeP256DevicePublicKey,
};

test('mixed roster resolves policy-bearing P-256 and JubJub readers against live entries', () => {
  const p256Entry = pureCircuits.derive_device_entry_with_p256(self, p256Point, policy, 2n, 7n);
  const jubjubEntry = pureCircuits.derive_device_entry_with_jubjub(self, jubjubPoint, 2n, 3n);
  /** @type {import('../packages/account/dist/ports/index.js').DeviceReader} */
  const p256Reader = {
    readerPublicKey: '11'.repeat(32),
    scheme: 'p256-webauthn',
    devicePublicKey: hex(p256.Point.BASE.toBytes(true)),
    policy,
  };
  const jubjubReader = {
    readerPublicKey: '22'.repeat(32),
    devicePublicKey: hex(jubjub.Point.fromAffine(jubjubPoint).toBytes()),
  };
  const result = resolveRegisteredReaders({
    ...base,
    registered: [p256Reader, jubjubReader],
    liveEntries: [p256Entry, jubjubEntry],
  });
  assert.deepEqual(result.readers, [
    { ...p256Reader, epoch: 2n, counter: 7n },
    { ...jubjubReader, epoch: 2n, counter: 3n },
  ]);
  assert.deepEqual(result.dropped, []);
});

test('key-only, wrong-policy, and conflicting P-256 registrations cannot claim a live reader', () => {
  const entry = pureCircuits.derive_device_entry_with_p256(self, p256Point, policy, 2n, 0n);
  /** @type {import('../packages/account/dist/ports/index.js').DeviceReader} */
  const reader = {
    readerPublicKey: '11'.repeat(32),
    scheme: 'p256-webauthn',
    devicePublicKey: hex(p256.Point.BASE.toBytes(true)),
    policy,
  };
  /** @type {import('../packages/account/dist/ports/index.js').DeviceReader[][]} */
  const cases = [
    [
      {
        readerPublicKey: reader.readerPublicKey,
        scheme: 'p256-webauthn',
        devicePublicKey: reader.devicePublicKey,
      },
    ],
    [{ ...reader, policy: { ...policy, origin: new Uint8Array(21).fill(6) } }],
    [reader, { ...reader, readerPublicKey: '22'.repeat(32) }],
  ];
  for (const registered of cases) {
    const result = resolveRegisteredReaders({ ...base, registered, liveEntries: [entry] });
    assert.deepEqual(result.readers, []);
    assert.deepEqual(result.dropped, [entry]);
  }
});
