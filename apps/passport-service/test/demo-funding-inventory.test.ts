import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer as httpServer } from 'node:http';
import {
  availableDemoAssets,
  preflightRefusal,
  demoAssets,
} from '../src/routes/demo-funding-inventory.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('demo policy uses the same64 asset bound as discovery and funding startup', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'demo-assets-bound-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'assets.json');
  const rows = Array.from({ length: 65 }, (_, i) => ({
    color: (i + 1).toString(16).padStart(64, '0'),
    maxPerRequest: '10',
  }));
  writeFileSync(file, JSON.stringify(rows.slice(0, 64)));
  assert.equal(demoAssets(file).assets.length, 64);
  writeFileSync(file, JSON.stringify(rows));
  assert.throws(() => demoAssets(file), /asset policy/);
});

test('demo inventory checks pins, exact policy membership and amounts, failing closed without losing the asset list', async (t) => {
  const config = {
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    manifestSha256: 'ab'.repeat(32),
  };
  const assets = [{ color: '00'.repeat(32), amount: '10' }];
  let body: unknown = { ...config, assets: [{ ...assets[0], availability: 'available' }] };
  const server = httpServer((req, res) => {
    assert.equal(req.headers.authorization, 'Bearer synthetic');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const bound = server.address();
  assert.ok(bound && typeof bound !== 'string');
  const url = new URL(`http://127.0.0.1:${bound.port}`);
  const read = () => availableDemoAssets(config, url, 'synthetic', assets);
  assert.equal((await read())[0]?.availability, 'available');
  for (const bad of [
    null,
    { ...config, networkId: 'other', assets: [{ ...assets[0], availability: 'available' }] },
    { ...config, assets: [] },
    { ...config, assets: [{ ...assets[0], amount: '1', availability: 'available' }] },
    { ...config, assets: [null] },
    { ...config, assets: [{ ...assets[0], availability: 'yes' }] },
  ]) {
    body = bad;
    assert.deepEqual(await read(), [{ ...assets[0], availability: 'unavailable' }]);
  }
});
test('proxy refuses to forward a no-start receipt with a different identity or transaction marker', () => {
  const body = {
    requestId: 'original',
    code: 'FundingAssetUnavailable',
    submission: 'not-started',
    error: 'private details',
  };
  assert.doesNotMatch(JSON.stringify(preflightRefusal(body, 'original')), /private details/);
  for (const bad of [
    { ...body, requestId: 'other' },
    { ...body, txId: 'ab'.repeat(32) },
    { ...body, preparationTxId: 'ab'.repeat(32) },
    { ...body, code: 'other' },
  ])
    assert.equal(preflightRefusal(bad, 'original'), undefined);
});

test('discovery observes a successful five-second wallet catch-up plus transport delay', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), milliseconds);
    return controller.signal;
  });
  const config = {
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    manifestSha256: 'ab'.repeat(32),
  };
  const assets = [{ color: '00'.repeat(32), amount: '10' }];
  const expected = [{ ...assets[0], availability: 'available' }];
  const transport = t.mock.method(
    globalThis,
    'fetch',
    (_input: unknown, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal;
        assert.ok(signal);
        const abort = () => reject(new Error('Observation timed out'));
        signal.addEventListener('abort', abort, { once: true });
        setTimeout(() => {
          signal.removeEventListener('abort', abort);
          resolve(Response.json({ ...config, assets: expected }));
        }, 5100);
      }),
  );
  const pending = availableDemoAssets(config, new URL('http://127.0.0.1'), 'synthetic', assets);
  t.mock.timers.tick(5100);
  assert.deepEqual(await pending, expected);
  assert.equal(transport.mock.callCount(), 1);
});
