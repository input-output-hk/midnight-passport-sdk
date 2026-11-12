import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext } from 'playwright-core';
import { createServer } from 'vite';
import {
  createServer as createHttpService,
  fileMutationByteStore,
} from '../../../packages/service/dist/index.js';
import { createBrowserGrantSessions } from '../../passport-service/src/browser-grant-sessions.ts';
import { browserGrantRelay } from '../../passport-service/src/routes/browser-grant.ts';
import type { PasskeyCredential } from '@input-output-hk/mn-passport-account/ports';
import { toHex } from '@input-output-hk/mn-passport-account';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const fixture = '/e2e/fixtures/browser-grant-relay-fixture.ts';
const account = '31'.repeat(32);
const txHash = '43'.repeat(32);
const temp = await mkdtemp(join(tmpdir(), 'passport-grant-browser-'));
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let backend: ReturnType<typeof createHttpService> | undefined;
let owner: PasskeyCredential | undefined;
let issuer = '';
let route: ReturnType<typeof browserGrantRelay> | undefined;
let sessionRoute: ReturnType<typeof createBrowserGrantSessions>['route'] | undefined;
let sends = 0;
let reads = 0;
let lost = 0;

async function originPage(context: BrowserContext, origin: string) {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
    },
  });
  await page.goto(origin + '/__grant-fixture');
  assert.equal(await page.evaluate(() => window.isSecureContext), true);
  return page;
}

try {
  const key = join(temp, 'key.pem');
  const cert = join(temp, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=aa.test',
      '-addext',
      'subjectAltName=DNS:aa.test,DNS:bb.test',
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'ignore' },
  );
  backend = createHttpService({ host: '127.0.0.1', corsOrigin: 'null' }, [
    async (req, res, url) =>
      Boolean((await sessionRoute?.(req, res, url)) || (await route?.(req, res, url))),
  ]);
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  const backendPort = (backend.address() as AddressInfo).port;
  vite = await createServer({
    root: appRoot,
    configFile: false,
    cacheDir: join(temp, 'cache'),
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 0,
      hmr: false,
      https: { key: await readFile(key), cert: await readFile(cert) },
      proxy: {
        '/v1/browser-grant/': {
          target: 'http://127.0.0.1:' + backendPort,
          changeOrigin: true,
          configure(proxy) {
            proxy.on('proxyRes', (upstream, request, response) => {
              if (request.url === '/v1/browser-grant/execute' && upstream.statusCode === 200) {
                lost++;
                response.destroy();
              }
            });
          },
        },
      },
      fs: { allow: [resolve(appRoot, '../..')] },
    },
    plugins: [
      {
        name: 'isolated-browser-grant-fixture',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url !== '/__grant-fixture') return next();
            res.setHeader('Content-Type', 'text/html');
            res.end('<!doctype html><title>Passport grant relay test</title>');
          });
        },
      },
    ],
  });
  await vite.listen();
  const port = (vite.httpServer?.address() as AddressInfo).port;
  issuer = 'https://aa.test:' + port;
  const holder = 'https://bb.test:' + port;
  assert.equal(issuer.length, 21);
  assert.equal(holder.length, 21);
  const sessions = createBrowserGrantSessions({
    issuer,
    async readOwner(request) {
      if (
        owner &&
        request.account === account &&
        request.credentialId === toHex(owner.credentialId)
      )
        return { ...owner, deviceEpoch: 0n };
      return undefined;
    },
  });
  sessionRoute = sessions.route;
  route = browserGrantRelay({
    issuer,
    authenticate: sessions.authenticate,
    store: fileMutationByteStore(join(temp, 'admissions')),
    sponsor: {
      async execute(proof, request, context) {
        assert.equal(await context.beforeDispatch(), true);
        assert.deepEqual(proof, Buffer.from('ab', 'hex'));
        assert.equal(request.address, account);
        sends++;
        return { txHash, blockHeight: 7 };
      },
      async reconcile() {
        reads++;
        return { txHash, blockHeight: 7 };
      },
    },
  });
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--host-resolver-rules=MAP aa.test 127.0.0.1, MAP bb.test 127.0.0.1',
      '--no-proxy-server',
    ],
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const issuerPage = await originPage(context, issuer);
  owner = await issuerPage.evaluate(async (path) => (await import(path)).register(), fixture);
  const holderPage = await originPage(context, holder);
  await holderPage.evaluate(async (path) => (await import(path)).register(), fixture);
  const fragment = await holderPage.evaluate(
    async ({ path, issuer, account }) => (await import(path)).requestGrant(issuer, account),
    { path: fixture, issuer, account },
  );
  const result = await issuerPage.evaluate(
    async ({ path, fragment, account }) => (await import(path)).exercise(fragment, account),
    { path: fixture, fragment, account },
  );
  await holderPage.evaluate(async (path) => (await import(path)).rejectInvalidCallback(), fixture);
  assert.deepEqual(result.receipt, { txHash, blockHeight: 7 });
  assert.equal(result.rejected, 2);
  assert.ok(result.auth >= 1 && result.auth <= 5);
  assert.deepEqual([lost, sends, reads], [1, 1, 1]);
  console.log('Browser grant relay passed with separate HTTPS origins and one original dispatch');
} finally {
  await browser?.close();
  await vite?.close();
  if (backend) await new Promise<void>((done) => backend!.close(() => done()));
  await rm(temp, { recursive: true, force: true });
}
