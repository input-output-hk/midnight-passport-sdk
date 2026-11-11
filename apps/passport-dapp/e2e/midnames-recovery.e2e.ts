// Native chain and real demo recovery UI. Only account login and loss of the sponsor's
// HTTP response are fixtures. The isolated native runner owns the one chain submission.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Page } from 'playwright-core';
import { createServer } from 'vite';
import { claimReceipt } from '../src/midnames/claim-receipt.js';
import { reveal } from './journeys/ui.js';

assert.equal(process.env.PASSPORT_MIDNAMES_NATIVE, '1');
assert.ok(process.argv[2]);
const output = resolve(process.argv[2]);
const original = claimReceipt(
  JSON.parse(readFileSync(resolve(output, 'original-claim.json'), 'utf8')),
);
const indexer = 'http://127.0.0.1:18108/api/v4/graphql';
assert.equal(process.env.MN_INDEXER_URL, indexer);
assert.equal(process.env.MN_INDEXER_WS_URL, 'ws://127.0.0.1:18108/api/v4/graphql/ws');
const file = (name: string) => resolve(output, name);
Object.assign(process.env, {
  PASSPORT_MANIFEST_SHA256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  PASSPORT_NETWORK_ID: 'undeployed',
  VITE_MIDNAMES_REGISTRY_PROFILE: 'standalone-0.35',
  VITE_MIDNAMES_REGISTRY_ADDRESS: original.registryAddress,
  VITE_MIDNAMES_NAMESPACE: 'night',
  VITE_MIDNAMES_NETWORK_ID: 'undeployed',
  VITE_MIDNAMES_INDEXER_URL: indexer,
  VITE_MIDNAMES_INDEXER_WS_URL: process.env.MN_INDEXER_WS_URL,
});
const manifest = process.env.PASSPORT_MANIFEST_SHA256;
const connector = `
  export const ARM = 'p256', SIGNING_MODE = 'passkey', NETWORK_ID = 'undeployed';
  export const BINDING_ID = 'acc-s3r1.1', RP_ID = 'localhost';
  export const ORIGIN = location.origin, SERVICE_URL = location.origin, MANIFEST_SHA256 = ${JSON.stringify(manifest)};
  export const exportDemoGrantOpening = async () => { throw Error('Outside claim fixture'); };
  export const connect = async () => ({
    async openAccount() {
      const alternate = new URLSearchParams(location.search).has('alternate');
      return {
        scheme: 'p256-webauthn', networkId: NETWORK_ID, bindingId: BINDING_ID,
        address: ${JSON.stringify(original.accountAddress)},
        credentialId: new Uint8Array(32).fill(alternate ? 2 : 1),
        async state() {
          return { specVersion: 3, booted: true, authNonce: 0n, deviceEpoch: 0n, entryCount: 1 };
        },
      };
    },
  });
  export function installShim() { window.midnight = { passport: { connect } }; }
`;

const vite = await createServer({
  root: process.cwd(),
  cacheDir: file('vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  plugins: [
    {
      name: 'midnames-recovery-fixture',
      enforce: 'pre',
      load(id) {
        if (id.split('?')[0] === resolve('src/connector.ts')) return connector;
      },
    },
  ],
});

const messages = {
  available: /^Unregistered at the last registry read/,
  saved: /^Original receipt saved/,
  pending: /^Claim pending/,
  confirmed: /^Registered\./,
  refused: /^Claim check unavailable/,
};
let indexerRequests = 0;
let submissionRequests = 0;
async function openPage(page: Page, origin: string, alternate = false) {
  page.on('request', (request) => {
    if (request.url() === indexer) {
      assert.equal(request.method(), 'POST');
      const query: unknown = request.postDataJSON().query;
      assert.ok(typeof query === 'string' && query.startsWith('query'));
      indexerRequests++;
    }
    if (request.url().endsWith('/__drop-claim-response')) submissionRequests++;
  });
  page.on('pageerror', (error) => console.error('Demo page:', error.message));
  await page.goto(origin + (alternate ? '/?alternate' : '/'));
  await page
    .locator('#status')
    .filter({ hasText: /^Ready\./ })
    .waitFor({ state: 'attached' });
  await page.locator('#open').click();
  await page
    .locator('#workspace-account')
    .waitFor()
    .catch(async (error: unknown) => {
      console.error('Demo login:', await page.locator('#status').textContent());
      throw error;
    });
  await reveal(page, '#claim-recovery');
  await page.locator('#claim-recovery-name').fill(original.name);
}

const status = (page: Page, message: RegExp) =>
  page.locator('#claim-recovery-status').filter({ hasText: message }).waitFor({ timeout: 120_000 });
const openBrowser = () =>
  chromium.launchPersistentContext(file('chrome-profile'), {
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
try {
  await vite.listen();
  const origin = vite.resolvedUrls?.local[0]?.replace(/\/$/, '');
  assert.ok(origin);
  browser = await openBrowser();
  const first = await browser.newPage();
  await openPage(first, origin);
  await first.locator('#claim-check-availability').click();
  await status(first, messages.available);
  const checking = await browser.newPage();
  await openPage(checking, origin);
  let releaseRead = () => {};
  const permitRead = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  let interrupted = false;
  await checking.route(indexer, async (route) => {
    if (route.request().method() === 'POST' && !interrupted) {
      interrupted = true;
      await permitRead;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  const registryReadStarted = checking.waitForRequest(
    (request) => request.url() === indexer && request.method() === 'POST',
  );
  try {
    await checking.locator('#claim-check-availability').click();
    await registryReadStarted;
    await first.locator('#claim-recovery-receipt').fill(JSON.stringify(original));
    await first.locator('#claim-recovery-retain').click();
    await status(first, messages.saved);
  } finally {
    releaseRead();
  }
  await status(checking, messages.pending);
  await checking.close();
  await first.locator('#claim-check-availability').click();
  await status(first, messages.pending);

  await first.route('**/__drop-claim-response', async (route) => {
    assert.equal(route.request().method(), 'POST');
    writeFileSync(file('allow-original-submit'), '', { flag: 'wx' });
    const deadline = Date.now() + 120_000;
    while (!existsSync(file('original-response-lost')) && Date.now() < deadline) await delay(250);
    await route.abort('failed');
  });
  assert.equal(
    await first.evaluate(async () => {
      try {
        await fetch('/__drop-claim-response', { method: 'POST' });
        return 'received';
      } catch {
        return 'lost';
      }
    }),
    'lost',
  );
  assert.ok(existsSync(file('original-response-lost')));
  await browser.close();
  browser = await openBrowser();

  const wrong = await browser.newPage();
  await openPage(wrong, origin, true);
  await wrong.locator('#claim-check-availability').click();
  await status(wrong, messages.refused);

  const recovered = await browser.newPage();
  await openPage(recovered, origin);
  const deadline = Date.now() + 120_000;
  while (true) {
    await recovered.locator('#claim-recovery-check').click();
    const result = recovered.locator('#claim-recovery-status');
    await result
      .filter({ hasText: /^(Registered\.|Claim pending|Claim check unavailable)/ })
      .waitFor();
    if (messages.confirmed.test(await result.innerText())) break;
    assert.ok(Date.now() < deadline, await result.innerText());
    await delay(1500);
  }
  assert.equal(submissionRequests, 1);
  assert.ok(indexerRequests > 0);
  writeFileSync(
    file('browser-claim-recovery.json'),
    JSON.stringify(
      {
        lostResponse: true,
        originalDigest: original.transaction.sha256,
        recoveredAfterBrowserRestart: true,
        alternateCredentialRefused: true,
        browserSubmissionRequests: submissionRequests,
        liveIndexerRequests: indexerRequests,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
} finally {
  await browser?.close();
  await vite.close();
}
