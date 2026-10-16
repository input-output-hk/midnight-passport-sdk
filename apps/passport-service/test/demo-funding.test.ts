import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createServer } from '@input-output-hk/mn-passport-service';
import type { ServiceConfig } from '../src/config.ts';
import { demoFundingRoute } from '../src/routes/demo-funding.ts';

const dir = mkdtempSync(join(tmpdir(), 'passport-demo-funding-'));
const accountAddress = 'a'.repeat(64);
const color = 'b'.repeat(64);
const manifestSha256 = 'c'.repeat(64);
const requestId = '346b2744-dedb-432e-9cbd-2b56f64c5957';
const token = 'demo-token-'.repeat(6);
const registryFile = join(dir, 'registry.json');
const tokenFile = join(dir, 'token');
const assetsFile = join(dir, 'assets.json');
writeFileSync(registryFile, JSON.stringify({ 'undeployed/device': { address: accountAddress } }));
writeFileSync(
  join(dir, 'registry.deployments.json'),
  JSON.stringify({ undeployed: [accountAddress] }),
);
writeFileSync(tokenFile, token);
writeFileSync(assetsFile, JSON.stringify([{ color, maxPerRequest: '20', maxPerUtcDay: '100' }]));

const config = {
  networkId: 'undeployed',
  host: '127.0.0.1',
  corsOrigin: 'http://localhost:5173',
  bindingId: 'acc-s3r1.1',
  manifestSha256,
  registryFile,
} as ServiceConfig;

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server has no TCP address');
  return address.port;
}

after(() => {
  // The temporary files carry only synthetic test values.
  rmSync(dir, { recursive: true, force: true });
});

test('demo funding is opt-in and restricted to loopback localnet', () => {
  assert.equal(demoFundingRoute(config, {}), undefined);
  const env = {
    PASSPORT_DEMO_FUNDING_ENABLED: '1',
    PASSPORT_FUNDING_TOKEN_FILE: tokenFile,
    PASSPORT_FUNDING_ASSETS_FILE: assetsFile,
  };
  assert.throws(
    () => demoFundingRoute({ ...config, networkId: 'preview' }, env),
    /localnet|undeployed/,
  );
  assert.throws(() => demoFundingRoute({ ...config, host: '0.0.0.0' }, env), /loopback/);
});

test('browser seam keeps token server-side and funds only a registered deployed ACC', async () => {
  let forwarded = 0;
  let wrongManifest = false;
  const backend = createHttpServer(async (req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          networkId: 'undeployed',
          bindingId: config.bindingId,
          manifestSha256: wrongManifest ? 'f'.repeat(64) : manifestSha256,
        }),
      );
      return;
    }
    assert.equal(req.url, '/v1/faucet/fund');
    assert.equal(req.headers.authorization, `Bearer ${token}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(body.accountAddress, accountAddress);
    assert.equal(body.color, color);
    assert.equal(body.amount, '10');
    forwarded++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ requestId, txId: 'd'.repeat(64), creditedBalance: '10' }));
  });
  const backendPort = await listen(backend);
  const route = demoFundingRoute(config, {
    PASSPORT_DEMO_FUNDING_ENABLED: '1',
    PASSPORT_FUNDING_TOKEN_FILE: tokenFile,
    PASSPORT_FUNDING_ASSETS_FILE: assetsFile,
    PASSPORT_FUNDING_URL: `http://127.0.0.1:${backendPort}`,
  });
  assert.ok(route);
  const server = createServer(config, [route]);
  const port = await listen(server);
  const url = `http://127.0.0.1:${port}/v1/demo/funding`;
  try {
    const discovery = await fetch(url);
    assert.deepEqual(await discovery.json(), { asset: { color, amount: '10' } });
    const post = (address: string, origin: string) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ accountAddress: address, requestId }),
      });
    assert.equal((await post(accountAddress, 'https://other.example')).status, 403);
    assert.equal((await post('e'.repeat(64), config.corsOrigin)).status, 403);
    assert.equal(forwarded, 0);
    const funded = await post(accountAddress, config.corsOrigin);
    assert.equal(funded.status, 200);
    assert.deepEqual(await funded.json(), {
      requestId,
      accountAddress,
      color,
      amount: '10',
      txId: 'd'.repeat(64),
      creditedBalance: '10',
    });
    assert.equal(forwarded, 1);
    wrongManifest = true;
    assert.equal((await post(accountAddress, config.corsOrigin)).status, 503);
    assert.equal(forwarded, 1, 'a binding mismatch never reaches the funding wallet');
  } finally {
    server.close();
    backend.close();
  }
});
