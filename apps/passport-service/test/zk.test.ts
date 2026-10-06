import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, type AddressInfo } from 'node:net';
import { createServer } from '../src/server.ts';
import { json, readJson, type Route } from '../src/http.ts';
import { loadConfig } from '../src/config.ts';
import { mkdirSync } from 'node:fs';
import { configRoute, zkRoute } from '../src/routes/zk.ts';
import { bindingCircuits, verifyArtefacts } from '../src/artefacts.ts';
import { JSON_TYPE, fakeArtefacts, testConfig } from './fixtures.ts';

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

/**
 * Sends the request target verbatim over a raw socket. Node's WHATWG URL parsing still collapses
 * the `..` and `%2e%2e` forms before the route sees them (they simply miss the /zk prefix); only
 * the `%2f` and `%00` forms reach the route's own guard.
 */
function rawGet(port: number, target: string): Promise<number> {
  return new Promise((resolveStatus, reject) => {
    const socket = connect(port, 'localhost', () =>
      socket.write(
        `GET ${target} HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`,
      ),
    );
    let data = '';
    socket.on('data', (chunk) => (data += chunk.toString('latin1')));
    socket.on('error', reject);
    socket.on('close', () => resolveStatus(Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1])));
  });
}

test('/zk refuses raw traversal targets, including the encoded forms that reach its guard', async () => {
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

test('/zk serves only the compiler, zkir and keys folders', async () => {
  const config = testConfig();
  mkdirSync(join(config.artefactDir, 'contract'), { recursive: true });
  writeFileSync(join(config.artefactDir, 'contract/index.js'), 'export {};');
  const { base, server } = await start(config);
  assert.equal((await fetch(`${base}/zk/acc/contract/index.js`)).status, 404);
  assert.equal((await fetch(`${base}/zk/acc/registry.json`)).status, 404);
  for (const ok of [
    'zkir/c.bzkir',
    'keys/c.prover',
    'compiler/contract-manifest.json',
    'compiler/contract-info.json',
  ]) {
    assert.equal((await fetch(`${base}/zk/acc/${ok}`)).status, 200, ok);
  }
  server.close();
});

test('/zk survives a client that aborts mid-download', async () => {
  const config = testConfig();
  writeFileSync(join(config.artefactDir, 'keys/big.prover'), new Uint8Array(32 * 1024 * 1024));
  const { base, server } = await start(config);
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolveAbort, reject) => {
    const socket = connect(port, 'localhost', () =>
      socket.write(`GET /zk/acc/keys/big.prover HTTP/1.1\r\nHost: localhost:${port}\r\n\r\n`),
    );
    socket.once('data', () => {
      socket.destroy();
      resolveAbort();
    });
    socket.on('error', reject);
  });
  assert.equal((await fetch(`${base}/config`)).status, 200);
  assert.equal((await fetch(`${base}/zk/acc/keys/c.verifier`)).status, 200);
  server.close();
});

test('readJson answers 400 for malformed JSON and 413 for an oversized body', async () => {
  const config = testConfig();
  const echo: Route = async (req, res, url) => {
    if (req.method !== 'POST' || url.pathname !== '/echo') return false;
    json(res, 200, await readJson(req, 64));
    return true;
  };
  const server = createServer(config, [echo]);
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const ok = await fetch(`${base}/echo`, { method: 'POST', headers: JSON_TYPE, body: '{"a":1}' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { a: 1 });
  const bad = await fetch(`${base}/echo`, {
    method: 'POST',
    headers: JSON_TYPE,
    body: '{not json',
  });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /JSON/);
  const big = await fetch(`${base}/echo`, {
    method: 'POST',
    headers: JSON_TYPE,
    body: JSON.stringify({ pad: 'x'.repeat(4096) }),
  });
  assert.equal(big.status, 413);
  assert.match(((await big.json()) as { error: string }).error, /too large/);
  server.close();
});

test('loadConfig refuses a non-integer or out-of-range port', () => {
  const base = { PASSPORT_CONTRACT_DIR: '/c', PASSPORT_MANIFEST_SHA256: 'ab' };
  assert.equal(loadConfig(base).port, 8787);
  assert.equal(loadConfig({ ...base, PASSPORT_SERVICE_PORT: '9000' }).port, 9000);
  for (const bad of ['abc', '80.5', '0', '65536', '-1', '']) {
    assert.throws(
      () => loadConfig({ ...base, PASSPORT_SERVICE_PORT: bad }),
      /PASSPORT_SERVICE_PORT/,
      bad,
    );
  }
});

test('loadConfig reports the reference endpoints and refuses an override that differs (M5)', () => {
  const base = { PASSPORT_CONTRACT_DIR: '/c', PASSPORT_MANIFEST_SHA256: 'ab' };
  const config = loadConfig(base);
  assert.equal(config.networkId, 'undeployed');
  assert.equal(config.indexerUri, 'http://localhost:8088/api/v4/graphql');
  assert.equal(config.indexerWsUri, 'ws://localhost:8088/api/v4/graphql/ws');
  assert.equal(config.nodeUri, 'http://localhost:9944');
  assert.equal(config.proofServerUri, 'http://127.0.0.1:6300');
  // Restating a reference value is harmless.
  assert.equal(loadConfig({ ...base, PASSPORT_NETWORK_ID: 'undeployed' }).networkId, 'undeployed');
  for (const [key, value] of [
    ['PASSPORT_NETWORK_ID', 'testnet'],
    ['PASSPORT_NETWORK_ID', ''],
    ['PASSPORT_INDEXER_URI', 'http://indexer.example/api/v4/graphql'],
    ['PASSPORT_INDEXER_WS_URI', 'ws://indexer.example/api/v4/graphql/ws'],
    ['PASSPORT_NODE_URI', 'http://node.example:9944'],
    ['PASSPORT_PROOF_SERVER_URI', 'http://prover.example:6300'],
  ] as const) {
    assert.throws(
      () => loadConfig({ ...base, [key]: value }),
      new RegExp(`${key} is fixed to`),
      `${key}=${value}`,
    );
  }
});

test('loadConfig binds loopback by default and reads the host and deploy cap', () => {
  const base = { PASSPORT_CONTRACT_DIR: '/c', PASSPORT_MANIFEST_SHA256: 'ab' };
  assert.equal(loadConfig(base).host, '127.0.0.1');
  assert.equal(loadConfig({ ...base, PASSPORT_SERVICE_HOST: '' }).host, '127.0.0.1');
  assert.equal(loadConfig({ ...base, PASSPORT_SERVICE_HOST: '0.0.0.0' }).host, '0.0.0.0');
  assert.equal(loadConfig(base).maxDeploys, 20);
  assert.equal(loadConfig({ ...base, PASSPORT_MAX_DEPLOYS: '3' }).maxDeploys, 3);
  for (const bad of ['0', '-1', '1.5', 'x', '']) {
    assert.throws(
      () => loadConfig({ ...base, PASSPORT_MAX_DEPLOYS: bad }),
      /PASSPORT_MAX_DEPLOYS/,
      bad,
    );
  }
});

test('bindingCircuits lists the circuits that have a prover key and compiled ZKIR', () => {
  const { dir } = fakeArtefacts();
  assert.deepEqual([...bindingCircuits(dir)], ['c']);
});
