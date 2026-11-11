import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

function ownerMiddleware(assets, context, publicOrigin) {
  return {
    name: 'midnames-owner-local',
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const origin = publicOrigin ?? server.resolvedUrls?.local[0]?.replace(/\/$/, '');
        if (!origin || request.headers.host !== new URL(origin).host) {
          response.writeHead(403).end();
          return;
        }
        if (context && request.method === 'GET' && request.url === '/owner-claim/context') {
          response.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
          });
          response.end(JSON.stringify(context));
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

function stageOwnerSources(input, root) {
  const manifest = JSON.parse(
    readFileSync(new URL('registry-manifest.json', import.meta.url), 'utf8'),
  );
  const registry = readFileSync(input.modulePath);
  assert.equal(
    createHash('sha256').update(registry).digest('hex'),
    manifest.compiled['contract/index.js'],
  );
  symlinkSync(join(input.ref, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(join(root, 'registry.mjs'), registry);
  for (const name of ['registry-manifest.json', 'claim-owner-browser-entry.mjs'])
    copyFileSync(new URL(name, import.meta.url), join(root, name));
}

function ownerViteConfig(root, plugins) {
  return {
    root,
    configFile: false,
    logLevel: 'silent',
    plugins,
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
}

/** Serve the owner bundle behind the regular demo's localhost origin. */
export async function startDemoOwnerBundle(input, publicContext, origin = 'http://localhost:5173') {
  const demo = new URL(origin);
  assert.equal(demo.origin, origin);
  assert.equal(demo.protocol, 'http:');
  assert.equal(demo.hostname, 'localhost');
  const [{ build, preview }, { default: wasm }] = await Promise.all([
    load('vite'),
    load('vite-plugin-wasm'),
  ]);
  const root = mkdtempSync(join(dirname(input.modulePath), 'demo-owner-'));
  try {
    stageOwnerSources(input, root);
    const { networkId, registryAddress, sponsorAddress, indexerUrl, indexerWsUrl, walletKeys } =
      publicContext;
    const context = {
      networkId,
      registryAddress,
      sponsorAddress,
      indexerUrl,
      indexerWsUrl,
      walletKeys: { coin: walletKeys.coin, encryption: walletKeys.encryption },
    };
    const config = ownerViteConfig(root, [wasm(), ownerMiddleware(input.assets, context, origin)]);
    config.base = '/owner-claim/';
    const entry = join(root, 'demo-entry.mjs');
    writeFileSync(entry, "export { proveReviewedClaim } from './claim-owner-browser-entry.mjs';");
    config.build.rollupOptions = {
      input: entry,
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: 'entry.js' },
    };
    await build(config);
    const site = await preview(config);
    return {
      origin: new URL(site.resolvedUrls.local[0]).origin,
      async close() {
        try {
          await site.close();
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export async function ownerPage(input, setPhase = () => {}) {
  assert.equal(input.proverUrl, endpoint);
  assert.equal(input.indexerUrl, 'http://127.0.0.1:18108/api/v4/graphql');
  assert.equal(input.indexerWsUrl, 'ws://127.0.0.1:18108/api/v4/graphql/ws');
  const [{ build, preview }, { default: wasm }, { chromium }] = await Promise.all([
    load('vite'),
    load('vite-plugin-wasm'),
    load('playwright-core'),
  ]);
  const root = mkdtempSync(join(dirname(input.modulePath), 'chromium-owner-'));
  try {
    stageOwnerSources(input, root);
    copyFileSync(
      new URL('claim-owner-qualification-entry.mjs', import.meta.url),
      join(root, 'claim-owner-qualification-entry.mjs'),
    );
    writeFileSync(
      join(root, 'index.html'),
      '<!doctype html><title>Midnames owner qualification</title><script type="module" src="/claim-owner-qualification-entry.mjs"></script>',
    );
    const config = ownerViteConfig(root, [wasm(), ownerMiddleware(input.assets)]);
    setPhase('browser-build');
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
      setPhase('browser-enroll');
      const id = await page.evaluate(() => globalThis.midnamesOwner.enroll());
      setPhase('browser-prove');
      const result = await page.evaluate(
        ({ scope, credential }) => globalThis.midnamesOwner.prove(scope, credential),
        {
          scope: publicInput,
          credential: id,
        },
      );
      setPhase('browser-recover');
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
        await site.close();
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.send) {
  process.once('message', (input) => {
    let failedAt = 'initialize';
    void ownerPage(input, (phase) => {
      failedAt = phase;
    })
      .catch(() => {
        process.exitCode = 1;
        return { failedAt };
      })
      .then((result) => new Promise((resolve) => process.send(result, resolve)))
      .finally(() => process.disconnect?.());
  });
}
