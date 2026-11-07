import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { createServer } from '../src/server.ts';
import { registryRoute } from '../src/routes/registry.ts';
import { JSON_TYPE, testConfig } from './fixtures.ts';

const record = {
  credentialId: '0a0b',
  address: 'ab'.repeat(32),
  publicKey: { x: '5', y: '7' },
  policy: { rp_id_hash: '00'.repeat(32), origin: '68'.repeat(21) },
  salt: '04'.repeat(32),
  status: 'deployed' as const,
};

async function start(config = testConfig()) {
  const server = createServer(config, [registryRoute(config)]);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server, config };
}

// Keep endpoint family and owned lifetime deterministic under parallel app/browser jobs.
const stops = new WeakMap<ReturnType<typeof createServer>, Promise<void>>();
function stop(server: ReturnType<typeof createServer>): Promise<void> {
  let pending = stops.get(server);
  if (!pending) {
    pending = new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    stops.set(server, pending);
  }
  return pending;
}
async function registryFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    const cause = (error as { cause?: { code?: string; errors?: { code?: string }[] } }).cause;
    const codes = [cause?.code, ...(cause?.errors?.map((item) => item.code) ?? [])].filter(Boolean);
    throw new Error(`Registry test connection failed (${codes.join(',') || 'unreported cause'})`, {
      cause: error,
    });
  }
}

test('malformed ids or bodies are refused with 400', async () => {
  const { base, server } = await start();
  try {
    assert.equal(
      (
        await registryFetch(`${base}/accounts/undeployed/zz`, {
          method: 'PUT',
          headers: JSON_TYPE,
          body: JSON.stringify(record),
        })
      ).status,
      400,
      'non-hex credential ID',
    );
    assert.equal(
      (
        await registryFetch(`${base}/accounts/undeployed/0a0b`, {
          method: 'PUT',
          headers: JSON_TYPE,
          body: JSON.stringify({ ...record, credentialId: '0c' }),
        })
      ).status,
      400,
      'credential ID mismatch',
    );
    assert.equal(
      (
        await registryFetch(`${base}/accounts/undeployed/0a0b`, {
          method: 'PUT',
          headers: JSON_TYPE,
          body: JSON.stringify({ ...record, status: 'x' }),
        })
      ).status,
      400,
      'invalid status',
    );
    assert.equal(
      (
        await registryFetch(`${base}/accounts/undeployed/0a0`, {
          method: 'PUT',
          headers: JSON_TYPE,
          body: JSON.stringify({ ...record, credentialId: '0a0' }),
        })
      ).status,
      400,
      'odd-length credential ID in PUT',
    );
    assert.equal(
      (await registryFetch(`${base}/accounts/undeployed/0a0`)).status,
      400,
      'odd-length credential ID in GET',
    );
  } finally {
    await stop(server);
  }
});

test('identical deployed re-PUT returns 204', async () => {
  const { base, server } = await start();
  try {
    const put1 = await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(record),
    });
    assert.equal(put1.status, 204);
    const put2 = await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(record),
    });
    assert.equal(put2.status, 204);
    const get = await registryFetch(`${base}/accounts/undeployed/0a0b`);
    assert.equal(get.status, 200);
    assert.deepEqual(await get.json(), record);
  } finally {
    await stop(server);
  }
});

test('deployed to active transition returns 204 and updates status', async () => {
  const { base, server } = await start();
  try {
    await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(record),
    });
    const transitioned = { ...record, status: 'active' as const };
    const put2 = await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(transitioned),
    });
    assert.equal(put2.status, 204);
    const get = await registryFetch(`${base}/accounts/undeployed/0a0b`);
    assert.equal(get.status, 200);
    const retrieved = (await get.json()) as typeof record;
    assert.equal(retrieved.status, 'active');
  } finally {
    await stop(server);
  }
});

test('identical active re-PUT returns 204', async () => {
  const { base, server } = await start();
  try {
    const activeRecord = { ...record, status: 'active' as const };
    await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(activeRecord),
    });
    const put2 = await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(activeRecord),
    });
    assert.equal(put2.status, 204);
  } finally {
    await stop(server);
  }
});

test('active to deployed transition returns 409 and record stays active', async () => {
  const { base, server } = await start();
  try {
    const activeRecord = { ...record, status: 'active' as const };
    await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(activeRecord),
    });
    const transition = { ...record, status: 'deployed' as const };
    const put2 = await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(transition),
    });
    assert.equal(put2.status, 409);
    const get = await registryFetch(`${base}/accounts/undeployed/0a0b`);
    const retrieved = (await get.json()) as typeof record;
    assert.equal(retrieved.status, 'active', 'record should remain active');
  } finally {
    await stop(server);
  }
});

test('different address over existing record returns 409 and GET is unchanged', async () => {
  const { base, server } = await start();
  try {
    await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(record),
    });
    const changed = { ...record, address: 'cd'.repeat(32) };
    const put2 = await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(changed),
    });
    assert.equal(put2.status, 409);
    const get = await registryFetch(`${base}/accounts/undeployed/0a0b`);
    const retrieved = (await get.json()) as typeof record;
    assert.equal(retrieved.address, record.address, 'original address should be unchanged');
  } finally {
    await stop(server);
  }
});

test('different salt over existing record returns 409', async () => {
  const { base, server } = await start();
  try {
    await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(record),
    });
    const changed = { ...record, salt: '05'.repeat(32) };
    const put2 = await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(changed),
    });
    assert.equal(put2.status, 409);
  } finally {
    await stop(server);
  }
});

test('deployed to active with changed salt returns 409', async () => {
  const { base, server } = await start();
  try {
    await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(record),
    });
    const changed = { ...record, status: 'active' as const, salt: '05'.repeat(32) };
    const put2 = await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(changed),
    });
    assert.equal(put2.status, 409);
  } finally {
    await stop(server);
  }
});

test('same credential on testnet returns 204, with undeployed untouched', async () => {
  const { base, server } = await start();
  try {
    await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(record),
    });
    const putTestnet = await registryFetch(`${base}/accounts/testnet/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(record),
    });
    assert.equal(putTestnet.status, 204);
    const get1 = await registryFetch(`${base}/accounts/undeployed/0a0b`);
    const get2 = await registryFetch(`${base}/accounts/testnet/0a0b`);
    assert.equal(get1.status, 200);
    assert.equal(get2.status, 200);
    assert.deepEqual(await get1.json(), record);
    assert.deepEqual(await get2.json(), record);
  } finally {
    await stop(server);
  }
});

test('identical record with different key order returns 204', async () => {
  const { base, server } = await start();
  try {
    await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(record),
    });
    // Reorder keys: credentialId last
    const reordered = JSON.parse(
      JSON.stringify({
        status: record.status,
        salt: record.salt,
        policy: record.policy,
        publicKey: record.publicKey,
        address: record.address,
        credentialId: record.credentialId,
      }),
    );
    const put2 = await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(reordered),
    });
    assert.equal(put2.status, 204);
  } finally {
    await stop(server);
  }
});

test('409 persists after a restart', async () => {
  const first = await start();
  try {
    await registryFetch(`${first.base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(record),
    });
    await stop(first.server);
    const second = await start(first.config);
    try {
      const changed = { ...record, address: 'cd'.repeat(32) };
      const put2 = await registryFetch(`${second.base}/accounts/undeployed/0a0b`, {
        method: 'PUT',
        headers: JSON_TYPE,
        body: JSON.stringify(changed),
      });
      assert.equal(put2.status, 409);
    } finally {
      await stop(second.server);
    }
  } finally {
    await stop(first.server);
  }
});

test('corrupt registry file returns 500, excludes file contents, and leaves file unchanged', async () => {
  const config = testConfig();
  const corruptContent = 'not valid json';
  writeFileSync(config.registryFile, corruptContent);
  const fileContentsBefore = readFileSync(config.registryFile, 'utf8');
  const { base, server } = await start(config);
  try {
    const get = await registryFetch(`${base}/accounts/undeployed/0a0b`);
    assert.equal(get.status, 500);
    const body = (await get.json()) as { error: string };
    assert.equal(body.error, 'registry file unreadable');
    const fileContentsAfterGet = readFileSync(config.registryFile, 'utf8');
    assert.equal(fileContentsAfterGet, fileContentsBefore, 'file unchanged after GET');
    const put = await registryFetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(record),
    });
    assert.equal(put.status, 500);
    const fileContentsAfterPut = readFileSync(config.registryFile, 'utf8');
    assert.equal(fileContentsAfterPut, fileContentsBefore, 'file unchanged after PUT');
  } finally {
    await stop(server);
  }
});

test('records survive a restart', async () => {
  const first = await start();
  try {
    await registryFetch(`${first.base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      headers: JSON_TYPE,
      body: JSON.stringify(record),
    });
    await stop(first.server);
    const second = await start(first.config);
    try {
      const get = await registryFetch(`${second.base}/accounts/undeployed/0a0b`);
      assert.equal(get.status, 200);
      assert.deepEqual(await get.json(), record);
    } finally {
      await stop(second.server);
    }
  } finally {
    await stop(first.server);
  }
});
