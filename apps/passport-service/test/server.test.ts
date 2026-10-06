// The server's request guards (Final review I1): the Host check against DNS rebinding, and the
// JSON content type that forces a CORS preflight on every body-carrying request.
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import type { ChainBackend } from '../src/backend.ts';
import type { ServiceConfig } from '../src/config.ts';
import { chainRoute } from '../src/routes/chain.ts';
import { registryRoute } from '../src/routes/registry.ts';
import { configRoute } from '../src/routes/zk.ts';
import { createServer } from '../src/server.ts';
import { JSON_TYPE, testConfig } from './fixtures.ts';

function countingBackend() {
  const calls = { deploy: 0 };
  const backend: ChainBackend = {
    check: async () => [],
    prove: async () => Uint8Array.of(1),
    balance: async (tx) => tx,
    submit: async () => 'txid',
    async deploy() {
      calls.deploy++;
      return { address: 'cc'.repeat(32), txHashes: [] };
    },
    sponsorKeys: () => ({ coinPublicKey: 'cp', encryptionPublicKey: 'ep' }),
  };
  return { backend, calls };
}

async function start(t: TestContext, config: ServiceConfig = testConfig()) {
  const f = countingBackend();
  const server = createServer(config, [
    configRoute(config, () => ({})),
    registryRoute(config),
    chainRoute(f.backend, { circuits: new Set(['c']), maxDeploys: 1, log: () => {} }),
  ]);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const port = (server.address() as AddressInfo).port;
  return { port, base: `http://127.0.0.1:${port}`, calls: f.calls };
}

/** A request with exactly the Host header given (none when `host` is undefined). */
function send(
  port: number,
  opts: { method?: string; path?: string; host?: string; headers?: Record<string, string> },
  body?: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'GET',
        path: opts.path ?? '/config',
        setHost: false,
        headers: { ...(opts.host === undefined ? {} : { host: opts.host }), ...opts.headers },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** An HTTP/1.0 GET /config, which may omit Host. */
function http10(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write('GET /config HTTP/1.0\r\n\r\n'));
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString('latin1')));
    socket.on('error', reject);
    socket.on('close', () => resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1])));
  });
}

const deployBody = JSON.stringify({ boot: '11'.repeat(32), encKey: '22'.repeat(32) });

test('a request for another host is 421, so DNS rebinding cannot make a page same-origin', async (t) => {
  const { port } = await start(t);
  assert.equal(await send(port, { host: 'evil.example' }), 421);
  assert.equal(await send(port, { host: `evil.example:${port}` }), 421);
  assert.equal(await send(port, { host: 'localhost' }), 421, 'the port is part of the name');
  assert.equal(await send(port, { host: 'localhost:1' }), 421);
  assert.equal(await send(port, {}), 400, 'no Host on HTTP/1.1: Node refuses it itself');
  assert.equal(await http10(port), 421, 'no Host on HTTP/1.0');
  assert.equal(await send(port, { method: 'OPTIONS', host: 'evil.example' }), 421);
  for (const host of [
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `LOCALHOST:${port}`,
    `[::1]:${port}`,
  ]) {
    assert.equal(await send(port, { host }), 200, host);
  }
});

test('PASSPORT_SERVICE_HOST adds the configured host to the names answered', async (t) => {
  const { port } = await start(t, testConfig({ host: 'passport.test' }));
  assert.equal(await send(port, { host: `passport.test:${port}` }), 200);
  assert.equal(await send(port, { host: `localhost:${port}` }), 200);
  assert.equal(await send(port, { host: `evil.example:${port}` }), 421);
});

test('a cross-site text/plain POST to /deploy is 415 and leaves the deploy cap untouched', async (t) => {
  const { base, calls } = await start(t);
  for (const type of [
    'text/plain',
    'text/plain;charset=UTF-8',
    'application/x-www-form-urlencoded',
  ]) {
    const res = await fetch(`${base}/deploy`, {
      method: 'POST',
      headers: { 'content-type': type },
      body: deployBody,
    });
    assert.equal(res.status, 415, type);
  }
  assert.equal(calls.deploy, 0);
  // The cap is 1: had any refused request counted, this one would be 429.
  const ok = await fetch(`${base}/deploy`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: deployBody,
  });
  assert.equal(ok.status, 200);
  assert.equal(calls.deploy, 1);
});

test('a POST or PUT with no content type is 415; GET and the preflight need none', async (t) => {
  const { port, base } = await start(t);
  const host = `127.0.0.1:${port}`;
  assert.equal(await send(port, { method: 'POST', path: '/prove', host }, '{}'), 415);
  assert.equal(
    await send(port, { method: 'PUT', path: '/accounts/undeployed/0a0b', host }, '{}'),
    415,
  );
  assert.equal(await send(port, { method: 'OPTIONS', path: '/deploy', host }), 204);
  assert.equal((await fetch(`${base}/accounts/undeployed/0a0b`)).status, 404);
  const put = await fetch(`${base}/accounts/undeployed/0a0b`, {
    method: 'PUT',
    headers: JSON_TYPE,
    body: '{}',
  });
  assert.equal(put.status, 400, 'a JSON PUT reaches the registry, which validates it');
});
