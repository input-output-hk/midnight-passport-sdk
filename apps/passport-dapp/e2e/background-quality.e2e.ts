// Own ephemeral browser/server. Never contacts localhost:5173, a real credential or Midnight stack.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const output =
  process.env.PASSPORT_BACKGROUND_OUTPUT ??
  resolve(appRoot, '../../review', `background-quality-${Date.now()}.json`);
const startedAt = new Date().toISOString();
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: resolve(appRoot, '../..'),
  encoding: 'utf8',
}).trim();
const dirty =
  execFileSync('git', ['status', '--porcelain'], {
    cwd: resolve(appRoot, '../..'),
    encoding: 'utf8',
  }).length > 0;
const previousManifest = process.env.PASSPORT_MANIFEST_SHA256;
process.env.PASSPORT_MANIFEST_SHA256 = JSON.parse(
  await readFile(resolve(appRoot, '../../packages/contract/acc-binding-v2.generated.json'), 'utf8'),
).manifestSha256;
const cache = await mkdtemp(resolve(tmpdir(), 'passport-worker-quality-'));
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let outcome = 'failed';
let results: unknown;
let failure: string | undefined;
let resourcesClosed = false;
try {
  server = await createServer({
    root: appRoot,
    configFile: resolve(appRoot, 'vite.config.ts'),
    cacheDir: cache,
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    plugins: [
      {
        name: 'isolated-wallet-worker-runtime',
        enforce: 'pre',
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            if (req.url !== '/__quality') {
              next();
              return;
            }
            res.setHeader('Content-Type', 'text/html');
            res.end(
              '<!doctype html><title>Owned Passport quality test</title><main>Worker qualification</main>',
            );
          });
        },
        async load(id) {
          if (
            id.split('?')[0] === resolve(appRoot, 'src/wallet/runtime.ts') &&
            !id.includes('quality-real')
          )
            return readFile(resolve(appRoot, 'e2e/fixtures/wallet-runtime-fixture.ts'), 'utf8');
          return null;
        },
      },
    ],
  });
  await server.listen();
  const address = server.httpServer?.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
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
      .startsWith(base + '/')
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage();
  await page.goto(base + '/__quality');
  results = await page.evaluate(
    async ({ storageModule, backgroundModule, rpcModule }) => {
      const { browserBackgroundPort } = await import(backgroundModule);
      const { createBackgroundClient, serveBackgroundTasks } = await import(rpcModule);
      const channel = new MessageChannel();
      const client = createBackgroundClient(
        browserBackgroundPort(channel.port1, () => channel.port1.close()),
        { channel: 'native-channel', timeoutMs: 2_000 },
      );
      const stop = serveBackgroundTasks(
        browserBackgroundPort(channel.port2, () => channel.port2.close()),
        {
          channel: 'native-channel',
          methods: {
            async echo(input: unknown) {
              return input;
            },
          },
        },
      );
      let messageChannel: unknown;
      try {
        // No manual start(): both native receiving ports must be started by the adapter.
        messageChannel = await client.request('echo', { native: true });
      } finally {
        client.close();
        stop();
        channel.port2.close();
      }
      const modulePath = '/src/wallet/dev-wallet.ts';
      const { createDevWallet } = await import(modulePath);
      const seed = new Uint8Array(64).fill(4);
      const wallet = await createDevWallet(seed, {
        networkId: 'undeployed',
        indexerUri: 'http://synthetic',
        indexerWsUri: 'ws://synthetic',
        nodeUri: 'http://synthetic',
      });
      let ticks = 0;
      const timer = setInterval(() => ticks++, 5);
      let workerResult: unknown;
      try {
        const api = await wallet.descriptor.connect('undeployed');
        const [balances, dust] = await Promise.all([
          api.getUnshieldedBalances(),
          api.getDustBalance(),
        ]);
        workerResult = {
          night: String(balances['00'.repeat(32)]),
          clearedWorkerSeed: dust.balance === 0n,
          callerSeedUnchanged: seed[0] === 4,
          ticks,
        };
      } finally {
        clearInterval(timer);
        await wallet.stop();
        seed.fill(0);
      }
      let stopped = false;
      try {
        await wallet.descriptor.connect('undeployed');
      } catch {
        stopped = true;
      }
      const { createBrowserSecretStore } = await import(storageModule);
      const databaseName = 'passport-quality-' + crypto.randomUUID();
      const options = { indexedDB, databaseName, allowPlaintext: true };
      const reference = {
        namespace: 'test',
        networkId: 'undeployed',
        bindingId: 'acc-s3r1.1',
        account: 'ab'.repeat(32),
        id: 'sample',
      };
      let store = await createBrowserSecretStore(options);
      const stored = await store.write(reference, Uint8Array.of(1, 2), null);
      const writes = await Promise.allSettled([
        store.write(reference, Uint8Array.of(3), stored.version),
        store.write(reference, Uint8Array.of(4), stored.version),
      ]);
      store.close();
      store = await createBrowserSecretStore(options);
      const recovered = await store.read(reference);
      await store.remove(reference, recovered.version);
      store.close();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(Error('Owned test database cleanup failed.'));
      });
      const realImport = await new Promise<unknown>((resolve, reject) => {
        const worker = new Worker('/e2e/fixtures/wallet-import-worker.ts', { type: 'module' });
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(Error('Wallet SDK worker import timed out.'));
        }, 60_000);
        worker.onmessage = (message) => {
          clearTimeout(timeout);
          worker.terminate();
          resolve(message.data);
        };
        worker.onerror = () => {
          clearTimeout(timeout);
          worker.terminate();
          reject(Error('Wallet SDK worker import failed.'));
        };
      });
      return {
        worker: workerResult,
        stopped,
        indexedDB: {
          conflicts: writes.filter((r) => r.status === 'rejected').length,
          reopened: recovered.bytes instanceof Uint8Array,
        },
        realImport,
        messageChannel,
      };
    },
    {
      storageModule:
        '/@fs' + resolve(appRoot, '../../packages/adapter-browser/dist/secret-store.js'),
      backgroundModule:
        '/@fs' + resolve(appRoot, '../../packages/adapter-browser/dist/background.js'),
      rpcModule: '/@fs' + resolve(appRoot, '../../packages/account/dist/background.js'),
    },
  );
  const result = results as {
    worker: {
      night: string;
      clearedWorkerSeed: boolean;
      callerSeedUnchanged: boolean;
      ticks: number;
    };
    stopped: boolean;
    indexedDB: { conflicts: number; reopened: boolean };
    realImport: { imported: boolean; worker: boolean };
    messageChannel: { native: boolean };
  };
  assert.equal(result.worker.night, '7');
  assert.equal(result.worker.clearedWorkerSeed, true);
  assert.equal(result.worker.callerSeedUnchanged, true);
  assert.ok(result.worker.ticks >= 3);
  assert.equal(result.stopped, true);
  assert.deepEqual(result.indexedDB, { conflicts: 1, reopened: true });
  assert.deepEqual(result.realImport, { imported: true, worker: true });
  assert.deepEqual(result.messageChannel, { native: true });
  outcome = 'passed';
} catch (error) {
  failure = error instanceof Error ? error.message : 'Unknown qualification failure';
  process.exitCode = 1;
} finally {
  if (previousManifest === undefined) delete process.env.PASSPORT_MANIFEST_SHA256;
  else process.env.PASSPORT_MANIFEST_SHA256 = previousManifest;
  try {
    await browser?.close();
    await server?.close();
    await rm(cache, { recursive: true, force: true });
    resourcesClosed = true;
  } catch {
    outcome = 'failed';
    failure = 'Owned resource cleanup failed.';
    process.exitCode = 1;
  }
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        schemaVersion: 1,
        outcome,
        sourceCommit,
        dirty,
        startedAt,
        endedAt: new Date().toISOString(),
        scope:
          'Real Chromium MessageChannel/worker transport and IndexedDB; synthetic wallet CPU/balances; actual wallet SDK import only, no native sync/proofs/provider acceptance.',
        results,
        failure,
        resourcesClosed,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(JSON.stringify({ output, outcome, resourcesClosed }));
}
