import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  snapshotDeviceReader,
  snapshotGrantScope,
} from '../packages/account/dist/request-snapshots.js';

test('device registration snapshots Node Buffer policy before callers can mutate it', () => {
  const input = {
    scheme: /** @type {const} */ ('p256-webauthn'),
    readerPublicKey: '01'.repeat(32),
    devicePublicKey: '02'.repeat(33),
    policy: { rp_id_hash: Buffer.alloc(32, 3), origin: Buffer.alloc(21, 4) },
  };
  const copy = snapshotDeviceReader(input);
  input.policy.rp_id_hash.fill(9);
  input.policy.origin.fill(8);
  input.readerPublicKey = 'ff'.repeat(32);
  assert.ok('policy' in copy);
  assert.deepEqual([...copy.policy.rp_id_hash], Array(32).fill(3));
  assert.deepEqual([...copy.policy.origin], Array(21).fill(4));
  assert.equal(copy.readerPublicKey, '01'.repeat(32));
  assert.ok(Object.isFrozen(copy));
  assert.deepEqual(snapshotDeviceReader({ readerPublicKey: '01', devicePublicKey: '02' }), {
    readerPublicKey: '01',
    devicePublicKey: '02',
  });
  for (const bad of [
    { ...input, scheme: 'unsupported' },
    { ...input, policy: undefined },
    { ...input, policy: { ...input.policy, rp_id_hash: new Uint8Array(31) } },
    { ...input, policy: { ...input.policy, origin: new Uint8Array(20) } },
    { readerPublicKey: '01', devicePublicKey: '02', policy: input.policy },
  ])
    assert.throws(
      () =>
        snapshotDeviceReader(
          /** @type {Parameters<typeof snapshotDeviceReader>[0]} */ (/** @type {unknown} */ (bad)),
        ),
      { code: 'DeviceRosterInvalid' },
    );
});

test('grant snapshots retain independent immutable nested scope and optional fields', () => {
  const input = {
    grantee: { scheme: /** @type {const} */ ('jubjub-schnorr'), publicKey: '01'.repeat(32) },
    operations: /** @type {Array<'withdraw-unshielded'>} */ (['withdraw-unshielded']),
    color: '02'.repeat(32),
    recipient: { kind: /** @type {const} */ ('user-address'), value: '03'.repeat(32) },
    maxCoinValue: '100',
    perCallCap: '10',
    cap: '50',
    expiresAt: 123,
    window: { lengthSeconds: 10, cap: '20' },
    read: true,
    readPublicKey: '04'.repeat(32),
    caller: '05'.repeat(32),
    rpId: 'localhost',
  };
  const copy = snapshotGrantScope(input);
  assert.deepEqual(copy, input);
  input.grantee.publicKey = 'ff'.repeat(32);
  input.operations.length = 0;
  input.recipient.value = 'ee'.repeat(32);
  input.window.cap = '1';
  assert.equal(copy.grantee.publicKey, '01'.repeat(32));
  assert.deepEqual(copy.operations, ['withdraw-unshielded']);
  assert.deepEqual(copy.recipient, { kind: 'user-address', value: '03'.repeat(32) });
  assert.equal(copy.window?.cap, '20');
  for (const value of [copy, copy.grantee, copy.operations, copy.recipient, copy.window])
    assert.ok(Object.isFrozen(value));
  assert.deepEqual(snapshotGrantScope({ ...input, recipient: { kind: 'any' } }).recipient, {
    kind: 'any',
  });
});
