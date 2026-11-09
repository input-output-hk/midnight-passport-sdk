import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createServer,
  createFileFundingStore,
  fundingRoute,
  FundingPreflightError,
  inspectFileFundingStore,
} from '../packages/service/dist/index.js';

const request = {
  requestId: '12345678-1234-1234-1234-123456789abc',
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: 'ef'.repeat(32),
  accountAddress: 'ab'.repeat(32),
  color: 'cd'.repeat(32),
  amount: '10',
};

/** @param {import('node:test').TestContext} t @param {string} mode */
async function fixture(t, mode) {
  const dir = mkdtempSync(join(tmpdir(), 'funding-preflight-'));
  const file = join(dir, 'reservations.json'),
    realStore = createFileFundingStore(file);
  /** @type {string[]} */
  const logs = [];
  let calls = 0;
  const server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
    fundingRoute({
      ...request,
      assets: [{ color: request.color, maxPerRequest: 10n, maxPerUtcDay: 10n }],
      authorize: async () => true,
      eligible: async () => true,
      store:
        mode === 'release-fails'
          ? {
              ...realStore,
              releaseNoSubmit: async () => {
                throw Error('secret release');
              },
            }
          : realStore,
      backend: {
        fund: async (_request, progress) => {
          calls++;
          assert.ok(progress);
          if (mode === 'prepared')
            await progress({ stage: 'balance-observed', balanceBefore: '0' });
          if (mode === 'prepared')
            await progress({ stage: 'prepared', preparationTxId: 'ab'.repeat(32) });
          if (mode !== 'no-marker' && mode !== 'generic') await progress({ stage: 'no-submit' });
          if (mode === 'generic') throw Error('secret witness');
          const error = new FundingPreflightError('FundingAssetUnavailable');
          error.message = 'secret provider details';
          throw error;
        },
      },
      log: (message) => logs.push(message),
    }),
  ]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const bound = server.address();
  assert.ok(bound && typeof bound !== 'string');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    logs,
    file,
    calls: () => calls,
    /** @param {typeof request} [body] */
    post: (body = request) =>
      fetch(`http://127.0.0.1:${bound.port}/v1/faucet/fund`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}

test('proved preflight refusal durably tombstones the ID and frees quota without exposing the exception', async (t) => {
  const f = await fixture(t, 'refuse');
  const response = await f.post();
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    requestId: request.requestId,
    code: 'FundingAssetUnavailable',
    error: 'The funding wallet does not hold enough of this asset.',
    submission: 'not-started',
  });
  const entries = inspectFileFundingStore(f.file).entries;
  assert.ok(entries[0]);
  assert.equal(entries[0].state, 'released');
  assert.equal(entries[0].noSubmit, true);
  assert.equal((await f.post()).status, 409);
  assert.equal(f.calls(), 1, 'a tombstoned ID never executes again');
  assert.equal(
    (await f.post({ ...request, requestId: '12345678-1234-1234-1234-123456789abd' })).status,
    409,
  );
  assert.equal(f.calls(), 2, 'explicit new intent is admitted after quota release');
  assert.doesNotMatch(f.logs.join(' '), /secret/);
  assert.equal(JSON.parse(f.logs[0] ?? '{}').submission, 'not-started');
});

for (const mode of ['no-marker', 'release-fails', 'generic', 'prepared']) {
  test(`${mode} remains unknown; no replacement receipt or repeat wallet call`, async (t) => {
    const f = await fixture(t, mode);
    const response = await f.post();
    assert.equal(response.status, 502);
    const body = await response.json();
    assert.ok(body && typeof body === 'object' && !Array.isArray(body));
    assert.equal('submission' in body, false);
    assert.equal(inspectFileFundingStore(f.file).entries[0]?.state, 'pending');
    assert.equal((await f.post()).status, 409);
    assert.equal(f.calls(), 1);
    assert.doesNotMatch(JSON.stringify(body) + f.logs.join(' '), /secret/);
    assert.equal(JSON.parse(f.logs[0] ?? '{}').code, 'FundingOutcomeUnknown');
  });
}
