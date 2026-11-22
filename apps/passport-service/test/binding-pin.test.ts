import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BINDING_VERSION,
  resolveBinding,
  resolvePinnedBinding,
} from '@input-output-hk/mn-passport-contract';
import { assertPinnedBinding } from '../src/binding-pin.ts';

test('the service refuses a binding or manifest other than the packaged ACC pin', () => {
  const binding = resolveBinding(BINDING_VERSION);
  const old = {
    bindingId: BINDING_VERSION,
    manifestSha256: binding.manifestSha256,
    contractDir: '/reference',
    artefactDir: '/reference/contracts/managed/account',
  };
  assert.doesNotThrow(() => assertPinnedBinding(old));
  assert.throws(() => assertPinnedBinding({ ...old, bindingId: 'acc-other' }), /not supported/);
  assert.throws(
    () => assertPinnedBinding({ ...old, manifestSha256: 'ab'.repeat(32) }),
    /differs from the package pin/,
  );
  const candidate = resolvePinnedBinding('acc-s3r1.1-zkir036');
  assert.throws(
    () =>
      assertPinnedBinding({
        ...old,
        bindingId: 'acc-s3r1.1-zkir036',
        manifestSha256: candidate.manifestSha256,
      }),
    /requires a separate ACC asset directory/,
  );
  assert.doesNotThrow(() =>
    assertPinnedBinding({
      ...old,
      bindingId: 'acc-s3r1.1-zkir036',
      manifestSha256: candidate.manifestSha256,
      artefactDir: '/candidate/account',
    }),
  );
});
