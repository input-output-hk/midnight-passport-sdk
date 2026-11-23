import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const request = {
  requestId: '12345678-1234-1234-1234-123456789abc',
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: 'ef'.repeat(32),
  accountAddress: 'ab'.repeat(32),
  color: 'cd'.repeat(32),
  amount: '10',
};

/** @param {'hold' | 'reopen'} mode @param {string} root */
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

test(
  'a killed async funding worker leaves one observable original and cannot redispatch after restart',
  { timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'passport-funding-process-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const first = await childServer('hold', root);
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
    assert.deepEqual(await status.json(), {
      requestId: request.requestId,
      accountAddress: request.accountAddress,
      color: request.color,
      amount: request.amount,
      state: 'pending',
    });
    const replay = await fetch(reopened, {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'respond-async' },
      body: JSON.stringify(request),
    });
    assert.equal(replay.status, 409);
    await assert.rejects(readFile(join(root, 'forbidden-redispatch')), { code: 'ENOENT' });
  },
);
