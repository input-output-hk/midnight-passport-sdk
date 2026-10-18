import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  submitQualificationFunding,
  waitForFundingReady,
} from '../scripts/rc-qualification-http.mjs';
const request = {
  requestId: '66f3b3f0-911a-4d3b-a16f-c41caace9c7b',
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: 'ab'.repeat(32),
  accountAddress: 'cd'.repeat(32),
  color: '00'.repeat(32),
  amount: '10',
};
test('qualification preserves status for non-JSON HTTP errors without retaining raw bodies', async () => {
  /** @type {Array<{outcome: string, httpStatus?: number}>} */
  const attempts = [];
  await assert.rejects(
    submitQualificationFunding({
      base: 'http://localhost',
      headers: {},
      request,
      onAttempt: (e) => attempts.push(e),
      fetcher: async () => new Response('<private proxy details>', { status: 504 }),
    }),
    /HTTP 504/,
  );
  assert.deepEqual(attempts, [{ outcome: 'started' }, { outcome: 'http-error', httpStatus: 504 }]);
});
test('qualification records uncertainty for transport and malformed success responses', async () => {
  for (const fetcher of [
    async () => {
      throw new Error('socket');
    },
    async () => new Response('bad-json', { status: 200 }),
  ]) {
    /** @type {Array<{outcome: string, httpStatus?: number}>} */
    const attempts = [];
    await assert.rejects(
      submitQualificationFunding({
        base: 'http://localhost',
        headers: {},
        request,
        onAttempt: (e) => attempts.push(e),
        fetcher,
      }),
      /outcome uncertain/,
    );
    assert.equal(attempts.length, 2);
    assert.notEqual(attempts[1]?.outcome, 'response-received');
  }
});
test('qualification persists only the public success fields', async () => {
  const txId = '00'.repeat(33);
  /** @type {Array<{outcome: string, httpStatus?: number}>} */
  const attempts = [];
  const body = await submitQualificationFunding({
    base: 'http://localhost',
    headers: {},
    request,
    onAttempt: (e) => attempts.push(e),
    fetcher: async () =>
      Response.json({
        requestId: request.requestId,
        txId,
        creditedBalance: '10',
        debugPrivate: 'omit',
      }),
  });
  assert.deepEqual(body, { requestId: request.requestId, txId, creditedBalance: '10' });
  assert.equal(attempts[1]?.outcome, 'response-received');
});
test('readiness retries transient and non-ready responses, but refuses a mismatched ready binding', async () => {
  let calls = 0;
  await waitForFundingReady('http://localhost', request.manifestSha256, {
    pause: async () => {},
    fetcher: async () =>
      ++calls === 1
        ? new Response('', { status: 503 })
        : Response.json(
            calls === 2
              ? { status: 'verifying' }
              : {
                  status: 'ready',
                  networkId: 'undeployed',
                  bindingId: 'acc-s3r1.1',
                  manifestSha256: request.manifestSha256,
                },
          ),
  });
  assert.equal(calls, 3);
  await assert.rejects(
    waitForFundingReady('http://localhost', request.manifestSha256, {
      fetcher: async () =>
        Response.json({
          status: 'ready',
          networkId: 'testnet',
          bindingId: 'acc-s3r1.1',
          manifestSha256: request.manifestSha256,
        }),
    }),
    /mismatch/,
  );
});

test('qualification token and existing-evidence preflights happen before any service request', async (t) => {
  const { createServer } = await import('node:http');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const run = promisify(execFile);
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(500).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const dir = mkdtempSync(join(tmpdir(), 'passport-qualification-preflight-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const evidence = join(dir, 'result.json');
  const token = join(dir, 'token');
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    PASSPORT_RC_LOCALNET: '1',
    MN_NETWORK_ID: 'undeployed',
    PASSPORT_SERVICE_URL: `http://127.0.0.1:${address.port}`,
    PASSPORT_FUNDING_URL: `http://127.0.0.1:${address.port}`,
    PASSPORT_RC_EVIDENCE: evidence,
  };
  delete env.PASSPORT_FUNDING_TOKEN_FILE;
  const script = fileURLToPath(new URL('../scripts/qualify-rc-localnet.mjs', import.meta.url));
  await assert.rejects(run(process.execPath, [script], { env }), (error) => {
    assert.ok(
      error &&
        typeof error === 'object' &&
        'stderr' in error &&
        String(error.stderr).includes('set PASSPORT_FUNDING_TOKEN_FILE'),
    );
    return true;
  });
  writeFileSync(token, 'a'.repeat(64));
  writeFileSync(evidence, 'previous-receipt');
  await assert.rejects(
    run(process.execPath, [script], { env: { ...env, PASSPORT_FUNDING_TOKEN_FILE: token } }),
    (error) => {
      assert.ok(
        error &&
          typeof error === 'object' &&
          'stderr' in error &&
          String(error.stderr).includes('evidence already exists'),
      );
      return true;
    },
  );
  assert.equal(readFileSync(evidence, 'utf8'), 'previous-receipt');
  assert.equal(requests, 0);
});
