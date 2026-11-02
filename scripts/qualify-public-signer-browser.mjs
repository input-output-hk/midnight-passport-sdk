#!/usr/bin/env node
// Browser protocol lane only: no chain, wallet, Docker, real provider or production page claim.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  lstatSync,
  readlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { verifyPublicSigner, signerBundleTree } from './consumer/public-signer-source.mjs';
import { installedTreeIdentity, runtimeTreeIdentity } from './consumer/host-retained.mjs';
import { consumerSha256 } from './consumer-inputs.mjs';
import { workspaceIdentity } from './qualification/receipt.mjs';
import { BrowserOwnership } from './qualification/browser-ownership.mjs';
const repository = resolve(import.meta.dirname, '..');
/** @param {string} requested @param {string} consumer */
export function browserOutput(requested, consumer) {
  assert.ok(isAbsolute(requested));
  assert.equal(realpathSync(dirname(requested)), realpathSync(consumer));
  assert.match(basename(requested), /^signer-browser-[a-z0-9-]+$/);
  assert.equal(existsSync(requested), false, 'Keep successful and failed browser roots');
  return requested;
}
/** @param {string} root @param {string} [allowedOrigin] */
async function serveBrowser(root, allowedOrigin = '') {
  const server = createServer((req, res) => {
    try {
      const target = new URL(req.url ?? '/', 'http://localhost');
      if (!['GET', 'HEAD'].includes(req.method ?? '')) {
        res.writeHead(405).end();
        return;
      }
      if (target.pathname === '/qualification-config.js') {
        res.setHeader('content-type', 'text/javascript');
        res.setHeader('cache-control', 'no-store');
        res.end(
          '(/** @type {any} */ (globalThis)).qualificationAllowedOrigin=' +
            JSON.stringify(allowedOrigin) +
            ';',
        );
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
 * @template T @param {()=>Promise<T>} operation @param {number} [timeoutMs] @param {AbortSignal} [signal]
 */
export async function browserDeadline(operation, timeoutMs = 30000, signal) {
  /** @type {NodeJS.Timeout|undefined} */ let timer;
  /** @type {(()=>void)|undefined} */ let onAbort;
  try {
    if (signal?.aborted) throw Error('Browser qualification interrupted');
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        onAbort = () => reject(Error('Browser qualification interrupted'));
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Browser case deadline exceeded')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}
/** Hash the actual framework, helpers and resources; bind internal symlinks without following them.
 * @param {string} requested
 */
export function browserRuntimeIdentity(requested) {
  const root = realpathSync(requested),
    hash = createHash('sha256');
  let files = 0,
    links = 0;
  /** @param {string} relative */
  const walk = (relative) => {
    const path = join(root, relative),
      stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      const target = realpathSync(path);
      assert.ok(target.startsWith(root + sep), 'Browser runtime link escapes its tree');
      hash.update('link\0' + relative + '\0' + readlinkSync(path) + '\n');
      links++;
    } else if (stat.isDirectory())
      for (const name of readdirSync(path).sort()) walk(relative ? relative + '/' + name : name);
    else {
      assert.ok(stat.isFile());
      hash.update('file\0' + relative + '\0' + consumerSha256(readFileSync(path)) + '\n');
      files++;
    }
  };
  walk('');
  assert.ok(files > 0);
  return { path: root, files, links, treeSha256: hash.digest('hex') };
}
/** Close every owned resource even if another close rejects or hangs.
 * @param {Array<{name:string,close:()=>Promise<unknown>}>} actions @param {number} [timeoutMs]
 */
export async function browserCleanup(actions, timeoutMs = 5000) {
  /** @type {Array<{name:string,closed:boolean,errorSha256?:string}>} */ const results = [];
  for (const action of actions) {
    try {
      await browserDeadline(action.close, timeoutMs);
      results.push({ name: action.name, closed: true });
    } catch (error) {
      results.push({
        name: action.name,
        closed: false,
        errorSha256: consumerSha256(String(error)),
      });
    }
  }
  return results;
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
  const framework = join(
    dirname(chrome),
    '../Frameworks/Google Chrome Framework.framework/Versions/Current',
  );
  const frameworkIdentity = browserRuntimeIdentity(framework);
  const playwrightIdentity = runtimeTreeIdentity(
    dirname(require.resolve('playwright-core/package.json')),
  );
  const polyfills = realpathSync(env.PASSPORT_SIGNER_BROWSER_POLYFILLS ?? '');
  const polyfillLockSha256 = consumerSha256(readFileSync(join(polyfills, 'pnpm-lock.yaml')));
  assert.equal(polyfillLockSha256, env.PASSPORT_SIGNER_BROWSER_POLYFILLS_SHA256);
  const polyfillIdentity = installedTreeIdentity(polyfills);
  const fault = env.PASSPORT_SIGNER_BROWSER_FAULT ?? '';
  assert.ok(['', 'interrupt-after-launch'].includes(fault));
  mkdirSync(output, { mode: 0o700 });
  writeFileSync(
    join(output, 'attempt-start.json'),
    JSON.stringify(
      {
        kind: 'public-signer-browser-attempt',
        source,
        signerConfigSha256: pin,
        consumerConfigSha256: input.consumer.configSha256,
        fault,
        outcome: 'started',
        releaseQualified: false,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600, flush: true },
  );
  const entry = join(repository, 'tests/fixtures/public-signer-browser.js');
  copyFileSync(entry, join(output, 'main.js'));
  copyFileSync(
    join(repository, 'scripts/qualification/secret-scan.mjs'),
    join(output, 'secret-scan.mjs'),
  );
  cpSync(join(signer, 'bundle'), join(output, 'prepared'), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  assert.deepEqual(
    signerBundleTree(join(output, 'prepared')),
    input.bundle,
    'Copied signer bundle changed',
  );
  writeFileSync(
    join(output, 'index.html'),
    '<!doctype html><html><body><button id="start">Open signer</button><pre id="status"></pre><script src="/qualification-config.js"></script><script type="module">import process from "process/browser";import {Buffer} from "buffer";globalThis.Buffer=Buffer;globalThis.process=process;await import("/main.js");</script></body></html>',
    { flag: 'wx', mode: 0o600 },
  );
  writeFileSync(
    join(output, 'vite.config.mjs'),
    `import {defineConfig}from'vite';import wasm from'vite-plugin-wasm';import {createRequire}from'node:module';import {dirname,join}from'node:path';const r=createRequire(import.meta.resolve('@input-output-hk/mn-passport-keys'));const b=createRequire(${JSON.stringify(join(polyfills, 'package.json'))} );const p=createRequire(new URL('../node_modules/.pnpm/node_modules/resolve.cjs',import.meta.url));export default defineConfig({define:{global:'globalThis'},resolve:{alias:{[p.resolve('@midnightntwrk/ledger-v9')]:join(dirname(p.resolve('@midnightntwrk/ledger-v9')),'midnight_ledger_wasm_v9.js'),'@noble/curves/misc.js':r.resolve('@noble/curves/misc.js'),'process/browser':p.resolve('process/browser.js'),'events':b.resolve('events/'),'assert':b.resolve('assert/'),'stream':b.resolve('stream-browserify'),'node:buffer':p.resolve('buffer/'),'buffer':p.resolve('buffer/'),'rxjs/operators':p.resolve('rxjs/operators'),'rxjs/fetch':p.resolve('rxjs/fetch'),'rxjs':p.resolve('rxjs')}},plugins:[wasm()],build:{target:'esnext'}});\n`,
    { flag: 'wx', mode: 0o600 },
  );
  /** @type {string[]} */
  const cases = [];
  /** @type {any} */ let browser;
  /** @type {any} */ let dapp;
  /** @type {any} */ let signerServer;
  /** @type {any} */ let attackerServer;
  /** @type {any} */ let context;
  /** @type {any} */ let result;
  /** @type {string[]} */
  const pageErrors = [];
  let stage = 'build',
    popupOpened = false,
    virtualAuthenticator = false;
  const ownership = new BrowserOwnership([
    'context',
    'browser',
    'dapp-server',
    'signer-server',
    'attacker-server',
  ]);
  const aborted = new AbortController();
  const interrupt = () => aborted.abort();
  process.on('SIGTERM', interrupt);
  process.on('SIGINT', interrupt);
  let browserVersion;
  /** @type {Awaited<ReturnType<BrowserOwnership['cleanup']>>} */ let cleanup = [];
  let settledStage, settledCases;
  let failureSha256,
    verdict = 'failed';
  /** @param {string} name @param {()=>Promise<void>} fn */
  const check = async (name, fn) => {
    ownership.guard();
    stage = name;
    await browserDeadline(fn, 30000, aborted.signal);
    ownership.guard();
    cases.push(name);
  };
  try {
    await browserDeadline(
      async () => {
        const build = execFileSync(
          process.execPath,
          [join(input.consumer.root, 'node_modules/vite/bin/vite.js'), 'build'],
          { cwd: output, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 },
        );
        writeFileSync(join(output, 'build.private.log'), build, { flag: 'wx', mode: 0o600 });
        const assets = signerBundleTree(join(output, 'dist'));
        stage = 'serve';
        dapp = await ownership.acquire(
          'dapp-server',
          () => serveBrowser(join(output, 'dist')),
          (s) => s.close(),
        );
        signerServer = await ownership.acquire(
          'signer-server',
          () => serveBrowser(join(output, 'dist'), dapp.origin),
          (s) => s.close(),
        );
        stage = 'launch';
        // This runner owns signal cleanup; Playwright's default handlers would race it.
        browser = await ownership.acquire(
          'browser',
          () =>
            chromium.launch({
              executablePath: chrome,
              headless: true,
              handleSIGINT: false,
              handleSIGTERM: false,
            }),
          (b) => b.close(),
        );
        browserVersion = browser.version();
        context = await ownership.acquire(
          'context',
          () => browser.newContext(),
          (c) => c.close(),
        );
        context.setDefaultTimeout(20000);
        if (fault === 'interrupt-after-launch') process.kill(process.pid, 'SIGTERM');
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
          const q = /** @type {any} */ (globalThis).qualification;
          q.signerUrl = url;
          q.deferConnect = true;
        }, signerServer.origin + '/signer/');
        const popupPromise = context.waitForEvent('page');
        await page.locator('#start').click();
        /** @type {any} */ const popup = await popupPromise;
        popupOpened = true;
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
        virtualAuthenticator = true;
        /** @type {{x:string,y:string}|undefined} */ let originalPoint;
        let asserted = 0;
        cdp.on('WebAuthn.credentialAsserted', () => asserted++);
        stage = 'credential-enroll';
        await popup.locator('#start').click();
        await popup.waitForFunction(() => /** @type {any} */ (globalThis).qualification?.ready);
        await check('same-origin non-opener hello cannot capture the signer port', async () => {
          const frameReady = popup.waitForEvent(
            'framenavigated',
            (/** @type {any} */ f) => f.url() === dapp.origin + '/dapp/?attack-hello=1',
          );
          await popup.evaluate((/** @type {string} */ origin) => {
            const document = /** @type {any} */ (globalThis).document;
            const frame = document.createElement('iframe');
            frame.src = origin + '/dapp/?attack-hello=1';
            frame.id = 'wrong-source';
            document.body.append(frame);
          }, dapp.origin);
          const frame = await frameReady;
          assert.ok(frame);
          await frame.waitForFunction(
            () => /** @type {any} */ (globalThis).qualification?.attackSent,
          );
          await popup.waitForFunction(
            () => /** @type {any} */ (globalThis).qualification.nonOpenerHellos === 1,
          );
          assert.equal(
            await popup.evaluate(
              () => /** @type {any} */ (globalThis).qualification.nonOpenerOrigin,
            ),
            dapp.origin,
          );
          assert.deepEqual(
            await frame.evaluate(() => /** @type {any} */ (globalThis).qualification.attackReplies),
            [],
          );
          assert.equal(
            await popup.evaluate(
              () => /** @type {any} */ (globalThis).qualification.approvals.length,
            ),
            0,
          );
          assert.equal(asserted, 0);
          await page.evaluate(() => /** @type {any} */ (globalThis).qualification.connectNow());
          await page.waitForFunction(() => /** @type {any} */ (globalThis).qualification.connected);
          await frame.evaluate(() => /** @type {any} */ (globalThis).qualification.closeAttack());
          await popup.evaluate(() =>
            /** @type {any} */ (globalThis).document.querySelector('#wrong-source')?.remove(),
          );
        });
        await check(
          'real popup completes cross-origin transferred-port handshake and virtual PRF',
          async () => {
            assert.notEqual(new URL(page.url()).origin, new URL(popup.url()).origin);
            const point = await page.evaluate(async () => {
              const p = await /** @type {any} */ (globalThis).qualification.signin();
              return { x: p.x.toString(), y: p.y.toString() };
            });
            originalPoint = point;
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
            await popup.evaluate(
              () => /** @type {any} */ (globalThis).qualification.approvals.length,
            ),
            approvals,
          );
          await popup.evaluate(() => {
            /** @type {any} */ (globalThis).qualification.originAllowed = true;
          });
        });
        await check(
          'installed SDK add-device verifies real browser-handler signature against fake chain',
          async () => {
            const exerciseResult = await page.evaluate(() =>
              /** @type {any} */ (globalThis).qualification.exercise(),
            );
            assert.equal(exerciseResult.calls, 1);
            assert.equal(exerciseResult.nextUseCounter, '1');
            assert.equal(exerciseResult.readerDelivery, false);
            const approval = await popup.evaluate(() =>
              /** @type {any} */ (globalThis).qualification.approvals.at(-1),
            );
            assert.deepEqual(approval.flow, {
              kind: 'add-device',
              account: 'ab'.repeat(32),
              commitmentHex: exerciseResult.commitmentHex,
            });
          },
        );
        await check(
          'local SDK adapter refuses unsupported descriptors before browser request',
          async () => {
            const approvals = await popup.evaluate(
                () => /** @type {any} */ (globalThis).qualification.approvals.length,
              ),
              before = asserted;
            assert.equal(
              await page.evaluate(() =>
                /** @type {any} */ (globalThis).qualification.unsupported(),
              ),
              true,
            );
            assert.equal(
              await popup.evaluate(
                () => /** @type {any} */ (globalThis).qualification.approvals.length,
              ),
              approvals,
            );
            assert.equal(asserted, before);
            assert.equal(
              await page.evaluate(() => /** @type {any} */ (globalThis).qualification.calls),
              1,
            );
          },
        );
        for (const [name, payload] of [
          ['missing flow', {}],
          [
            'malformed account descriptor',
            {
              flow: {
                kind: 'add-device',
                account: 'not-an-account',
                commitmentHex: 'dc'.repeat(32),
              },
            },
          ],
        ])
          await check(name + ' is refused before PRF or chain work', async () => {
            const before = asserted;
            const code = await page.evaluate(async (/** @type {any} */ payload) => {
              try {
                await /** @type {any} */ (globalThis).qualification.request('flow-open', payload);
                return 'admitted';
              } catch (error) {
                return /** @type {any} */ (error).code;
              }
            }, payload);
            assert.equal(code, 'malformed-payload');
            assert.equal(asserted, before);
          });
        for (const field of ['account', 'circuit', 'commitment'])
          await check('approved flow refuses only changed ' + field, async () => {
            assert.equal(
              await page.evaluate(
                (/** @type {string} */ field) =>
                  /** @type {any} */ (globalThis).qualification.scopeProbe(field),
                field,
              ),
              'flow-scope',
            );
            assert.equal(
              await page.evaluate(() => /** @type {any} */ (globalThis).qualification.calls),
              1,
            );
          });
        await check('concurrent opening is busy before a second approval or PRF', async () => {
          const before = asserted;
          const approvals = await popup.evaluate(
            () => /** @type {any} */ (globalThis).qualification.approvals.length,
          );
          await popup.evaluate(() => {
            /** @type {any} */ (globalThis).qualification.holdApproval = true;
          });
          await page.evaluate(() => {
            const q = /** @type {any} */ (globalThis).qualification;
            q.pending = q
              .request('flow-open', { flow: { kind: 'sign-in' } })
              .then(() => 'admitted')
              .catch((/** @type {any} */ e) => e.code);
          });
          await popup.waitForFunction(
            () =>
              typeof (/** @type {any} */ (globalThis).qualification.releaseApproval) === 'function',
          );
          const code = await page.evaluate(async () => {
            try {
              await /** @type {any} */ (globalThis).qualification.request('flow-open', {
                flow: { kind: 'sign-in' },
              });
              return 'admitted';
            } catch (error) {
              return /** @type {any} */ (error).code;
            }
          });
          assert.equal(code, 'signer-busy');
          assert.equal(asserted, before);
          assert.equal(
            await popup.evaluate(
              () => /** @type {any} */ (globalThis).qualification.approvals.length,
            ),
            approvals + 1,
          );
          await popup.evaluate(() => {
            const q = /** @type {any} */ (globalThis).qualification;
            q.decision = 'reject';
            q.holdApproval = false;
            q.releaseApproval();
            q.releaseApproval = undefined;
          });
          assert.equal(
            await page.evaluate(() => /** @type {any} */ (globalThis).qualification.pending),
            'ceremony-cancelled',
          );
          await popup.evaluate(() => {
            /** @type {any} */ (globalThis).qualification.decision = 'approve';
          });
        });
        await check(
          'callback failure closes failed flow and never replays chain work',
          async () => {
            assert.equal(
              await page.evaluate(() =>
                /** @type {any} */ (globalThis).qualification.callbackFailure(),
              ),
              true,
            );
            const code = await page.evaluate(async () => {
              try {
                await /** @type {any} */ (globalThis).qualification.request(
                  'device-public-key',
                  {},
                );
                return 'admitted';
              } catch (error) {
                return /** @type {any} */ (error).code;
              }
            });
            assert.equal(code, 'key-session-required');
            assert.equal(
              await page.evaluate(() => /** @type {any} */ (globalThis).qualification.calls),
              1,
            );
          },
        );
        await check(
          'declared PRF encodings stay in signer origin across public responses',
          async () => {
            const scan = await popup.evaluate(() => {
              const q = /** @type {any} */ (globalThis).qualification;
              return {
                scanned: q.scannedResponses,
                secrets: q.protectedRepresentations,
                failed: q.secretFailure,
              };
            });
            assert.ok(scan.scanned > 0 && scan.secrets > 0);
            assert.equal(scan.failed, false);
            assert.equal(
              await page.evaluate(() =>
                /** @type {any} */ (globalThis).qualification.originIsolationProbe(),
              ),
              true,
            );
          },
        );
        await check('signer navigation does not replay completed chain work', async () => {
          const before = asserted;
          await popup.goto(signerServer.origin + '/signer/?navigated=1');
          await popup.waitForFunction(() => /** @type {any} */ (globalThis).qualification?.ready);
          assert.equal(asserted, before);
          assert.equal(
            await popup.evaluate(
              () => /** @type {any} */ (globalThis).qualification.approvals.length,
            ),
            0,
          );
          assert.equal(
            await page.evaluate(() => /** @type {any} */ (globalThis).qualification.calls),
            1,
          );
        });
        await check(
          'explicit fresh-client reconnect requires consent and preserves virtual device key',
          async () => {
            await page.evaluate(() => {
              /** @type {any} */ (globalThis).qualification.deferConnect = false;
            });
            await page.locator('#start').click();
            await page.waitForFunction(
              () => /** @type {any} */ (globalThis).qualification.connected,
            );
            const before = asserted;
            const point = await page.evaluate(async () => {
              const p = await /** @type {any} */ (globalThis).qualification.signin();
              return { x: p.x.toString(), y: p.y.toString() };
            });
            assert.deepEqual(point, originalPoint);
            assert.ok(asserted > before);
            assert.equal(
              await page.evaluate(() => /** @type {any} */ (globalThis).qualification.calls),
              1,
            );
            assert.equal(
              await popup.evaluate(
                () => /** @type {any} */ (globalThis).qualification.approvals.at(-1)?.flow?.kind,
              ),
              'sign-in',
            );
          },
        );
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
                typeof (/** @type {any} */ (globalThis).qualification.releaseApproval) ===
                'function',
            );
            await popup.close();
            const code = await page.evaluate(
              () => /** @type {any} */ (globalThis).qualification.pending,
            );
            // Published SignerClosedError uses the ceremony-cancelled code.
            assert.equal(code, 'ceremony-cancelled');
            await page.evaluate(() => /** @type {any} */ (globalThis).qualification.close());
            const later = await page.evaluate(async () => {
              try {
                await /** @type {any} */ (globalThis).qualification.request(
                  'device-public-key',
                  {},
                );
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
        await check('actual wrong opener origin is refused before consent and PRF', async () => {
          attackerServer = await ownership.acquire(
            'attacker-server',
            () => serveBrowser(join(output, 'dist')),
            (s) => s.close(),
          );
          const attacker = await context.newPage();
          await attacker.goto(attackerServer.origin + '/dapp/');
          await attacker.waitForFunction(
            () => /** @type {any} */ (globalThis).qualification?.ready,
          );
          await attacker.evaluate((/** @type {string} */ url) => {
            const q = /** @type {any} */ (globalThis);
            q.qualification.signerUrl = url;
          }, signerServer.origin + '/signer/');
          const opened = context.waitForEvent('page');
          await attacker.locator('#start').click();
          const deniedPopup = await opened;
          await attacker.waitForFunction(
            () => /** @type {any} */ (globalThis).qualification.connected,
          );
          const code = await attacker.evaluate(async () => {
            try {
              await /** @type {any} */ (globalThis).qualification.signin();
              return 'admitted';
            } catch (e) {
              return /** @type {any} */ (e).code;
            }
          });
          assert.equal(code, 'origin-denied');
          assert.equal(
            await deniedPopup.evaluate(
              () => /** @type {any} */ (globalThis).qualification.approvals.length,
            ),
            0,
          );
          assert.equal(
            await deniedPopup.evaluate(
              () => /** @type {any} */ (globalThis).qualification.assertions,
            ),
            0,
          );
          assert.equal(
            await attacker.evaluate(() => /** @type {any} */ (globalThis).qualification.calls),
            0,
          );
          await attacker.evaluate(() => /** @type {any} */ (globalThis).qualification.close());
          await attacker.close();
        });
        ownership.guard();
        stage = 'final-integrity';
        verifyPublicSigner(signer, pin, repository);
        assert.deepEqual(signerBundleTree(join(output, 'prepared')), input.bundle);
        assert.deepEqual(browserRuntimeIdentity(framework), frameworkIdentity);
        assert.equal(browser.version(), browserVersion);
        assert.deepEqual(signerBundleTree(join(output, 'dist')), assets);
        assert.equal(
          consumerSha256(readFileSync(entry)),
          consumerSha256(readFileSync(join(output, 'main.js'))),
        );
        assert.equal(
          consumerSha256(readFileSync(join(output, 'secret-scan.mjs'))),
          consumerSha256(readFileSync(join(repository, 'scripts/qualification/secret-scan.mjs'))),
        );
        assert.deepEqual(installedTreeIdentity(polyfills), polyfillIdentity);
        assert.equal(
          consumerSha256(readFileSync(join(polyfills, 'pnpm-lock.yaml'))),
          polyfillLockSha256,
        );
        assert.deepEqual(runtimeTreeIdentity(playwrightIdentity.path), playwrightIdentity);
        assert.equal(consumerSha256(readFileSync(chrome)), chromeSha256);
        assert.deepEqual(await workspaceIdentity(repository), source);
        result = {
          cases,
          testsPassed: cases.length,
          virtualAssertions: asserted,
          chainCalls: 1,
          assets,
          browserVersion: browser.version(),
          chromeSha256,
          frameworkIdentity: {
            files: frameworkIdentity.files,
            links: frameworkIdentity.links,
            treeSha256: frameworkIdentity.treeSha256,
            pathSha256: consumerSha256(frameworkIdentity.path),
          },
          playwrightIdentity: {
            files: playwrightIdentity.files,
            treeSha256: playwrightIdentity.treeSha256,
            pathSha256: consumerSha256(playwrightIdentity.path),
          },
          polyfillLockSha256,
          polyfillIdentity,
        };
      },
      180000,
      aborted.signal,
    );
    verdict = 'passed';
    stage = 'complete';
  } catch (error) {
    ownership.settled = true;
    aborted.abort();
    settledStage = stage;
    settledCases = [...cases];
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
    cleanup = await ownership.cleanup();
    if (cleanup.some((c) => c.closed === false)) verdict = 'failed';
    process.off('SIGTERM', interrupt);
    process.off('SIGINT', interrupt);
  }
  const receipt = {
    schemaVersion: 1,
    kind: 'public-signer-browser',
    fault,
    outcome: verdict,
    source,
    signerConfigSha256: pin,
    publicSource: input.source.commit,
    consumerConfigSha256: input.consumer.configSha256,
    completedCases: settledCases ?? [...cases],
    stage: settledStage ?? stage,
    cleanup,
    result: verdict === 'passed' ? result : undefined,
    failureSha256,
    actualBrowser: Boolean(browser),
    actualPopup: popupOpened,
    virtualAuthenticator,
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
