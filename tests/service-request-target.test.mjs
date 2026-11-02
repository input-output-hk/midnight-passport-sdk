import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connect } from 'node:net';
import { once } from 'node:events';
import { createServer } from '../packages/service/dist/index.js';

/** @param {number} port @param {string} target @param {string} [host] */
function rawRequest(port, target, host = `localhost:${port}`) {
  return new Promise((resolve, reject) => {
    const client = connect(port, '127.0.0.1');
    let response = '';
    client.setTimeout(3000, () => client.destroy(Error('request deadline')));
    client.on('connect', () =>
      client.write(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`),
    );
    client.setEncoding('utf8');
    client.on('data', (bytes) => {
      response += bytes;
    });
    client.on('error', reject);
    client.on('end', () => resolve(response));
  });
}

test('untrusted request targets are refused while the same service remains available', async () => {
  let routed = 0;
  const server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
    async (_req, res, url) => {
      routed++;
      assert.equal(url.pathname, '/healthz');
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
      '/same-host\\healthz',
    ]) {
      const bad = await rawRequest(address.port, target);
      assert.match(String(bad), /^HTTP\/1\.1 400 /);
      assert.match(String(bad), /invalid request target/);
      assert.equal(routed, 0);
    }
    const foreign = await rawRequest(address.port, '//[', 'untrusted.example');
    assert.match(String(foreign), /^HTTP\/1\.1 421 /);
    const healthy = await rawRequest(address.port, '/healthz?check=1');
    assert.match(String(healthy), /^HTTP\/1\.1 200 /);
    assert.equal(routed, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve(undefined))),
    );
  }
});
