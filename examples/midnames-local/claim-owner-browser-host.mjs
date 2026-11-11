import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';

const app = new URL('../../apps/passport-dapp/', import.meta.url);
const load = (name) => import(import.meta.resolve(name, new URL('package.json', app).href));
const endpoint = 'http://127.0.0.1:16320';
const maximumProofRequest = 64 * 1024 * 1024;
const routes = {
  '/owner-artifact/bzkir': 'zkir/create_domain.bzkir',
  '/owner-artifact/prover': 'keys/create_domain.prover',
  '/owner-artifact/verifier': 'keys/create_domain.verifier',
};

async function relayProof(request, response, origin) {
  const size = Number(request.headers['content-length']);
  if (
    request.method !== 'POST' ||
    request.headers.origin !== origin ||
    request.headers['content-type'] !== 'application/octet-stream' ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > maximumProofRequest
  ) {
    response.writeHead(403).end();
    return;
  }
  const upstream = await fetch(endpoint + request.url.slice('/owner-proof'.length), {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) },
    body: Readable.toWeb(request),
    duplex: 'half',
    redirect: 'error',
    signal: AbortSignal.timeout(85_000),
  });
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel();
    response.writeHead(502).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
  Readable.fromWeb(upstream.body)
    .on('error', () => response.destroy())
    .pipe(response);
}

function ownerMiddleware(assets) {
  return {
    name: 'midnames-owner-local',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const origin = server.resolvedUrls?.local[0]?.replace(/\/$/, '');
        if (!origin || request.headers.host !== new URL(origin).host) {
          response.writeHead(403).end();
          return;
        }
        if (request.url === '/owner-proof/check' || request.url === '/owner-proof/prove') {
          void relayProof(request, response, origin).catch(() => {
            if (!response.headersSent) response.writeHead(502).end();
            else response.destroy();
          });
          return;
        }
        if (request.method === 'GET' && Object.hasOwn(routes, request.url)) {
          response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
          response.end(readFileSync(join(assets, routes[request.url])));
          return;
        }
        next();
      });
    },
  };
}

async function ownerPage(input) {
  assert.equal(input.proverUrl, endpoint);
  assert.equal(input.indexerUrl, 'http://127.0.0.1:18108/api/v4/graphql');
  assert.equal(input.indexerWsUrl, 'ws://127.0.0.1:18108/api/v4/graphql/ws');
  const [{ build, preview }, { default: wasm }, { chromium }] = await Promise.all([
    load('vite'),
    load('vite-plugin-wasm'),
    load('playwright-core'),
  ]);
  const root = mkdtempSync(join(dirname(input.modulePath), 'chromium-owner-'));
  symlinkSync(join(input.ref, 'node_modules'), join(root, 'node_modules'));
  copyFileSync(input.modulePath, join(root, 'registry.mjs'));
  for (const name of ['registry-manifest.json', 'claim-owner-browser-entry.mjs'])
    copyFileSync(new URL(name, import.meta.url), join(root, name));
  writeFileSync(
    join(root, 'index.html'),
    '<!doctype html><title>Midnames owner qualification</title><script type="module" src="/claim-owner-browser-entry.mjs"></script>',
  );
  const config = {
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [wasm(), ownerMiddleware(input.assets)],
    resolve: {
      alias: [
        {
          find: /^(node:)?buffer$/,
          replacement: new URL('node_modules/buffer/index.js', app).pathname,
        },
        { find: /^(node:)?assert$/, replacement: new URL('src/shims/assert.ts', app).pathname },
        { find: 'isomorphic-ws', replacement: new URL('src/shims/ws.ts', app).pathname },
      ],
    },
    build: { target: 'esnext' },
    preview: { port: 0, host: 'localhost' },
  };
  await build(config);
  const site = await preview(config);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    });
    const context = await browser.newContext();
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
    const publicInput = {
      registryAddress: input.registryAddress,
      accountAddress: input.accountAddress,
      indexerUrl: input.indexerUrl,
      indexerWsUrl: input.indexerWsUrl,
      walletKeys: input.walletKeys,
      childOwnerAddress: input.childOwnerAddress,
      rootId: input.rootId,
      label: input.label,
      price: input.price,
    };
    await page.goto(site.resolvedUrls.local[0]);
    await page.waitForFunction(() => globalThis.midnamesOwner, undefined, { timeout: 15_000 });
    const id = await page.evaluate(() => globalThis.midnamesOwner.enroll());
    const result = await page.evaluate(
      ({ scope, credential }) => globalThis.midnamesOwner.prove(scope, credential),
      {
        scope: publicInput,
        credential: id,
      },
    );
    await page.reload();
    await page.waitForFunction(() => globalThis.midnamesOwner, undefined, { timeout: 15_000 });
    const restored = await page.evaluate(
      ({ scope, credential }) => globalThis.midnamesOwner.commitment(scope, credential),
      {
        scope: publicInput,
        credential: id,
      },
    );
    assert.equal(restored, result.ownerCommitment);
    return {
      ownerCommitment: result.ownerCommitment,
      bytes: Uint8Array.from(result.bytes),
      restored: true,
    };
  } finally {
    try {
      await browser?.close();
    } finally {
      await new Promise((resolve) => site.httpServer.close(resolve));
    }
  }
}

assert.ok(process.send);
process.once('message', (input) => {
  void ownerPage(input)
    .catch((error) => {
      console.error('Midnames owner qualification failed:', error?.message);
      process.exitCode = 1;
    })
    .then((result) => new Promise((resolve) => process.send(result ?? null, resolve)))
    .finally(() => process.disconnect?.());
});
