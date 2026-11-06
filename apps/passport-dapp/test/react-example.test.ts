import assert from 'node:assert/strict';
import { test } from 'node:test';

test('optional React hook and renderers import without a browser or mounting an application', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  const { usePassportActivity } = await import('../src/examples/react-store.ts');
  const controls = await import('../src/examples/react-controls.ts');
  assert.equal(typeof usePassportActivity, 'function');
  assert.equal(typeof controls.ActivityPanel, 'function');
  assert.equal(typeof controls.OperationStatus, 'function');
  assert.equal(typeof controls.Journey, 'function');
  assert.equal(typeof globalThis.document, 'undefined');
});
