import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, type AddressInfo } from 'node:net';
import { createServer } from '../src/server.ts';
import { json, readJson, type Route } from '../src/http.ts';
import { loadConfig, loadStack, type ServiceConfig } from '../src/config.ts';
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

const STACK_KEYS = [
  'networkId',
  'nodeUri',
  'indexerUri',
  'indexerWsUri',
  'proofServerUri',
] as const;
const stackOf = (c: ServiceConfig) => Object.fromEntries(STACK_KEYS.map((k) => [k, c[k]]));

test('loadConfig defaults the stack to the localnet on the ports', () => {
  const base = { PASSPORT_CONTRACT_DIR: '/c', PASSPORT_MANIFEST_SHA256: 'ab' };
  assert.deepEqual(stackOf(loadConfig(base)), {
    networkId: 'undeployed',
    nodeUri: 'http://localhost:19944',
    indexerUri: 'http://localhost:18088/api/v4/graphql',
    indexerWsUri: 'ws://localhost:18088/api/v4/graphql/ws',
    proofServerUri: 'http://127.0.0.1:16300',
  });
  // The port variables (infra/localnet/ports.env) still move the defaults.
  const ported = loadConfig({
    ...base,
    MN_NODE_PORT: '1',
    MN_INDEXER_PORT: '2',
    MN_PROOF_PORT: '3',
  });
  assert.equal(ported.nodeUri, 'http://localhost:1');
  assert.equal(ported.indexerUri, 'http://localhost:2/api/v4/graphql');
  assert.equal(ported.indexerWsUri, 'ws://localhost:2/api/v4/graphql/ws');
  assert.equal(ported.proofServerUri, 'http://127.0.0.1:3');
});

test('the shipped undeployed.env is the localnet default on the ports.env ports', () => {
  const parse = (rel: string) =>
    Object.fromEntries(
      readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8')
        .split('\n')
        .filter((l) => /^[A-Z_]+=/.test(l))
        .map((l) => l.split('=') as [string, string]),
    );
  const stack = parse('infra/networks/undeployed.env');
  const fromPorts = loadStack(parse('infra/localnet/ports.env'));
  assert.deepEqual(loadStack(stack), fromPorts);
  assert.deepEqual(
    { ...stack },
    {
      MN_NETWORK_ID: fromPorts.networkId,
      MN_NODE_URL: fromPorts.nodeUri,
      MN_INDEXER_URL: fromPorts.indexerUri,
      MN_INDEXER_WS_URL: fromPorts.indexerWsUri,
      MN_PROOF_SERVER_URL: fromPorts.proofServerUri,
    },
  );
});

test('loadConfig reads the stack from the MN_* variables, and each overrides on its own', () => {
  const base = {
    PASSPORT_CONTRACT_DIR: '/c',
    PASSPORT_MANIFEST_SHA256: 'ab',
    PASSPORT_SPONSOR_SEED: 'cd'.repeat(32),
  };
  const config = loadConfig({
    ...base,
    MN_NETWORK_ID: 'preview',
    MN_NODE_URL: 'https://node.example',
    MN_INDEXER_URL: 'https://indexer.example/api/v4/graphql',
    MN_INDEXER_WS_URL: 'wss://indexer.example/api/v4/graphql/ws',
    MN_PROOF_SERVER_URL: 'https://prover.example',
  });
  assert.deepEqual(stackOf(config), {
    networkId: 'preview',
    nodeUri: 'https://node.example',
    indexerUri: 'https://indexer.example/api/v4/graphql',
    indexerWsUri: 'wss://indexer.example/api/v4/graphql/ws',
    proofServerUri: 'https://prover.example',
  });
  const one = loadConfig({ ...base, MN_NODE_URL: 'http://node.example:9944' });
  assert.equal(one.nodeUri, 'http://node.example:9944');
  assert.equal(one.networkId, 'undeployed');
  assert.equal(one.indexerUri, 'http://localhost:18088/api/v4/graphql');
  // A URL beats the port variable.
  assert.equal(
    loadConfig({ ...base, MN_NODE_URL: 'http://n', MN_NODE_PORT: '5' }).nodeUri,
    'http://n',
  );
});

test('loadConfig validates the stack URLs and the network id', () => {
  const base = { PASSPORT_CONTRACT_DIR: '/c', PASSPORT_MANIFEST_SHA256: 'ab' };
  for (const [key, value] of [
    ['MN_NODE_URL', 'ws://node.example'],
    ['MN_NODE_URL', 'node.example:9944'],
    ['MN_NODE_URL', ''],
    ['MN_INDEXER_URL', 'ftp://indexer.example'],
    ['MN_INDEXER_URL', 'wss://indexer.example'],
    ['MN_INDEXER_WS_URL', 'http://indexer.example/ws'],
    ['MN_INDEXER_WS_URL', 'not a url'],
    ['MN_PROOF_SERVER_URL', 'ws://prover.example'],
    ['MN_PROOF_SERVER_URL', ''],
    ['MN_NETWORK_ID', ''],
    ['MN_NETWORK_ID', 'Preview'],
    ['MN_NETWORK_ID', 'a/b'],
  ] as const) {
    assert.throws(() => loadConfig({ ...base, [key]: value }), new RegExp(key), `${key}=${value}`);
  }
});

test('a network other than undeployed needs an explicit sponsor seed', () => {
  const base = {
    PASSPORT_CONTRACT_DIR: '/c',
    PASSPORT_MANIFEST_SHA256: 'ab',
    MN_NETWORK_ID: 'preview',
  };
  assert.throws(() => loadConfig(base), /PASSPORT_SPONSOR_SEED/);
  assert.throws(() => loadConfig({ ...base, PASSPORT_SPONSOR_SEED: '' }), /PASSPORT_SPONSOR_SEED/);
  assert.equal(
    loadConfig({ ...base, PASSPORT_SPONSOR_SEED: '07'.repeat(32) }).sponsorSeed,
    '07'.repeat(32),
  );
  // The localnet keeps its genesis dev seed as the default, and may override it.
  assert.match(loadConfig({ ...base, MN_NETWORK_ID: 'undeployed' }).sponsorSeed, /^0+1$/);
  assert.equal(
    loadConfig({ ...base, MN_NETWORK_ID: 'undeployed', PASSPORT_SPONSOR_SEED: '07'.repeat(32) })
      .sponsorSeed,
    '07'.repeat(32),
  );
});

test('/config advertises exactly the configured stack', async () => {
  const config = testConfig({
    networkId: 'preview',
    nodeUri: 'https://node.example',
    indexerUri: 'https://indexer.example/graphql',
    indexerWsUri: 'wss://indexer.example/graphql/ws',
    proofServerUri: 'https://prover.example',
  });
  const { base, server } = await start(config);
  const body = (await (await fetch(`${base}/config`)).json()) as Record<string, string>;
  assert.deepEqual(stackOf(body as unknown as ServiceConfig), stackOf(config));
  server.close();
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
