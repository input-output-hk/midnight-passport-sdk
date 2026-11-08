import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootstrapPlan } from '../e2e/journeys/bootstrap.js';
import { journeyGroups } from '../e2e/journeys/catalog.mjs';
test('signed-out and presentation groups cannot claim bootstrap account/key authority', () => {
  assert.deepEqual(bootstrapPlan('presentation'), []);
  assert.deepEqual(bootstrapPlan('account-actions'), ['signed-out-page']);
});
test('private group prerequisites remain explicit actual-UI recipes, separate from case credit', () => {
  assert.deepEqual(bootstrapPlan('scoped-sessions'), ['create', 'wallet', 'fund', 'session-draft']);
  assert.deepEqual(bootstrapPlan('owner-safety'), ['prepareJoiner', 'wallet']);
  for (const group of journeyGroups) assert.equal(Object.isFrozen(bootstrapPlan(group)), true);
});
