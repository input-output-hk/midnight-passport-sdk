import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFileFundingStore,
  createServer,
  fundingRoute,
  inspectFileFundingStore,
} from '../packages/service/dist/index.js';

/** @typedef {import('../packages/protocol/dist/index.js').ServiceWire.FundAccRequest} FundAccRequest */
/** @typedef {import('../packages/protocol/dist/index.js').ServiceWire.FundAccResponse} FundAccResponse */
/** @typedef {import('../packages/service/dist/index.js').FundingStore} FundingStore */
/** @typedef {import('../packages/service/dist/index.js').FundingProgress} FundingProgress */

const address = 'ab'.repeat(32);
const color = 'cd'.repeat(32);
const manifestSha256 = 'ef'.repeat(32);
const request = {
  requestId: '12345678-1234-1234-1234-123456789abc',
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256,
  accountAddress: address,
  color,
  amount: '10',
};

/** @returns {FundingStore} */
function memoryStore() {
  /** @type {Map<string, {input: FundAccRequest, result?: FundAccResponse}>} */
  const requests = new Map();
  /** @type {Map<string, bigint>} */
  const spend = new Map();
  return {
    async reserve(input, policy, day) {
      const old = requests.get(input.requestId);
      if (old) {
        if (JSON.stringify(old.input) !== JSON.stringify(input)) return { state: 'conflict' };
        return old.result ? { state: 'complete', result: old.result } : { state: 'pending' };
      }
      const key = `${day}/${input.color}`;
      const total = spend.get(key) ?? 0n;
      if (total + BigInt(input.amount) > policy.maxPerUtcDay) return { state: 'daily-limit' };
      spend.set(key, total + BigInt(input.amount));
      requests.set(input.requestId, { input });
      return { state: 'reserved' };
    },
    async complete(id, result) {
      const old = requests.get(id);
      assert.ok(old);
      old.result = result;
    },
    async recordProgress() {},
    async releaseNoSubmit() {},
  };
}

/**
 * @param {{authorize?: (request: import('node:http').IncomingMessage) => Promise<boolean>, eligible?: (address: string) => Promise<boolean>, fund?: (request: FundAccRequest, recordProgress?: (progress: import('../packages/service/dist/index.js').FundingProgress) => Promise<void>) => Promise<FundAccResponse>, store?: FundingStore}} [options]
 */
async function serve({
  authorize = async () => true,
  eligible = async () => true,
  fund,
  store,
} = {}) {
  /** @type {FundAccRequest[]} */
  const calls = [];
  const backend = {
    /** @param {FundAccRequest} input @param {((progress: FundingProgress) => Promise<void>) | undefined} recordProgress */
    async fund(input, recordProgress) {
      calls.push(input);
      if (fund) return fund(input, recordProgress);
      return { requestId: input.requestId, txId: 'tx-1', creditedBalance: input.amount };
    },
  };
  const server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
    fundingRoute({
      networkId: request.networkId,
      bindingId: request.bindingId,
      manifestSha256,
      assets: [{ color, maxPerRequest: 20n, maxPerUtcDay: 25n }],
      authorize,
      eligible,
      store: store ?? memoryStore(),
      backend,
      now: () => new Date('2026-10-15T12:00:00Z'),
      log: () => {},
    }),
  ]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const bound = server.address();
  assert.ok(bound && typeof bound !== 'string');
  return {
    calls,
    close: () => new Promise((resolve) => server.close(resolve)),
    /** @param {FundAccRequest} [body] */
    post: (body = request) =>
      fetch(`http://127.0.0.1:${bound.port}/v1/faucet/fund`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}

test('funding is authenticated, pinned, bounded and idempotent', async (t) => {
  const svc = await serve();
  t.after(svc.close);
  const first = await svc.post();
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), {
    requestId: request.requestId,
    txId: 'tx-1',
    creditedBalance: '10',
  });
  assert.equal((await svc.post()).status, 200);
  assert.equal(svc.calls.length, 1);
  assert.equal((await svc.post({ ...request, amount: '11' })).status, 409);
  assert.equal(
    (
      await svc.post({
        ...request,
        requestId: '12345678-1234-1234-1234-123456789abd',
        amount: '16',
      })
    ).status,
    429,
  );
  assert.equal(svc.calls.length, 1);
});

test('funding rejects bad pins, unsupported assets, amounts and ACCs before reserve', async (t) => {
  const svc = await serve({ eligible: async (account) => account === address });
  t.after(svc.close);
  /** @type {Array<[FundAccRequest, number]>} */
  const cases = [
    [{ ...request, networkId: 'testnet' }, 409],
    [{ ...request, bindingId: 'other' }, 409],
    [{ ...request, manifestSha256: '00'.repeat(32) }, 409],
    [{ ...request, color: 'aa'.repeat(32) }, 400],
    [{ ...request, amount: '0' }, 400],
    [{ ...request, amount: '21' }, 400],
    [{ ...request, accountAddress: '00'.repeat(32) }, 403],
  ];
  for (const [body, status] of cases) assert.equal((await svc.post(body)).status, status);
  assert.equal(svc.calls.length, 0);
});

test('unauthorized requests cannot invoke the wallet', async (t) => {
  const svc = await serve({ authorize: async () => false });
  t.after(svc.close);
  assert.equal((await svc.post()).status, 403);
  assert.equal(svc.calls.length, 0);
});

test('a failed wallet call leaves a pending reservation and cannot pay twice', async (t) => {
  const svc = await serve({
    fund: async () => {
      throw new Error('wallet failed');
    },
  });
  t.after(svc.close);
  assert.equal((await svc.post()).status, 502);
  assert.equal((await svc.post()).status, 409);
  assert.equal(svc.calls.length, 1);
});

test('a submitted but unconfirmed deposit leaves durable progress for inspection', async (t) => {
  const path = join(mkdtempSync(join(tmpdir(), 'passport-funding-route-')), 'reservations.json');
  const svc = await serve({
    store: createFileFundingStore(path),
    fund: async (_input, recordProgress) => {
      if (!recordProgress) throw new Error('route did not provide progress journaling');
      await recordProgress({ stage: 'balance-observed', balanceBefore: '2' });
      await recordProgress({ stage: 'submitted', txId: 'ab'.repeat(32) });
      throw new Error('confirmation timed out');
    },
  });
  t.after(svc.close);
  assert.equal((await svc.post()).status, 502);
  assert.equal((await svc.post()).status, 409);
  assert.equal(svc.calls.length, 1);
  assert.deepEqual(inspectFileFundingStore(path).entries[0]?.progress, {
    balanceBefore: '2',
    depositTxId: 'ab'.repeat(32),
  });
});

test('concurrent requests with one ID invoke the wallet once', async (t) => {
  let release = () => {};
  const wait = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  const svc = await serve({
    fund: async (input) => {
      await wait;
      return { requestId: input.requestId, txId: 'tx-1', creditedBalance: input.amount };
    },
  });
  t.after(svc.close);
  const first = svc.post();
  while (svc.calls.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal((await svc.post()).status, 409);
  release();
  assert.equal((await first).status, 200);
  assert.equal(svc.calls.length, 1);
});
