import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FaucetClientError, remoteFaucet } from '../packages/adapter-service/dist/index.js';

/** @typedef {import('../packages/account/dist/ports/index.js').FetchLike} FetchLike */

const request = {
  requestId: '12345678-1234-1234-1234-123456789abc',
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: 'ef'.repeat(32),
  accountAddress: 'ab'.repeat(32),
  color: 'cd'.repeat(32),
  amount: '10',
};
const result = { requestId: request.requestId, txId: 'tx-1', creditedBalance: '10' };

test('faucet client preserves the caller request ID and injects fresh credentials', async () => {
  let count = 0;
  /** @type {Array<{url: string, headers: Record<string, string> | undefined, body: string | undefined}>} */
  const calls = [];
  /** @type {FetchLike} */
  const fetchFn = async (url, init) => {
    calls.push({ url, headers: init?.headers, body: init?.body });
    return { ok: true, status: 200, json: async () => result };
  };
  const client = remoteFaucet('http://service/', {
    fetch: fetchFn,
    headers: async () => ({ authorization: `Bearer token-${++count}` }),
  });
  assert.deepEqual(await client.fund(request), result);
  assert.deepEqual(await client.fund(request), result);
  assert.equal(count, 2);
  assert.deepEqual(
    calls.map((call) => call.url),
    ['http://service/v1/faucet/fund', 'http://service/v1/faucet/fund'],
  );
  assert.deepEqual(
    calls.map((call) => call.headers?.authorization),
    ['Bearer token-1', 'Bearer token-2'],
  );
  const sent = calls[0];
  assert.ok(sent?.body);
  assert.deepEqual(JSON.parse(sent.body), request);
});

test('faucet client exposes policy status and refuses mismatched confirmations', async () => {
  const refused = remoteFaucet('http://service', {
    headers: async () => ({}),
    fetch: async () => ({ ok: false, status: 409, json: async () => ({ error: 'pending' }) }),
  });
  await assert.rejects(refused.fund(request), (error) => {
    assert.ok(error instanceof FaucetClientError);
    assert.equal(error.status, 409);
    assert.equal(error.message, 'pending');
    return true;
  });
  const wrong = remoteFaucet('http://service', {
    headers: async () => ({}),
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ...result, requestId: 'another' }),
    }),
  });
  await assert.rejects(wrong.fund(request), /invalid result/);
});

test('faucet client reports transport failures without changing the request', async () => {
  const client = remoteFaucet('http://service', {
    headers: async () => ({ authorization: 'Bearer token' }),
    fetch: async () => {
      throw new Error('offline');
    },
  });
  await assert.rejects(client.fund(request), (error) => {
    assert.ok(error instanceof FaucetClientError);
    assert.equal(error.status, 0);
    return true;
  });
  assert.equal(request.requestId, '12345678-1234-1234-1234-123456789abc');
});
