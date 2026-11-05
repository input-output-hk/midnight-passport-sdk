import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { demoValueCall, demoSessionValueCall } from '../src/value-call.ts';

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

test('real value HTTP acknowledgement survives a local lock after request acceptance; pre-locked sends never start', async () => {
  let accepted!: () => void;
  const seen = new Promise<void>((r) => {
    accepted = r;
  });
  let requests = 0;
  let sendReceipt!: () => void;
  const server = createServer((request, response) => {
    requests++;
    request.resume();
    sendReceipt = () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ txHash: 'AB'.repeat(32) }));
    };
    accepted();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const controller = new AbortController();
  const intent = {
    address: '12'.repeat(32),
    circuit: 'withdraw_unshielded_with_grant_jubjub',
    args: [new Uint8Array(32), 1n],
    signal: controller.signal,
  };
  try {
    const pending = demoSessionValueCall(`http://127.0.0.1:${address.port}`, intent);
    await seen;
    controller.abort();
    sendReceipt();
    assert.equal((await pending).txHash, 'ab'.repeat(32));
    await assert.rejects(demoSessionValueCall(`http://127.0.0.1:${address.port}`, intent), {
      code: 'Aborted',
    });
    assert.equal(requests, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
