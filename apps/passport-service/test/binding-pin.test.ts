import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BINDING_VERSION, resolveBinding } from '@input-output-hk/mn-passport-contract';
import { assertPinnedBinding } from '../src/binding-pin.ts';

test('the service refuses a binding or manifest other than the packaged ACC pin', () => {
  const binding = resolveBinding(BINDING_VERSION);
  assert.doesNotThrow(() =>
    assertPinnedBinding({ bindingId: BINDING_VERSION, manifestSha256: binding.manifestSha256 }),
  );
  assert.throws(
    () => assertPinnedBinding({ bindingId: 'acc-other', manifestSha256: binding.manifestSha256 }),
    /differs from the package pin/,
  );
  assert.throws(
    () => assertPinnedBinding({ bindingId: BINDING_VERSION, manifestSha256: 'ab'.repeat(32) }),
    /differs from the package pin/,
  );
});
