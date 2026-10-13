import { test } from 'node:test';
import assert from 'node:assert/strict';

const generated = await import('../packages/contract/generated/acc-s3r1.1/index.js');
/** @type {import('../packages/adapter-midnight-js/dist/index.js').MidnightBinding} */
const binding = generated;

test('the release ACC module supplies the browser chain binding shape', () => {
  assert.equal(typeof binding.Contract, 'function');
  assert.equal(typeof binding.ledger, 'function');
  assert.equal(typeof binding.pureCircuits.derive_boot_commitment_with_p256, 'function');
  assert.equal(typeof binding.pureCircuits.derive_device_entry_with_p256, 'function');
  assert.equal(typeof binding.pureCircuits.challenge_rotate_enc_key_with_p256, 'function');
});
