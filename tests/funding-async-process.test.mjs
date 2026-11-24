import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createFileFundingStore, inspectFileFundingStore } from '../packages/service/dist/index.js';

const request = {
  requestId: '12345678-1234-1234-1234-123456789abc',
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: 'ef'.repeat(32),
  accountAddress: 'ab'.repeat(32),
  color: '00'.repeat(32),
  amount: '10',
};

/** @typedef {{ requestId: string, accountAddress: string, color: string, amount: string, state: string, progress?: { balanceBefore: string, preparationTxId?: string, depositTxId?: string, phase?: string, phaseStartedAt?: string }, result?: { requestId: string, txId: string, preparationTxId?: string, creditedBalance: string } }} FundingStatus */

/** @param {'hold' | 'hold-after-submit' | 'slow-proof' | 'reopen' | 'proof-fail' | 'unknown-submit' | 'credit'} mode @param {string} root */
async function childServer(mode, root) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL('./fixtures/funding-async-process.mjs', import.meta.url)), mode, root],
    { env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const exited = new Promise((resolve) => child.once('close', resolve));
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const ready = new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const line = output.split('\n')[0];
      if (line) {
        try {
          resolve(JSON.parse(line).port);
        } catch (error) {
          reject(error);
        }
      }
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`funding fixture exited before ready: ${stderr}`)));
  });
  const port = await ready;
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
  };
  return { port, close };
}

for (const mode of /** @type {const} */ (['hold', 'hold-after-submit']))
  test(
    `a killed async funding worker at ${mode} leaves one observable original and cannot redispatch`,
    { timeout: 15000 },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), 'passport-funding-process-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      const first = await childServer(mode, root);
      t.after(first.close);
      let upstreamStatus;
      const proxy = createServer((incoming, outgoing) => {
        const upstream = httpRequest(
          {
            hostname: '127.0.0.1',
            port: first.port,
            method: incoming.method,
            path: incoming.url,
            headers: { ...incoming.headers, host: `127.0.0.1:${first.port}` },
          },
          (response) => {
            upstreamStatus = response.statusCode;
            response.resume();
            outgoing.destroy(); // The browser never observes the accepted original.
          },
        );
        upstream.on('error', () => outgoing.destroy());
        incoming.pipe(upstream);
      });
      await new Promise((resolve) => proxy.listen(0, '127.0.0.1', () => resolve(undefined)));
      const proxyAddress = proxy.address();
      assert.ok(proxyAddress && typeof proxyAddress !== 'string');
      t.after(() => new Promise((resolve) => proxy.close(resolve)));
      await assert.rejects(
        fetch(`http://127.0.0.1:${proxyAddress.port}/v1/faucet/fund`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', prefer: 'respond-async' },
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(5000),
        }),
      );
      assert.equal(upstreamStatus, 202);
      await assert.doesNotReject(async () => {
        for (let attempt = 0; attempt < 40; attempt++) {
          try {
            assert.equal((await stat(join(root, 'started'))).isFile(), true);
            return;
          } catch (error) {
            if (attempt === 39) throw error;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        }
      });
      await first.close();
      const second = await childServer('reopen', root);
      t.after(second.close);
      const reopened = `http://127.0.0.1:${second.port}/v1/faucet/fund`;
      const status = await fetch(
        `${reopened}/${request.requestId}?accountAddress=${request.accountAddress}`,
      );
      assert.equal(status.status, 200);
      const observed = /** @type {FundingStatus} */ (await status.json());
      assert.match(observed.progress?.phaseStartedAt ?? '', /^\d{4}-\d\d-\d\dT/);
      assert.deepEqual(observed, {
        requestId: request.requestId,
        accountAddress: request.accountAddress,
        color: request.color,
        amount: request.amount,
        state: 'pending',
        progress: {
          balanceBefore: '0',
          preparationTxId: 'fixture-wallet-preparation',
          phase: mode === 'hold' ? 'acc-proof' : 'acc-submitted',
          phaseStartedAt: observed.progress?.phaseStartedAt,
          ...(mode === 'hold-after-submit' && { depositTxId: 'fixture-acc-deposit' }),
        },
      });
      const replay = await fetch(reopened, {
        method: 'POST',
        headers: { 'content-type': 'application/json', prefer: 'respond-async' },
        body: JSON.stringify(request),
      });
      assert.equal(replay.status, 409);
      assert.equal(await readFile(join(root, 'dispatches'), 'utf8'), `${request.requestId}\n`);
      if (mode === 'hold-after-submit')
        assert.equal(
          await readFile(join(root, 'acc-submissions'), 'utf8'),
          `${request.requestId}\n`,
        );
      else await assert.rejects(readFile(join(root, 'acc-submissions')), { code: 'ENOENT' });
    },
  );

/** @param {string} base @param {string} id */
async function observe(base, id) {
  const response = await fetch(`${base}/${id}?accountAddress=${request.accountAddress}`);
  assert.equal(response.status, 200);
  return /** @type {FundingStatus} */ (await response.json());
}

/** @param {string} base @param {typeof request} body */
async function postFunding(base, body) {
  return fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json', prefer: 'respond-async' },
    body: JSON.stringify(body),
  });
}

/** @param {string} base @param {string} id @param {string} state */
async function waitForState(base, id, state) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const result = await observe(base, id);
    if (result.state === state) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`funding fixture did not reach ${state}`);
}

/** @param {string} path @param {string} expected */
async function waitForFile(path, expected) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      if ((await readFile(path, 'utf8')) === expected) return;
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      )
        throw error;
    }
    if (attempt === 79) throw new Error(`fixture did not record ${expected.trim()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test(
  'a long ACC proof outlives the client wait, then completes under one original without a quota escape',
  { timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'passport-funding-slow-proof-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const first = await childServer('slow-proof', root);
    t.after(first.close);
    const base = `http://127.0.0.1:${first.port}/v1/faucet/fund`;
    assert.equal((await postFunding(base, request)).status, 202);
    await waitForFile(join(root, 'started'), '1');
    const pending = await observe(base, request.requestId);
    assert.equal(pending.state, 'pending');
    assert.equal(pending.progress?.phase, 'acc-proof');
    assert.equal(pending.progress?.preparationTxId, 'fixture-wallet-preparation');
    const clientWait = AbortSignal.timeout(150); // A compressed browser wait window.
    await assert.rejects(
      async () => {
        for (;;) {
          clientWait.throwIfAborted();
          if ((await observe(base, request.requestId)).state === 'complete') return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      },
      { name: 'TimeoutError' },
    );
    assert.equal((await observe(base, request.requestId)).state, 'pending');
    assert.equal((await postFunding(base, request)).status, 409);
    assert.equal(
      (
        await postFunding(base, {
          ...request,
          requestId: '22345678-1234-1234-1234-123456789abc',
          amount: '20',
        })
      ).status,
      429,
    );
    await writeFile(join(root, 'release-proof'), '1');
    const complete = await waitForState(base, request.requestId, 'complete');
    assert.equal(complete.result?.txId, 'fixture-acc-deposit');
    assert.equal(complete.result?.creditedBalance, '10');
    assert.equal((await postFunding(base, request)).status, 200);
    assert.equal(await readFile(join(root, 'dispatches'), 'utf8'), `${request.requestId}\n`);
    assert.equal(await readFile(join(root, 'acc-submissions'), 'utf8'), `${request.requestId}\n`);
    await first.close();
    const second = await childServer('reopen', root);
    t.after(second.close);
    const reopened = `http://127.0.0.1:${second.port}/v1/faucet/fund`;
    assert.deepEqual(await observe(reopened, request.requestId), complete);
    assert.equal((await postFunding(reopened, request)).status, 200);
    assert.equal(await readFile(join(root, 'dispatches'), 'utf8'), `${request.requestId}\n`);
  },
);

test(
  'operator release of a guarded proof wins the final fence and prevents the live worker from submitting',
  { timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'passport-funding-guard-release-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const first = await childServer('slow-proof', root);
    t.after(first.close);
    const base = `http://127.0.0.1:${first.port}/v1/faucet/fund`;
    assert.equal((await postFunding(base, request)).status, 202);
    await waitForFile(join(root, 'started'), '1');
    const file = join(root, 'reservations.json');
    assert.equal(inspectFileFundingStore(file).entries[0]?.accSubmitGuard, true);
    const store = createFileFundingStore(file);
    assert.ok(store.releaseGuardedPreSubmit);
    await store.releaseGuardedPreSubmit(request.requestId, 'operator');
    await writeFile(join(root, 'release-proof'), '1');
    await waitForFile(join(root, 'outcome-unknown'), '1');
    assert.equal((await observe(base, request.requestId)).state, 'released');
    await assert.rejects(readFile(join(root, 'acc-submissions')), { code: 'ENOENT' });
    await first.close();
    const second = await childServer('reopen', root);
    t.after(second.close);
    const reopened = `http://127.0.0.1:${second.port}/v1/faucet/fund`;
    assert.equal((await postFunding(reopened, request)).status, 409);
    assert.equal(
      (
        await postFunding(reopened, {
          ...request,
          requestId: '22345678-1234-1234-1234-123456789abc',
          amount: '20',
        })
      ).status,
      202,
    );
    assert.equal(await readFile(join(root, 'dispatches'), 'utf8'), `${request.requestId}\n`);
  },
);

test(
  'pre-submit proof failure releases only its marked original and restores daily capacity',
  { timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'passport-funding-proof-fail-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const first = await childServer('proof-fail', root);
    t.after(first.close);
    const base = `http://127.0.0.1:${first.port}/v1/faucet/fund`;
    assert.equal((await postFunding(base, request)).status, 202);
    const released = await waitForState(base, request.requestId, 'released');
    assert.deepEqual(released.progress, {
      balanceBefore: '0',
      preparationTxId: 'fixture-wallet-preparation',
      phase: 'acc-proof',
      phaseStartedAt: released.progress?.phaseStartedAt,
    });
    assert.match(released.progress?.phaseStartedAt ?? '', /^\d{4}-\d\d-\d\dT/);
    assert.equal(await readFile(join(root, 'dispatches'), 'utf8'), `${request.requestId}\n`);
    await assert.rejects(readFile(join(root, 'acc-submissions')), { code: 'ENOENT' });
    await first.close();
    const second = await childServer('reopen', root);
    t.after(second.close);
    const reopened = `http://127.0.0.1:${second.port}/v1/faucet/fund`;
    assert.equal((await postFunding(reopened, request)).status, 409);
    assert.equal((await observe(reopened, request.requestId)).state, 'released');
    assert.equal(
      (
        await postFunding(reopened, {
          ...request,
          requestId: '22345678-1234-1234-1234-123456789abc',
          amount: '20',
        })
      ).status,
      202,
    );
    assert.equal(await readFile(join(root, 'dispatches'), 'utf8'), `${request.requestId}\n`);
  },
);

test(
  'lost node response keeps exact submit ID pending and consumes daily capacity across restart',
  { timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'passport-funding-unknown-submit-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const first = await childServer('unknown-submit', root);
    t.after(first.close);
    const base = `http://127.0.0.1:${first.port}/v1/faucet/fund`;
    assert.equal((await postFunding(base, request)).status, 202);
    for (let attempt = 0; attempt < 80; attempt++) {
      const result = await observe(base, request.requestId);
      if (result.progress?.depositTxId) {
        assert.equal(result.state, 'pending');
        assert.equal(result.progress.depositTxId, 'fixture-acc-deposit');
        break;
      }
      if (attempt === 79) throw new Error('missing durable submit ID');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await waitForFile(join(root, 'acc-submissions'), `${request.requestId}\n`);
    await waitForFile(join(root, 'outcome-unknown'), '1');
    await first.close();
    const second = await childServer('reopen', root);
    t.after(second.close);
    const reopened = `http://127.0.0.1:${second.port}/v1/faucet/fund`;
    assert.equal((await postFunding(reopened, request)).status, 409);
    const pending = await observe(reopened, request.requestId);
    assert.deepEqual(pending.progress, {
      balanceBefore: '0',
      preparationTxId: 'fixture-wallet-preparation',
      depositTxId: 'fixture-acc-deposit',
      phase: 'acc-submitted',
      phaseStartedAt: pending.progress?.phaseStartedAt,
    });
    assert.match(pending.progress?.phaseStartedAt ?? '', /^\d{4}-\d\d-\d\dT/);
    assert.equal(
      (
        await postFunding(reopened, {
          ...request,
          requestId: '22345678-1234-1234-1234-123456789abc',
          amount: '20',
        })
      ).status,
      429,
    );
    assert.equal(await readFile(join(root, 'dispatches'), 'utf8'), `${request.requestId}\n`);
    assert.equal(await readFile(join(root, 'acc-submissions'), 'utf8'), `${request.requestId}\n`);
  },
);

test(
  'recorded credit result survives restart and same-ID POST returns it without redispatch',
  { timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'passport-funding-credit-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const first = await childServer('credit', root);
    t.after(first.close);
    const base = `http://127.0.0.1:${first.port}/v1/faucet/fund`;
    assert.equal((await postFunding(base, request)).status, 202);
    const complete = await waitForState(base, request.requestId, 'complete');
    assert.ok(complete.result);
    assert.equal(complete.result.txId, 'fixture-acc-deposit');
    await first.close();
    const second = await childServer('reopen', root);
    t.after(second.close);
    const reopened = `http://127.0.0.1:${second.port}/v1/faucet/fund`;
    assert.deepEqual(await observe(reopened, request.requestId), complete);
    const replay = await postFunding(reopened, request);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), complete.result);
    assert.equal(await readFile(join(root, 'dispatches'), 'utf8'), `${request.requestId}\n`);
    assert.equal(await readFile(join(root, 'acc-submissions'), 'utf8'), `${request.requestId}\n`);
  },
);
