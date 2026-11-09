import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoSigningEnvironment } from '../scripts/demo-signing.mjs';
import { parseArgs } from '../scripts/demo.mjs';

test('the default launcher respects explicit signing configuration without setting a conflicting legacy arm', () => {
  const options = parseArgs([]);
  assert.deepEqual(demoSigningEnvironment(options, {}), { VITE_PASSPORT_ARM: 'p256' });
  assert.deepEqual(demoSigningEnvironment(options, { VITE_PASSPORT_SIGNING_MODE: 'jubjub' }), {
    VITE_PASSPORT_ARM: 'jubjub',
    VITE_PASSPORT_SIGNING_MODE: 'jubjub',
  });
  assert.equal(
    demoSigningEnvironment(parseArgs(['up', '--arm', 'jubjub']), {}).VITE_PASSPORT_ARM,
    'jubjub',
  );
  assert.equal(
    demoSigningEnvironment(options, { VITE_PASSPORT_ARM: 'jubjub' }).VITE_PASSPORT_ARM,
    'jubjub',
  );
});
test('explicit conflicting arms or invalid signing configuration refuse before setup', () => {
  for (const env of [
    { VITE_PASSPORT_SIGNING_MODE: '' },
    { VITE_PASSPORT_SIGNING_MODE: 'p256' },
    { VITE_PASSPORT_SIGNING_MODE: 'jubjub', VITE_PASSPORT_ARM: 'p256' },
  ])
    assert.throws(() => demoSigningEnvironment(parseArgs([]), env));
  assert.throws(() =>
    demoSigningEnvironment(parseArgs(['--arm', 'p256']), { VITE_PASSPORT_SIGNING_MODE: 'jubjub' }),
  );
});
