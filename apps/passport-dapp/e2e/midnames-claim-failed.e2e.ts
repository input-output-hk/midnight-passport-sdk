// The isolated runner has already submitted one paid original and observed its
// exact indexed claim-segment failure. This browser must release that original
// against the same live registry/indexer before the runner prepares a retry.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
const connector = `
  export const ARM = 'p256', SIGNING_MODE = 'passkey', NETWORK_ID = 'undeployed';
  export const BINDING_ID = 'acc-s3r1.1', RP_ID = 'localhost';
  export const ORIGIN = location.origin, SERVICE_URL = location.origin;
  export const MANIFEST_SHA256 = ${JSON.stringify(process.env.PASSPORT_MANIFEST_SHA256)};
  export const exportDemoGrantOpening = async () => { throw Error('Outside claim fixture'); };
  export const connect = async () => ({ async openAccount() { return {
    scheme: 'p256-webauthn', networkId: NETWORK_ID, bindingId: BINDING_ID,
    address: ${JSON.stringify(original.accountAddress)},
    credentialId: new Uint8Array(32).fill(1),
    async state() { return { specVersion: 3, booted: true, authNonce: 0n, deviceEpoch: 0n, entryCount: 1 }; },
  }; } });
  export function installShim() { window.midnight = { passport: { connect } }; }
`;
const vite = await createServer({
  root: process.cwd(),
  cacheDir: resolve(output, 'vite-cache-failed-release'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [
    {
      name: 'midnames-failed-claim-fixture',
      enforce: 'pre',
      load(id) {
        if (id.split('?')[0] === resolve('src/connector.ts')) return connector;
      },
    },
  ],
});

const openBrowser = () =>
  chromium.launchPersistentContext(resolve(output, 'chrome-profile-failed-release'), {
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
async function openClaim(page: Page, origin: string) {
  await page.goto(origin);
  await page
    .locator('#status')
    .filter({ hasText: /^Ready\./ })
    .waitFor();
  await page.locator('#open').click();
  await page.locator('#workspace-account').waitFor();
  await reveal(page, '#claim-recovery');
  await page.locator('#claim-recovery-name').fill(original.name);
}
const status = (page: Page, expected: RegExp) =>
  page
    .locator('#claim-recovery-status')
    .filter({ hasText: expected })
    .waitFor({ timeout: 120_000 });

let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
let liveIndexerRequests = 0;
try {
  await vite.listen();
  const origin = vite.resolvedUrls?.local[0]?.replace(/\/$/, '');
  assert.ok(origin);
  browser = await openBrowser();
  const page = await browser.newPage();
  page.on('request', (request) => {
    if (request.url() === indexer) {
      assert.equal(request.method(), 'POST');
      liveIndexerRequests++;
    }
  });
  await openClaim(page, origin);
  await page.locator('#claim-recovery-receipt').fill(JSON.stringify(original));
  await page.locator('#claim-recovery-retain').click();
  await status(page, /^Original receipt saved/);
  await page.locator('#claim-recovery-check').click();
  await status(page, /^The exact registration claim failed while the sponsor fee succeeded/);
  assert.equal(await page.locator('#claim-release-failed').isVisible(), true);
  await page.locator('#claim-release-failed').click();
  await status(page, /^Failed original retained in local history/);
  assert.ok(liveIndexerRequests >= 3, 'Release must recheck finality and registry availability.');
  await browser.close();
  browser = await openBrowser();
  const resumed = await browser.newPage();
  await openClaim(resumed, origin);
  await resumed.locator('#claim-check-availability').click();
  await status(resumed, /^A failed original is retained in local history/);
  const archived = await resumed.evaluate(
    async ({ registry, name, account, digest }) => {
      const journalUrl = '/src/midnames/claim-journal.ts';
      const receiptUrl = '/src/midnames/claim-receipt.ts';
      const { openClaimJournal } = (await import(
        journalUrl
      )) as typeof import('../src/midnames/claim-journal.js');
      const { claimDigest } = (await import(
        receiptUrl
      )) as typeof import('../src/midnames/claim-receipt.js');
      const scope = await claimDigest(new Uint8Array(32).fill(1));
      const journal = await openClaimJournal(indexedDB);
      try {
        const active = await journal.read(registry, name, scope);
        const history = await journal.readReleased(registry, name, account, scope);
        const db = await new Promise<IDBDatabase>((resolveOpen, reject) => {
          const request = indexedDB.open('mn-passport:midnames-claims', 3);
          request.onsuccess = () => resolveOpen(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          const key = JSON.stringify(['undeployed', registry, name, digest]);
          const row = await new Promise<{ reason?: string } | undefined>((resolveRow, reject) => {
            const request = db
              .transaction('released-claims', 'readonly')
              .objectStore('released-claims')
              .get(key);
            request.onsuccess = () => resolveRow(request.result);
            request.onerror = () => reject(request.error);
          });
          return {
            active: !!active,
            historyDigests: history.map((item) => item.transaction.sha256),
            reason: row?.reason,
          };
        } finally {
          db.close();
        }
      } finally {
        journal.close();
      }
    },
    {
      registry: original.registryAddress,
      name: original.name,
      account: original.accountAddress,
      digest: original.transaction.sha256,
    },
  );
  assert.deepEqual(archived, {
    active: false,
    historyDigests: [original.transaction.sha256],
    reason: 'CLAIM_SEGMENT_FAILURE',
  });
  writeFileSync(
    resolve(output, 'browser-claim-failed-release.json'),
    JSON.stringify(
      {
        originalDigest: original.transaction.sha256,
        releaseReason: archived.reason,
        archivedAfterBrowserRestart: true,
        liveIndexerRequests,
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
