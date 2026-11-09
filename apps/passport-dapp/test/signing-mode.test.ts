import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoSigningMode } from '../src/signing-mode.ts';

test('signing mode defaults to passkey and accepts explicit configuration or legacy arms', () => {
  assert.deepEqual(demoSigningMode({}), { mode: 'passkey', arm: 'p256' });
  assert.deepEqual(demoSigningMode({ mode: 'jubjub' }), { mode: 'jubjub', arm: 'jubjub' });
  assert.equal(demoSigningMode({ legacyArm: 'p256' }).mode, 'passkey');
  assert.equal(demoSigningMode({ legacyArm: 'jubjub' }).mode, 'jubjub');
  assert.equal(demoSigningMode({ mode: 'passkey', legacyArm: 'p256' }).mode, 'passkey');
  assert.equal(Object.isFrozen(demoSigningMode({})), true);
});
test('a comparison link explicitly overrides the configured default without mutating it', () => {
  const input = { mode: 'passkey', search: '?signing=jubjub&mockPasskey' };
  assert.deepEqual(demoSigningMode(input), { mode: 'jubjub', arm: 'jubjub' });
  assert.equal(input.mode, 'passkey');
});
test('invalid, conflicting and repeated configuration refuses without selecting a fallback signer', () => {
  for (const input of [
    { mode: '' },
    { mode: 'p256' },
    { legacyArm: 'passkey' },
    { mode: 'jubjub', legacyArm: 'p256' },
    { search: '?signing=' },
    { search: '?signing=other' },
    { search: '?signing=passkey&signing=jubjub' },
  ])
    assert.throws(() => demoSigningMode(input));
});
