import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoValueCall } from '../src/value-call.ts';

test('demo value call sends signed circuit arguments, not an unsigned transaction', async () => {
  const originalFetch = globalThis.fetch;
  let sent: Record<string, unknown> | undefined;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ txHash: 'a'.repeat(64), blockHeight: 9 }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const result = await demoValueCall('http://localhost:8787', {
      address: 'b'.repeat(64),
      circuit: 'withdraw_unshielded_with_p256',
      args: [Uint8Array.of(0, 255), 4n, { bytes: Uint8Array.of(3) }, { pk: { x: 5n } }],
    });
    assert.equal(result.txHash, 'a'.repeat(64));
    assert.deepEqual(sent, {
      accountAddress: 'b'.repeat(64),
      circuit: 'withdraw_unshielded_with_p256',
      args: [
        { $bytes: '00ff' },
        { $bigint: '4' },
        { bytes: { $bytes: '03' } },
        { pk: { x: { $bigint: '5' } } },
      ],
    });
    await assert.rejects(
      () =>
        demoValueCall('http://localhost:8787', {
          address: 'b'.repeat(64),
          circuit: 'withdraw_shielded_with_p256',
          args: [],
        }),
      /does not support/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
