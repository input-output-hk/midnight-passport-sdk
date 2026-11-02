#!/usr/bin/env node
// Browser protocol lane only: no chain, wallet, Docker, real provider or production page claim.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { verifyPublicSigner, signerBundleTree } from './consumer/public-signer-source.mjs';
import { installedTreeIdentity, runtimeTreeIdentity } from './consumer/host-retained.mjs';
import { consumerSha256 } from './consumer-inputs.mjs';
import { workspaceIdentity } from './qualification/receipt.mjs';
const repository = resolve(import.meta.dirname, '..');
/** @param {string} requested @param {string} consumer */
export function browserOutput(requested, consumer) {
  assert.ok(isAbsolute(requested));
  assert.equal(realpathSync(dirname(requested)), realpathSync(consumer));
  assert.match(basename(requested), /^signer-browser-[a-z0-9-]+$/);
  assert.equal(existsSync(requested), false, 'Keep successful and failed browser roots');
  return requested;
}
/** @param {string} root */
async function serveBrowser(root) {
  const server = createServer((req, res) => {
    try {
      const target = new URL(req.url ?? '/', 'http://localhost');
      if (!['GET', 'HEAD'].includes(req.method ?? '')) {
        res.writeHead(405).end();
        return;
      }
      let file = resolve(root, '.' + decodeURIComponent(target.pathname));
      if (target.pathname.endsWith('/')) file = join(root, 'index.html');
      if (!file.startsWith(root + sep) || !existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      const types = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.wasm': 'application/wasm',
        '.css': 'text/css',
      };
      res.setHeader(
        'content-type',
        types[/** @type {keyof typeof types} */ (extname(file))] ?? 'application/octet-stream',
      );
      res.setHeader('cache-control', 'no-store');
      res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
    } catch {
      res.writeHead(400).end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    origin: `http://localhost:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
    },
  };
}
/** Bound an async browser action; context shutdown cancels any remaining page work.
 * @template T @param {()=>Promise<T>} operation @param {number} [timeoutMs]
 */
export async function browserDeadline(operation, timeoutMs = 30000) {
  /** @type {NodeJS.Timeout|undefined} */ let timer;
  try {
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Browser case deadline exceeded')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
/** @param {NodeJS.ProcessEnv} [env] */
export async function runBrowserSigner(env = process.env) {
  assert.ok(env.IN_NIX_SHELL, 'Use pinned Nix');
  const signer = env.PASSPORT_SIGNER_ROOT ?? '',
    pin = env.PASSPORT_SIGNER_SHA256 ?? '';
  const input = verifyPublicSigner(signer, pin, repository);
  const output = browserOutput(env.PASSPORT_SIGNER_BROWSER_ROOT ?? '', input.consumer.root);
  const source = await workspaceIdentity(repository);
  assert.equal(source.dirty, false, 'Commit browser qualification source first');
  const require = createRequire(join(repository, 'apps/passport-dapp/package.json'));
  const { chromium } = require(require.resolve('playwright-core'));
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.ok(existsSync(chrome), 'This profile explicitly requires installed macOS Google Chrome');
  const chromeSha256 = consumerSha256(readFileSync(chrome));
  const playwrightIdentity = runtimeTreeIdentity(
    dirname(require.resolve('playwright-core/package.json')),
  );
  const polyfills = realpathSync(env.PASSPORT_SIGNER_BROWSER_POLYFILLS ?? '');
  const polyfillLockSha256 = consumerSha256(readFileSync(join(polyfills, 'pnpm-lock.yaml')));
  assert.equal(polyfillLockSha256, env.PASSPORT_SIGNER_BROWSER_POLYFILLS_SHA256);
  const polyfillIdentity = installedTreeIdentity(polyfills);
  mkdirSync(output, { mode: 0o700 });
  const entry = join(repository, 'tests/fixtures/public-signer-browser.js');
  copyFileSync(entry, join(output, 'main.js'));
  cpSync(join(signer, 'bundle'), join(output, 'prepared'), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  writeFileSync(
    join(output, 'index.html'),
    '<!doctype html><html><body><button id="start">Open signer</button><pre id="status"></pre><script type="module">import process from "process/browser";import {Buffer} from "buffer";globalThis.Buffer=Buffer;globalThis.process=process;await import("/main.js");</script></body></html>',
    { flag: 'wx', mode: 0o600 },
  );
  writeFileSync(
    join(output, 'vite.config.mjs'),
    `import {defineConfig}from'vite';import wasm from'vite-plugin-wasm';import {createRequire}from'node:module';import {dirname,join}from'node:path';const r=createRequire(import.meta.resolve('@input-output-hk/mn-passport-keys'));const b=createRequire(${JSON.stringify(join(polyfills, 'package.json'))} );const p=createRequire(new URL('../node_modules/.pnpm/node_modules/resolve.cjs',import.meta.url));export default defineConfig({define:{global:'globalThis'},resolve:{alias:{[p.resolve('@midnightntwrk/ledger-v9')]:join(dirname(p.resolve('@midnightntwrk/ledger-v9')),'midnight_ledger_wasm_v9.js'),'@noble/curves/misc.js':r.resolve('@noble/curves/misc.js'),'process/browser':p.resolve('process/browser.js'),'events':b.resolve('events/'),'assert':b.resolve('assert/'),'stream':b.resolve('stream-browserify'),'buffer':p.resolve('buffer/'),'rxjs/operators':p.resolve('rxjs/operators'),'rxjs/fetch':p.resolve('rxjs/fetch'),'rxjs':p.resolve('rxjs')}},plugins:[wasm()],build:{target:'esnext'}});\n`,
    { flag: 'wx', mode: 0o600 },
  );
  /** @type {string[]} */
  const cases = [];
  /** @type {any} */ let browser, dapp, signerServer, context, result;
  /** @type {string[]} */
  const pageErrors = [];
  let stage = 'build';
  let failureSha256,
    verdict = 'failed';
  /** @param {string} name @param {()=>Promise<void>} fn */
  const check = async (name, fn) => {
    stage = name;
    await browserDeadline(fn);
    cases.push(name);
  };
  try {
    const build = execFileSync(
      process.execPath,
      [join(input.consumer.root, 'node_modules/vite/bin/vite.js'), 'build'],
      { cwd: output, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
    );
    writeFileSync(join(output, 'build.private.log'), build, { flag: 'wx', mode: 0o600 });
    const assets = signerBundleTree(join(output, 'dist'));
    dapp = await serveBrowser(join(output, 'dist'));
    signerServer = await serveBrowser(join(output, 'dist'));
    browser = await chromium.launch({ executablePath: chrome, headless: true });
    stage = 'launch';
    context = await browser.newContext();
    context.setDefaultTimeout(20000);
    context.on('page', (/** @type {any} */ p) =>
      p.on('pageerror', (/** @type {Error} */ error) =>
        pageErrors.push(error.stack ?? error.message),
      ),
    );
    /** @type {any} */ const page = await context.newPage();
    stage = 'dapp-ready';
    await page.goto(dapp.origin + '/dapp/');
    await page.waitForFunction(() => /** @type {any} */ (globalThis).qualification?.ready);
    await page.evaluate((/** @type {string} */ url) => {
      /** @type {any} */ (globalThis).qualification.signerUrl = url;
    }, signerServer.origin + '/signer/');
    const popupPromise = context.waitForEvent('page');
    await page.locator('#start').click();
    /** @type {any} */ const popup = await popupPromise;
    await popup.waitForLoadState();
    const cdp = await context.newCDPSession(popup);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        hasPrf: true,
      },
    });
    let asserted = 0;
    cdp.on('WebAuthn.credentialAsserted', () => asserted++);
    stage = 'credential-enroll';
    await popup.locator('#start').click();
    await page.waitForFunction(
      () => /** @type {any} */ (globalThis).qualification.connected,
      {},
      { timeout: 30000 },
    );
    await check(
      'real popup completes cross-origin transferred-port handshake and virtual PRF',
      async () => {
        assert.notEqual(new URL(page.url()).origin, new URL(popup.url()).origin);
        const point = await page.evaluate(async () => {
          const p = await /** @type {any} */ (globalThis).qualification.signin();
          return { x: p.x.toString(), y: p.y.toString() };
        });
        assert.match(point.x, /^\d+$/);
        assert.ok(asserted > 0);
        assert.equal(
          await page.evaluate(() => localStorage.getItem('passport-qualification-credential')),
          null,
        );
      },
    );
    await check('declined browser consent invokes no PRF or operation', async () => {
      const before = asserted;
      await popup.evaluate(() => {
        /** @type {any} */ (globalThis).qualification.decision = 'reject';
      });
      const code = await page.evaluate(async () => {
        try {
          await /** @type {any} */ (globalThis).qualification.signin();
          return 'admitted';
        } catch (e) {
          return /** @type {any} */ (e).code;
        }
      });
      assert.equal(code, 'ceremony-cancelled');
      assert.equal(asserted, before);
      await popup.evaluate(() => {
        /** @type {any} */ (globalThis).qualification.decision = 'approve';
      });
    });
    await check('browser origin policy refuses before consent and PRF', async () => {
      const before = asserted,
        approvals = await popup.evaluate(
          () => /** @type {any} */ (globalThis).qualification.approvals.length,
        );
      await popup.evaluate(() => {
        /** @type {any} */ (globalThis).qualification.originAllowed = false;
      });
      const code = await page.evaluate(async () => {
        try {
          await /** @type {any} */ (globalThis).qualification.signin();
          return 'admitted';
        } catch (e) {
          return /** @type {any} */ (e).code;
        }
      });
      assert.equal(code, 'origin-denied');
      assert.equal(asserted, before);
      assert.equal(
        await popup.evaluate(() => /** @type {any} */ (globalThis).qualification.approvals.length),
        approvals,
      );
      await popup.evaluate(() => {
        /** @type {any} */ (globalThis).qualification.originAllowed = true;
      });
    });
    await check(
      'installed SDK add-device verifies real browser-handler signature against fake chain',
      async () => {
        result = await page.evaluate(() =>
          /** @type {any} */ (globalThis).qualification.exercise(),
        );
        assert.equal(result.calls, 1);
        assert.equal(result.nextUseCounter, '1');
        assert.equal(result.readerDelivery, false);
        const approval = await popup.evaluate(() =>
          /** @type {any} */ (globalThis).qualification.approvals.at(-1),
        );
        assert.deepEqual(approval.flow, {
          kind: 'add-device',
          account: 'ab'.repeat(32),
          commitmentHex: result.commitmentHex,
        });
      },
    );
    await check('unsupported browser-host consent remains refused without operation', async () => {
      assert.equal(
        await page.evaluate(() => /** @type {any} */ (globalThis).qualification.unsupported()),
        true,
      );
      assert.equal(
        await page.evaluate(() => /** @type {any} */ (globalThis).qualification.calls),
        1,
      );
    });
    await check('expired browser session refuses a late operation', async () => {
      await page.evaluate(() => {
        const q = /** @type {any} */ (globalThis).qualification;
        q.pending = q
          .scope()
          .then(() => 'admitted')
          .catch((/** @type {any} */ e) => e.code);
      });
      await page.waitForFunction(() => /** @type {any} */ (globalThis).qualification.held);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const code = await page.evaluate(async () => {
        const q = /** @type {any} */ (globalThis).qualification;
        q.release();
        return q.pending;
      });
      assert.equal(code, 'session-expired');
    });
    await check(
      'popup closure rejects pending approval and later requests without operation',
      async () => {
        await popup.evaluate(() => {
          /** @type {any} */ (globalThis).qualification.holdApproval = true;
        });
        await page.evaluate(() => {
          const q = /** @type {any} */ (globalThis).qualification;
          q.pending = q
            .signin()
            .then(() => 'admitted')
            .catch((/** @type {any} */ e) => e.code);
        });
        await popup.waitForFunction(
          () =>
            typeof (/** @type {any} */ (globalThis).qualification.releaseApproval) === 'function',
        );
        await popup.close();
        const code = await page.evaluate(
          () => /** @type {any} */ (globalThis).qualification.pending,
        );
        // Published SignerClosedError uses the ceremony-cancelled code.
        assert.equal(code, 'ceremony-cancelled');
        const later = await page.evaluate(async () => {
          try {
            await /** @type {any} */ (globalThis).qualification.request('device-public-key', {});
            return 'admitted';
          } catch (e) {
            return /** @type {any} */ (e).code;
          }
        });
        assert.equal(later, 'ceremony-cancelled');
        assert.equal(
          await page.evaluate(() => /** @type {any} */ (globalThis).qualification.calls),
          1,
        );
      },
    );
    verifyPublicSigner(signer, pin, repository);
    assert.deepEqual(signerBundleTree(join(output, 'dist')), assets);
    assert.equal(
      consumerSha256(readFileSync(entry)),
      consumerSha256(readFileSync(join(output, 'main.js'))),
    );
    assert.deepEqual(installedTreeIdentity(polyfills), polyfillIdentity);
    assert.equal(
      consumerSha256(readFileSync(join(polyfills, 'pnpm-lock.yaml'))),
      polyfillLockSha256,
    );
    assert.deepEqual(runtimeTreeIdentity(playwrightIdentity.path), playwrightIdentity);
    assert.equal(consumerSha256(readFileSync(chrome)), chromeSha256);
    assert.deepEqual(await workspaceIdentity(repository), source);
    verdict = 'passed';
    result = {
      cases,
      testsPassed: cases.length,
      virtualAssertions: asserted,
      chainCalls: 1,
      assets,
      browserVersion: browser.version(),
      chromeSha256,
      playwrightIdentity,
      polyfillLockSha256,
      polyfillIdentity,
    };
  } catch (error) {
    failureSha256 = consumerSha256(String(error));
    writeFileSync(
      join(output, 'failure.private.log'),
      stage + '\n' + String(error) + '\n' + pageErrors.join('\n') + '\n',
      {
        flag: 'wx',
        mode: 0o600,
      },
    );
  } finally {
    await context?.close();
    await browser?.close();
    await dapp?.close();
    await signerServer?.close();
  }
  const receipt = {
    schemaVersion: 1,
    kind: 'public-signer-browser',
    outcome: verdict,
    source,
    signerConfigSha256: pin,
    publicSource: input.source.commit,
    consumerConfigSha256: input.consumer.configSha256,
    result,
    failureSha256,
    actualBrowser: true,
    actualPopup: true,
    virtualAuthenticator: true,
    realHandlers: true,
    simulatedWindowRouting: false,
    fakeChain: true,
    nativeProof: false,
    realProvider: false,
    productionSignerPage: false,
    releaseQualified: false,
  };
  writeFileSync(join(output, 'browser-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(JSON.stringify(receipt, null, 2));
  assert.equal(verdict, 'passed', 'Inspect private failure log; preserve browser root');
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) await runBrowserSigner();
