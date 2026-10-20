import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jubjub } from '@noble/curves/misc.js';
import { resolveRegisteredReaders } from '../packages/account/dist/index.js';
import { recipeDeviceKeyring } from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { AccSimulator, simulationDevice } from '../scripts/qualification/acc-simulator.mjs';

const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');
const keyring = recipeDeviceKeyring({
  withSession: (operation) => operation(),
  deviceSecret: async () => new Uint8Array(32),
  deriveSecret: async () => new Uint8Array(32),
});
for (const arm of /** @type {const} */ (['jubjub', 'p256'])) {
  test(`${arm}: multiple counters are not silently treated as one completely revocable device`, async () => {
    const device = simulationDevice(arm),
      sim = await AccSimulator.create({ owner: device });
    const pub =
      device.arm === 'jubjub'
        ? hex(jubjub.Point.fromAffine(device.pk).toBytes())
        : `${device.pk.y & 1n ? '03' : '02'}${device.pk.x.toString(16).padStart(64, '0')}`;
    const registered = [
      {
        scheme:
          device.arm === 'jubjub'
            ? /** @type {const} */ ('jubjub-schnorr')
            : /** @type {const} */ ('p256-webauthn'),
        readerPublicKey: '11'.repeat(32),
        devicePublicKey: pub,
        ...(device.arm === 'p256' && { policy: device.policy }),
      },
    ];
    const first = sim.entry(device, 0n),
      second = sim.entry(device, 7n);
    const base = {
      account: sim.address,
      epoch: 0n,
      registered,
      liveEntries: [first, second],
      pure: pureCircuits,
      p256Pure: pureCircuits,
      decodeDevicePublicKey: keyring.decodeDevicePublicKey,
      decodeP256DevicePublicKey: keyring.decodeP256DevicePublicKey,
    };
    assert.ok(base.decodeDevicePublicKey && base.decodeP256DevicePublicKey);
    const resolved = resolveRegisteredReaders({
      ...base,
      decodeDevicePublicKey: base.decodeDevicePublicKey,
      decodeP256DevicePublicKey: base.decodeP256DevicePublicKey,
      allowedEntries: [second],
    });
    assert.equal(resolved.readers.length, 0);
    assert.deepEqual(resolved.dropped, [second]);
    assert.equal(resolved.outside.length, 1);
    // The SDK refuses this unresolved live survivor before sharing fresh key material.
  });
}

test('historical registration recovery never promotes old metadata into fresh-key recipients', async () => {
  const { resolveRemovalReader } = await import('../packages/account/dist/removal-reader.js');
  const surviving = {
    readerPublicKey: '11'.repeat(32),
    devicePublicKey: '22'.repeat(32),
    epoch: 0n,
    counter: 1n,
  };
  const removed = {
    readerPublicKey: '33'.repeat(32),
    devicePublicKey: '44'.repeat(32),
    epoch: 0n,
    counter: 0n,
  };
  const current = { readers: [surviving], outside: [], dropped: [] };
  const before = structuredClone(current);
  const found = await resolveRemovalReader(current, {
    read: async () => [removed],
    resolve: () => ({ readers: [], outside: [removed], dropped: [] }),
  });
  assert.deepEqual(found, removed);
  assert.deepEqual(current, before);
  await assert.rejects(resolveRemovalReader(current, { resolve: () => current }), {
    code: 'DeviceRosterInvalid',
  });
  await assert.rejects(
    resolveRemovalReader(current, {
      read: async () => [removed],
      resolve: () => ({ readers: [], outside: [removed, removed], dropped: [] }),
    }),
    { code: 'DeviceRosterInvalid' },
  );
  await assert.rejects(
    resolveRemovalReader(current, {
      read: async () => [removed],
      resolve: () => ({
        readers: [],
        outside: [{ ...removed, readerPublicKey: surviving.readerPublicKey }],
        dropped: [],
      }),
    }),
    { code: 'DeviceRosterInvalid' },
  );
});
