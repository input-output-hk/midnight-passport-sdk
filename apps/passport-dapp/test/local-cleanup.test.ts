import assert from 'node:assert/strict';
import { test } from 'node:test';
import { completeLocalCleanup } from '../src/local-cleanup.js';
import { setOperationTraceSink, traceOperation } from '../src/operation-trace.js';
test('all local disposal and warning steps run despite callback errors', () => {
  const calls: string[] = [];
  assert.equal(
    completeLocalCleanup([
      () => {
        calls.push('owner');
        throw Error('observer');
      },
      () => {
        calls.push('grant');
        throw Error('storage');
      },
      () => {
        calls.push('warning');
      },
    ]),
    false,
  );
  assert.deepEqual(calls, ['owner', 'grant', 'warning']);
});
test('trace observers cannot turn a known transport acknowledgement into an error', () => {
  setOperationTraceSink(() => {
    throw Error('renderer failed');
  });
  try {
    assert.doesNotThrow(() => traceOperation('http.response.body', { txId: 'known-id' }));
  } finally {
    setOperationTraceSink(() => {});
  }
});
