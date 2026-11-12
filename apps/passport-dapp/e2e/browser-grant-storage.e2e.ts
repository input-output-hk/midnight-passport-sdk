import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const fixture = '/e2e/fixtures/browser-grant-storage-fixture.ts';
type Fixture = typeof import('./fixtures/browser-grant-storage-fixture.js');
const cache = await mkdtemp(join(tmpdir(), 'passport-browser-grant-storage-'));
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  server = await createServer({
    root: appRoot,
    configFile: false,
    cacheDir: cache,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, hmr: false },
    plugins: [
      {
        name: 'isolated-grant-storage',
        configureServer(vite) {
          vite.middlewares.use((request, response, next) => {
            if (request.url !== '/__grant-storage') return next();
            response.setHeader('Content-Type', 'text/html');
            response.end('<!doctype html><title>Passport grant storage test</title>');
          });
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    ...(process.env.CHROME_BIN && { executablePath: process.env.CHROME_BIN }),
  });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) =>
    route
      .request()
      .url()
      .startsWith(origin + '/')
      ? route.continue()
      : route.abort(),
  );
  const [one, two] = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all([one.goto(origin + '/__grant-storage'), two.goto(origin + '/__grant-storage')]);
  const claim = (page: typeof one) =>
    page.evaluate(async (url) => {
      const source: Fixture = await import(url);
      return source.claim();
    }, fixture);
  const claims = await Promise.all([claim(one), claim(two)]);
  assert.equal(claims.filter(({ first }) => first).length, 1);
  assert.equal(claims[0].requestId, claims[1].requestId);
  const { requestId } = claims[0];
  assert.equal(
    await one.evaluate(
      async ({ url, id }) => {
        const source: Fixture = await import(url);
        return source.stage(id);
      },
      { url: fixture, id: requestId },
    ),
    true,
  );
  await one.close();
  await two.reload();
  const recover = (seed: number) =>
    two.evaluate(
      async ({ url, id, seed: selected }) => {
        const source: Fixture = await import(url);
        return source.recover(id, selected);
      },
      { url: fixture, id: requestId, seed },
    );
  assert.deepEqual(await recover(9), {
    original: requestId,
    fenced: true,
    openingMatched: true,
    refused: false,
  });
  assert.deepEqual(await recover(10), {
    original: requestId,
    fenced: true,
    openingMatched: false,
    refused: true,
  });
  assert.equal(
    await two.evaluate(async (url) => {
      const source: Fixture = await import(url);
      return (await source.crossAccountRefused()) && (await source.openingCiphertextRetained());
    }, fixture),
    true,
  );
  await two.evaluate(async (url) => {
    const source: Fixture = await import(url);
    await source.tamperOpeningRevision();
  }, fixture);
  assert.deepEqual(await recover(9), {
    original: requestId,
    fenced: true,
    openingMatched: false,
    refused: true,
  });
  console.log(
    'PASS two tabs elect one issuer, reload retains ciphertext and wrong key, account or revision fails',
  );
} finally {
  try {
    await browser?.close();
  } finally {
    try {
      await server?.close();
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  }
}
