import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileFundingStore } from '../packages/service/dist/index.js';

const color = 'cd'.repeat(32);
const policy = { color, maxPerRequest: 20n, maxPerUtcDay: 25n };
const request = {
  requestId: '12345678-1234-1234-1234-123456789abc',
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: 'ef'.repeat(32),
  accountAddress: 'ab'.repeat(32),
  color,
  amount: '10',
};
const result = { requestId: request.requestId, txId: 'tx-1', creditedBalance: '10' };
const file = () => join(mkdtempSync(join(tmpdir(), 'passport-funding-')), 'reservations.json');

test('reservations and confirmed results survive a store restart', async () => {
  const path = file();
  const first = createFileFundingStore(path);
  assert.deepEqual(await first.reserve(request, policy, '2026-10-15'), { state: 'reserved' });
  assert.deepEqual(await createFileFundingStore(path).reserve(request, policy, '2026-10-15'), {
    state: 'pending',
  });
  await first.complete(request.requestId, result);
  assert.deepEqual(await createFileFundingStore(path).reserve(request, policy, '2026-10-16'), {
    state: 'complete',
    result,
  });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, 1);
});

test('daily cap includes pending reservations and request IDs cannot be repurposed', async () => {
  const path = file();
  const first = createFileFundingStore(path);
  const second = createFileFundingStore(path);
  assert.deepEqual(await first.reserve(request, policy, '2026-10-15'), { state: 'reserved' });
  assert.deepEqual(await second.reserve({ ...request, amount: '11' }, policy, '2026-10-15'), {
    state: 'conflict',
  });
  const next = { ...request, requestId: '12345678-1234-1234-1234-123456789abd' };
  assert.deepEqual(await second.reserve({ ...next, amount: '16' }, policy, '2026-10-15'), {
    state: 'daily-limit',
  });
  assert.deepEqual(await second.reserve({ ...next, amount: '15' }, policy, '2026-10-15'), {
    state: 'reserved',
  });
  assert.deepEqual(await first.reserve({ ...next, amount: '15' }, policy, '2026-10-15'), {
    state: 'pending',
  });
});

test('a stale lock or corrupt reservation file fails closed', async () => {
  const path = file();
  const store = createFileFundingStore(path);
  mkdirSync(`${path}.lock`);
  await assert.rejects(store.reserve(request, policy, '2026-10-15'));
  const other = file();
  writeFileSync(other, '{"version":1,"requests":{"bad":{"day":"2026-10-15"}}}');
  await assert.rejects(createFileFundingStore(other).reserve(request, policy, '2026-10-15'));
});

test('a result cannot replace an earlier confirmation', async () => {
  const store = createFileFundingStore(file());
  await store.reserve(request, policy, '2026-10-15');
  await store.complete(request.requestId, result);
  await store.complete(request.requestId, result);
  await assert.rejects(store.complete(request.requestId, { ...result, txId: 'tx-2' }));
});
