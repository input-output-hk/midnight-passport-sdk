import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connect } from 'node:net';
import { once } from 'node:events';
import { createServer } from '../packages/service/dist/index.js';

/** @param {number} port @param {string} target @param {string} [host] @param {string} [method] @param {boolean} [jsonBody] */
function rawRequest(port, target, host = `localhost:${port}`, method = 'GET', jsonBody = false) {
  return new Promise((resolve, reject) => {
    const client = connect(port, '127.0.0.1');
    let response = '';
    client.setTimeout(3000, () => client.destroy(Error('request deadline')));
    client.on('connect', () =>
      client.write(
        `${method} ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n${jsonBody ? 'Content-Type: application/json\r\nContent-Length: 2\r\n' : ''}\r\n${jsonBody ? '{}' : ''}`,
      ),
    );
    client.setEncoding('utf8');
    client.on('data', (bytes) => {
      response += bytes;
    });
    client.on('error', reject);
    client.on('end', () => resolve(response));
    client.on('close', () => resolve(response));
  });
}

test('untrusted request targets are refused while the same service remains available', async () => {
  let routed = 0;
  const server = createServer({ host: '0:0:0:0:0:0:0:1', corsOrigin: 'http://localhost:5173' }, [
    async (_req, res, url) => {
      routed++;
      if (url.pathname === '/stream-fails') {
        res.writeHead(200);
        res.write('partial');
        throw Error('stream failed');
      }
      assert.equal(url.pathname, '/healthz');
      if (url.searchParams.has('q')) assert.equal(url.search, '?q=a\\b');
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
      return true;
    },
  ]);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    for (const target of [
      '//[',
      '//evil.example/healthz',
      '/\\evil.example/healthz',
      'http://evil.example/healthz',
      '/healthz#fragment',
      '/healthz#',
      '/a/..//healthz',
      '/same-host\\healthz',
    ]) {
      const bad = await rawRequest(address.port, target);
      assert.match(String(bad), /^HTTP\/1\.1 400 /);
      assert.match(String(bad), /invalid request target/);
      assert.match(String(bad), /access-control-allow-origin: http:\/\/localhost:5173/i);
      assert.equal(routed, 0);
    }
    const bodyTarget = await rawRequest(address.port, '/healthz#', undefined, 'POST', true);
    assert.match(String(bodyTarget), /^HTTP\/1\.1 400 /);
    assert.equal(routed, 0);
    const foreign = await rawRequest(address.port, '//[', 'untrusted.example');
    assert.match(String(foreign), /^HTTP\/1\.1 421 /);
    const bodyGate = await rawRequest(address.port, '//[', undefined, 'POST');
    assert.match(String(bodyGate), /^HTTP\/1\.1 415 /);
    const options = await rawRequest(address.port, '//[', undefined, 'OPTIONS');
    assert.match(String(options), /^HTTP\/1\.1 204 /);
    const normalisedHost = await rawRequest(
      address.port,
      '/healthz?q=a\\b',
      `[0:0:0:0:0:0:0:1]:${address.port}`,
    );
    assert.match(String(normalisedHost), /^HTTP\/1\.1 200 /);
    assert.equal(routed, 1);
    // A destroyed streaming response must close, without a second status or a deadline expiry.
    const stream = await rawRequest(address.port, '/stream-fails');
    assert.ok((String(stream).match(/HTTP\/1\.1/g) ?? []).length <= 1);
    assert.equal(String(stream).includes('stream failed'), false);
    const healthy = await rawRequest(address.port, '/healthz?check=1');
    assert.match(String(healthy), /^HTTP\/1\.1 200 /);
    assert.equal(routed, 3);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve(undefined))),
    );
  }
});

test('unexpected route errors return generic JSON and only explicit redacted callback fields', async () => {
  /** @type {Array<{status:number,headersSent:boolean}>} */ const events = [];
  const server = createServer(
    {
      host: '127.0.0.1',
      corsOrigin: 'http://localhost:5173',
      onRouteError: (event) => {
        events.push(event);
        throw Error('callback must not escape');
      },
    },
    [
      async () => {
        throw Error('/private/wallet/token-should-never-leave');
      },
    ],
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    for (let i = 0; i < 2; i++) {
      const response = await rawRequest(address.port, '/private-route?secret=hidden');
      assert.match(String(response), /^HTTP\/1\.1 500 /);
      assert.match(String(response), /internal service error/);
      assert.equal(String(response).includes('/private'), false);
    }
    assert.deepEqual(events, [
      { status: 500, headersSent: false },
      { status: 500, headersSent: false },
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
