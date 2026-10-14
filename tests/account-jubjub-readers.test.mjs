import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { resolveJubjubReaders } from '../packages/account/dist/index.js';
import { recipeDeviceKeyring } from '../packages/keys/dist/index.js';

const account = 'ab'.repeat(32);
const self = { bytes: Buffer.from(account, 'hex') };
const hex = (/** @type {Uint8Array} */ value) => Buffer.from(value).toString('hex');
const point = (/** @type {bigint} */ scalar) =>
  pureCircuits.compute_public_point_with_jubjub(scalar);
const compressed = (/** @type {{x: bigint,y: bigint}} */ value) =>
  hex(jubjub.Point.fromAffine(value).toBytes());
const entry = (/** @type {{x: bigint,y: bigint}} */ pk, /** @type {bigint} */ counter) =>
  pureCircuits.derive_device_entry_with_jubjub(self, pk, 3n, counter);
const keyring = recipeDeviceKeyring({
  withSession: async (operation) => operation(),
  deviceSecret: async () => new Uint8Array(32),
  deriveSecret: async () => new Uint8Array(32),
});
const decodeDevicePublicKey = keyring.decodeDevicePublicKey;
assert.ok(decodeDevicePublicKey);

test('reader resolution keeps unique live devices, reports exclusions and missing registrations', () => {
  const [a, b, c] = [point(1n), point(2n), point(3n)];
  const liveEntries = [entry(a, 127n), entry(b, 0n), entry(c, 0n)];
  const result = resolveJubjubReaders({
    account,
    epoch: 3n,
    registered: [
      { readerPublicKey: '11'.repeat(32), devicePublicKey: compressed(a) },
      { readerPublicKey: '11'.repeat(32), devicePublicKey: compressed(a) },
      { readerPublicKey: '22'.repeat(32), devicePublicKey: compressed(b) },
    ],
    liveEntries,
    allowedEntries: [entry(a, 127n), entry(c, 0n)],
    pure: pureCircuits,
    decodeDevicePublicKey,
  });
  assert.deepEqual(result.readers, [
    {
      readerPublicKey: '11'.repeat(32),
      devicePublicKey: compressed(a),
      epoch: 3n,
      counter: 127n,
    },
  ]);
  assert.deepEqual(result.dropped, [liveEntries[2]]);
  assert.equal(result.outside[0]?.devicePublicKey, compressed(b));
});

test('reader resolution drops conflicting reader and device claims', () => {
  const [a, b] = [point(1n), point(2n)];
  const liveEntries = [entry(a, 0n), entry(b, 0n)];
  const base = { account, epoch: 3n, liveEntries, pure: pureCircuits, decodeDevicePublicKey };
  const sameReader = resolveJubjubReaders({
    ...base,
    registered: [
      { readerPublicKey: '11'.repeat(32), devicePublicKey: compressed(a) },
      { readerPublicKey: '11'.repeat(32), devicePublicKey: compressed(b) },
    ],
  });
  assert.deepEqual(sameReader.readers, []);
  assert.deepEqual(sameReader.dropped, liveEntries);
  const sameDevice = resolveJubjubReaders({
    ...base,
    registered: [
      { readerPublicKey: '11'.repeat(32), devicePublicKey: compressed(a) },
      { readerPublicKey: '22'.repeat(32), devicePublicKey: compressed(a) },
      { readerPublicKey: '33'.repeat(32), devicePublicKey: compressed(b) },
    ],
  });
  assert.deepEqual(
    sameDevice.readers.map((reader) => reader.readerPublicKey),
    ['33'.repeat(32)],
  );
  assert.deepEqual(sameDevice.dropped, [liveEntries[0]]);
});

test('reader resolution rejects a non-live allowed entry and ignores invalid points', () => {
  const a = point(1n);
  const liveEntries = [entry(a, 0n)];
  const base = { account, epoch: 3n, liveEntries, pure: pureCircuits, decodeDevicePublicKey };
  assert.throws(
    () =>
      resolveJubjubReaders({
        ...base,
        registered: [],
        allowedEntries: [new Uint8Array(32).fill(7)],
      }),
    /not live/,
  );
  const result = resolveJubjubReaders({
    ...base,
    registered: [{ readerPublicKey: '11'.repeat(32), devicePublicKey: 'ff'.repeat(32) }],
  });
  assert.deepEqual(result.readers, []);
  assert.deepEqual(result.dropped, liveEntries);
});
