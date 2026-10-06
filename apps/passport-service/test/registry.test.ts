import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
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
  status: 'deployed' as const,
};

async function start(config = testConfig()) {
  const server = createServer(config, [registryRoute(config)]);
  await new Promise<void>((r) => server.listen(0, r));
  return { base: `http://localhost:${(server.address() as AddressInfo).port}`, server, config };
}

test('malformed ids or bodies are refused with 400', async (t) => {
  const { base, server } = await start();
  try {
    assert.equal(
      (
        await fetch(`${base}/accounts/undeployed/zz`, {
          method: 'PUT',
          body: JSON.stringify(record),
        })
      ).status,
      400,
      'non-hex credential ID',
    );
    assert.equal(
      (
        await fetch(`${base}/accounts/undeployed/0a0b`, {
          method: 'PUT',
          body: JSON.stringify({ ...record, credentialId: '0c' }),
        })
      ).status,
      400,
      'credential ID mismatch',
    );
    assert.equal(
      (
        await fetch(`${base}/accounts/undeployed/0a0b`, {
          method: 'PUT',
          body: JSON.stringify({ ...record, status: 'x' }),
        })
      ).status,
      400,
      'invalid status',
    );
    assert.equal(
      (
        await fetch(`${base}/accounts/undeployed/0a0`, {
          method: 'PUT',
          body: JSON.stringify({ ...record, credentialId: '0a0' }),
        })
      ).status,
      400,
      'odd-length credential ID in PUT',
    );
    assert.equal(
      (await fetch(`${base}/accounts/undeployed/0a0`)).status,
      400,
      'odd-length credential ID in GET',
    );
  } finally {
    server.close();
  }
});

test('identical deployed re-PUT returns 204', async (t) => {
  const { base, server, config } = await start();
  try {
    const put1 = await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
    assert.equal(put1.status, 204);
    const put2 = await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
    assert.equal(put2.status, 204);
    const get = await fetch(`${base}/accounts/undeployed/0a0b`);
    assert.equal(get.status, 200);
    assert.deepEqual(await get.json(), record);
  } finally {
    server.close();
  }
});

test('deployed to active transition returns 204 and updates status', async (t) => {
  const { base, server, config } = await start();
  try {
    await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
    const transitioned = { ...record, status: 'active' as const };
    const put2 = await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(transitioned),
    });
    assert.equal(put2.status, 204);
    const get = await fetch(`${base}/accounts/undeployed/0a0b`);
    assert.equal(get.status, 200);
    const retrieved = await get.json();
    assert.equal(retrieved.status, 'active');
  } finally {
    server.close();
  }
});

test('identical active re-PUT returns 204', async (t) => {
  const { base, server, config } = await start();
  try {
    const activeRecord = { ...record, status: 'active' as const };
    await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(activeRecord),
    });
    const put2 = await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(activeRecord),
    });
    assert.equal(put2.status, 204);
  } finally {
    server.close();
  }
});

test('active to deployed transition returns 409 and record stays active', async (t) => {
  const { base, server, config } = await start();
  try {
    const activeRecord = { ...record, status: 'active' as const };
    await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(activeRecord),
    });
    const transition = { ...record, status: 'deployed' as const };
    const put2 = await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(transition),
    });
    assert.equal(put2.status, 409);
    const get = await fetch(`${base}/accounts/undeployed/0a0b`);
    const retrieved = await get.json();
    assert.equal(retrieved.status, 'active', 'record should remain active');
  } finally {
    server.close();
  }
});

test('different address over existing record returns 409 and GET is unchanged', async (t) => {
  const { base, server, config } = await start();
  try {
    await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
    const changed = { ...record, address: 'cd'.repeat(32) };
    const put2 = await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(changed),
    });
    assert.equal(put2.status, 409);
    const get = await fetch(`${base}/accounts/undeployed/0a0b`);
    const retrieved = await get.json();
    assert.equal(retrieved.address, record.address, 'original address should be unchanged');
  } finally {
    server.close();
  }
});

test('different salt over existing record returns 409', async (t) => {
  const { base, server, config } = await start();
  try {
    await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
    const changed = { ...record, salt: '05'.repeat(32) };
    const put2 = await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(changed),
    });
    assert.equal(put2.status, 409);
  } finally {
    server.close();
  }
});

test('deployed to active with changed salt returns 409', async (t) => {
  const { base, server, config } = await start();
  try {
    await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
    const changed = { ...record, status: 'active' as const, salt: '05'.repeat(32) };
    const put2 = await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(changed),
    });
    assert.equal(put2.status, 409);
  } finally {
    server.close();
  }
});

test('same credential on testnet returns 204, with undeployed untouched', async (t) => {
  const { base, server, config } = await start();
  try {
    await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
    const putTestnet = await fetch(`${base}/accounts/testnet/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
    assert.equal(putTestnet.status, 204);
    const get1 = await fetch(`${base}/accounts/undeployed/0a0b`);
    const get2 = await fetch(`${base}/accounts/testnet/0a0b`);
    assert.equal(get1.status, 200);
    assert.equal(get2.status, 200);
    assert.deepEqual(await get1.json(), record);
    assert.deepEqual(await get2.json(), record);
  } finally {
    server.close();
  }
});

test('identical record with different key order returns 204', async (t) => {
  const { base, server, config } = await start();
  try {
    await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
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
    const put2 = await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(reordered),
    });
    assert.equal(put2.status, 204);
  } finally {
    server.close();
  }
});

test('409 persists after a restart', async (t) => {
  const first = await start();
  try {
    await fetch(`${first.base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
    first.server.close();
    const second = await start(first.config);
    try {
      const changed = { ...record, address: 'cd'.repeat(32) };
      const put2 = await fetch(`${second.base}/accounts/undeployed/0a0b`, {
        method: 'PUT',
        body: JSON.stringify(changed),
      });
      assert.equal(put2.status, 409);
    } finally {
      second.server.close();
    }
  } finally {
    first.server.close();
  }
});

test('corrupt registry file returns 500, excludes file contents, and leaves file unchanged', async (t) => {
  const config = testConfig();
  const corruptContent = 'not valid json';
  writeFileSync(config.registryFile, corruptContent);
  const fileContentsBefore = readFileSync(config.registryFile, 'utf8');
  const { base, server } = await start(config);
  try {
    const get = await fetch(`${base}/accounts/undeployed/0a0b`);
    assert.equal(get.status, 500);
    const body = await get.json();
    assert.equal(body.error, 'registry file unreadable');
    const fileContentsAfterGet = readFileSync(config.registryFile, 'utf8');
    assert.equal(fileContentsAfterGet, fileContentsBefore, 'file unchanged after GET');
    const put = await fetch(`${base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
    assert.equal(put.status, 500);
    const fileContentsAfterPut = readFileSync(config.registryFile, 'utf8');
    assert.equal(fileContentsAfterPut, fileContentsBefore, 'file unchanged after PUT');
  } finally {
    server.close();
  }
});

test('records survive a restart', async (t) => {
  const first = await start();
  try {
    await fetch(`${first.base}/accounts/undeployed/0a0b`, {
      method: 'PUT',
      body: JSON.stringify(record),
    });
    first.server.close();
    const second = await start(first.config);
    try {
      const get = await fetch(`${second.base}/accounts/undeployed/0a0b`);
      assert.equal(get.status, 200);
      assert.deepEqual(await get.json(), record);
    } finally {
      second.server.close();
    }
  } finally {
    first.server.close();
  }
});
