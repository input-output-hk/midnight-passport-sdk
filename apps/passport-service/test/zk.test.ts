import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, type AddressInfo } from 'node:net';
import { createServer } from '../src/server.ts';
import { configRoute, zkRoute } from '../src/routes/zk.ts';
import { verifyArtefacts } from '../src/artefacts.ts';
import { testConfig } from './fixtures.ts';

async function start(config = testConfig()) {
  const server = createServer(config, [configRoute(config, () => ({})), zkRoute(config)]);
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  return { base, server, config };
}

test('the artefact check accepts a matching tree and refuses a tampered one', () => {
  const c = testConfig();
  verifyArtefacts(c.artefactDir, c.manifestSha256);
  assert.throws(() => verifyArtefacts(c.artefactDir, '0'.repeat(64)), /manifest/);
  writeFileSync(join(c.artefactDir, 'keys/c.verifier'), Uint8Array.of(9));
  assert.throws(() => verifyArtefacts(c.artefactDir, c.manifestSha256), /keys\/c\.verifier/);
});

test('/zk serves artefact files as octet-stream with CORS and cache headers', async () => {
  const { base, server } = await start();
  const res = await fetch(`${base}/zk/acc/keys/c.verifier`, {
    headers: { origin: 'http://localhost:5173' },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), Uint8Array.of(3));
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.match(res.headers.get('cache-control') ?? '', /immutable/);
  const manifest = await fetch(`${base}/zk/acc/compiler/contract-manifest.json`);
  assert.equal(manifest.headers.get('cache-control'), 'no-cache');
  server.close();
});

test('/zk refuses path traversal and unknown files with 404', async () => {
  const { base, server } = await start();
  for (const p of [
    '/zk/acc/../registry.json',
    '/zk/acc/%2e%2e/registry.json',
    '/zk/acc/keys/missing.prover',
    '/zk/acc/',
  ]) {
    assert.equal((await fetch(base + p)).status, 404, p);
  }
  server.close();
});

test('/config reports the network, binding and pinned manifest', async () => {
  const { base, server, config } = await start();
  const body = (await (await fetch(`${base}/config`)).json()) as Record<string, string>;
  assert.equal(body.networkId, 'undeployed');
  assert.equal(body.manifestSha256, config.manifestSha256);
  assert.equal(body.zkBaseUrl, `${base}/zk/acc`);
  server.close();
});

/** Sends the request target verbatim; fetch would normalise dot segments before they reach the server. */
function rawGet(port: number, target: string): Promise<number> {
  return new Promise((resolveStatus, reject) => {
    const socket = connect(port, 'localhost', () =>
      socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`),
    );
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString('latin1')));
    socket.on('error', reject);
    socket.on('close', () => resolveStatus(Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1])));
  });
}

test('/zk refuses un-normalised traversal targets that reach the route verbatim', async () => {
  const { server } = await start();
  const port = (server.address() as AddressInfo).port;
  const targets = [
    '/zk/acc/../registry.json',
    '/zk/acc/keys/../../registry.json',
    '/zk/acc/..%2fregistry.json',
    '/zk/acc/%2e%2e%2fregistry.json',
    '/zk/acc/keys%2f..%2f..%2fregistry.json',
    '/zk/acc/keys/c.verifier%00.json',
    '/zk/acc/keys',
  ];
  for (const target of targets) assert.equal(await rawGet(port, target), 404, target);
  server.close();
});
