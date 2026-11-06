import assert from 'node:assert/strict';
import { test } from 'node:test';
import { journeyArms } from '../e2e/journey-arms.ts';

test('local browser qualification defaults to both owner arms', () => {
  const arms = journeyArms(undefined);
  assert.deepEqual(arms, ['p256', 'jubjub']);
  assert.equal(Object.isFrozen(arms), true);
});

test('CI can select one complete owner-arm profile without changing its cases', () => {
  for (const arm of ['p256', 'jubjub'] as const) assert.deepEqual(journeyArms(arm), [arm]);
});

test('empty, misspelled and partial environment selections cannot silently skip coverage', () => {
  for (const value of ['', 'both', 'P256', 'jub', 'p256,jubjub', ' jubjub', 'none']) {
    assert.throws(() => journeyArms(value), /PASSPORT_DEMO_JOURNEY_ARM/);
  }
});
