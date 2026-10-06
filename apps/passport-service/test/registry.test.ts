import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.ts';
import { registryRoute } from '../src/routes/registry.ts';
import { testConfig } from './fixtures.ts';

const record = {
  credentialId: '0a0b',
  address: 'ab'.repeat(32),
  publicKey: { x: '5', y: '7' },
  policy: { rp_id_hash: '00'.repeat(32), origin: '68'.repeat(21) },
  salt: '04'.repeat(32),
  status: 'deployed',
};

async function start(config = testConfig()) {
  const server = createServer(config, [registryRoute(config)]);
  await new Promise<void>((r) => server.listen(0, r));
  return { base: `http://localhost:${(server.address() as AddressInfo).port}`, server, config };
}

test('PUT then GET returns the record, keyed by network and credential', async () => {
  const { base, server } = await start();
  const put = await fetch(`${base}/accounts/undeployed/0a0b`, {
    method: 'PUT',
    body: JSON.stringify(record),
  });
  assert.equal(put.status, 204);
  assert.deepEqual(await (await fetch(`${base}/accounts/undeployed/0a0b`)).json(), record);
  assert.equal((await fetch(`${base}/accounts/testnet/0a0b`)).status, 404, 'network-bound');
  server.close();
});

test('records survive a restart', async () => {
  const first = await start();
  await fetch(`${first.base}/accounts/undeployed/0a0b`, {
    method: 'PUT',
    body: JSON.stringify(record),
  });
  first.server.close();
  const second = await start(first.config);
  assert.equal((await fetch(`${second.base}/accounts/undeployed/0a0b`)).status, 200);
  second.server.close();
});

test('malformed ids or bodies are refused with 400', async () => {
  const { base, server } = await start();
  assert.equal(
    (await fetch(`${base}/accounts/undeployed/zz`, { method: 'PUT', body: JSON.stringify(record) }))
      .status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/accounts/undeployed/0a0b`, {
        method: 'PUT',
        body: JSON.stringify({ ...record, credentialId: '0c' }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/accounts/undeployed/0a0b`, {
        method: 'PUT',
        body: JSON.stringify({ ...record, status: 'x' }),
      })
    ).status,
    400,
  );
  server.close();
});
