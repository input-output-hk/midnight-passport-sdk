import assert from 'node:assert/strict';
import { test } from 'node:test';
import { supportsLocalNamedNightSend } from '../src/midnames/night-send-profile.js';

test('the 0.36.1 named NIGHT route requires the isolated candidate binding', () => {
  const candidate = { bindingId: 'acc-s3r1.1-zkir036' };
  assert.equal(supportsLocalNamedNightSend('standalone-0.36.1', '1', candidate), true);
  assert.equal(supportsLocalNamedNightSend('standalone-0.36.1', undefined, candidate), false);
  assert.equal(supportsLocalNamedNightSend('standalone-0.36.1', '1', undefined), false);
  assert.equal(
    supportsLocalNamedNightSend('standalone-0.36.1', '1', { bindingId: 'acc-s3r1.1' }),
    false,
  );
  assert.equal(supportsLocalNamedNightSend('midnames-2.1.0', '1', candidate), false);
  assert.equal(supportsLocalNamedNightSend('standalone-0.35', undefined, undefined), true);
});
