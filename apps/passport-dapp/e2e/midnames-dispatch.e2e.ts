import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { createServer } from 'vite';
import { openClaimDispatch } from '../../../examples/midnames-local/claim-dispatch.mts';
import { createClaimSponsorHandler } from '../../../examples/midnames-local/claim-sponsor-http.mts';
import { claimDispatchPath } from '../src/midnames/claim-dispatch.js';
import {
  claimPreparePath,
  claimPreparedPath,
  claimQuotePath,
} from '../src/midnames/claim-preparation-transport.js';
import { claimQuoteDigest } from '../src/midnames/claim-quote.js';
import type { ClaimReceipt } from '../src/midnames/claim-receipt.js';

const bytes = Uint8Array.of(2, 3, 5);
const receipt: ClaimReceipt = {
  networkId: 'undeployed',
  registryAddress: '12'.repeat(32),
  accountAddress: '34'.repeat(32),
  name: 'charlie.night',
  ownerCommitment: '56'.repeat(32),
  transaction: {
    identifiers: ['00' + '78'.repeat(32)],
    sha256: createHash('sha256').update(bytes).digest('hex'),
  },
};
const document = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = document.indexOf('<form id="claim-recovery"');
const end = document.indexOf('</form>', start) + '</form>'.length;
assert.ok(start > 0 && end > start);
const fixturePage = '/__claim-dispatch-fixture';
const preparationPaths = new Map([
  [claimQuotePath, 'quote'],
  [claimPreparePath, 'prepare'],
  [claimPreparedPath, 'find'],
]);
const quote = {
  networkId: receipt.networkId,
  registryAddress: receipt.registryAddress,
  accountAddress: receipt.accountAddress,
  name: receipt.name,
  id: '91'.repeat(32),
  sponsorAddress: '92'.repeat(32),
  registryPayee: '93'.repeat(32),
  night: '1',
  maximumDust: '100000',
  expiresAt: Date.now() + 300_000,
};
const preparationRequests: string[] = [];
let lookups = 0;
const preparedReceipt = { ...receipt, quoteSha256: await claimQuoteDigest(quote) };
const wrongQuoteReceipt = { ...preparedReceipt, quoteSha256: 'ee'.repeat(32) };
const root = realpathSync(mkdtempSync(join(tmpdir(), 'midnames-browser-dispatch-')));
openClaimDispatch(root).retain(bytes, receipt);
let handler: ReturnType<typeof createClaimSponsorHandler>;
const vite = await createServer({
  configFile: false,
  root: process.cwd(),
  cacheDir: join(root, 'vite-cache'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [
    {
      name: 'midnames-browser-dispatch',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const action = preparationPaths.get(request.url ?? '');
          if (action) {
            let body = '';
            request.on('data', (part: Buffer) => {
              body += part.toString('utf8');
            });
            request.on('end', () => {
              const input = JSON.parse(body);
              preparationRequests.push(action);
              if (action === 'prepare')
                assert.deepEqual(input, {
                  quote,
                  ownerCommitment: receipt.ownerCommitment,
                  proof: '020305',
                });
              if (action === 'find')
                assert.deepEqual(input, { quote, ownerCommitment: receipt.ownerCommitment });
              response.setHeader('Content-Type', 'application/json');
              const variants = [
                { ...preparedReceipt, ownerCommitment: 'ff'.repeat(32) },
                wrongQuoteReceipt,
              ];
              const found =
                action === 'find' ? (variants[lookups++] ?? preparedReceipt) : preparedReceipt;
              response.end(JSON.stringify(action === 'quote' ? quote : found));
            });
            return;
          }
          if (request.url?.split('?')[0] !== fixturePage) {
            void handler(request, response).then((handled) => {
              if (!handled) next();
            }, next);
            return;
          }
          response.setHeader('Content-Type', 'text/html');
          response.end(
            '<!doctype html><meta charset="utf-8">' +
              document.slice(start, end) +
              `<script type="module">
          import { showClaimRecovery } from '/src/midnames/claim-recovery-ui.ts';
          import { requestClaimDispatch } from '/src/midnames/claim-dispatch.ts';
          import { createLocalClaimPreparation } from '/src/midnames/claim-preparation-transport.ts';
          const original = ${JSON.stringify(receipt)};
          const other = new URLSearchParams(location.search).has('other');
          const preparing = new URLSearchParams(location.search).has('prepare');
          const account = { address: original.accountAddress, networkId: original.networkId,
            credentialId: new Uint8Array([other ? 2 : 1]) };
          showClaimRecovery({
            registryAddress: original.registryAddress,
            availability: async () => 'available',
            check: async ({ quoteSha256, ...saved }) => JSON.stringify(saved) === JSON.stringify(original) ? 'registered' : 'conflict',
            dispatch: requestClaimDispatch,
            ...(preparing && { preparation: createLocalClaimPreparation(
              async () => ({ ownerCommitment: original.ownerCommitment, bytes: new Uint8Array([2, 3, 5]) }),
            ) }),
          }, () => account);
        </script>`,
          );
        });
      },
    },
  ],
});
let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
const openBrowser = (profile = 'chrome-profile') =>
  chromium.launchPersistentContext(join(root, profile), {
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });

/** Reproduce the IndexedDB record written before quote digests were added. */
async function restoreLegacyJournal(page: Page, complete = false) {
  await page.evaluate(
    ({ registry, name, complete }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('mn-passport:midnames-claims', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('claims', 'readwrite');
          const store = transaction.objectStore('claims');
          const key = JSON.stringify(['undeployed', registry, name]);
          const lookup = store.get(key);
          lookup.onsuccess = () => {
            const row = lookup.result;
            if (!row?.quoteSha256 || !!row.receipt !== complete) {
              transaction.abort();
              return;
            }
            delete row.quoteSha256;
            if (complete) delete row.receipt.quoteSha256;
            store.put(row, key);
          };
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onabort = () => {
            db.close();
            reject(new Error('Could not seed legacy claim.'));
          };
        };
      }),
    { registry: receipt.registryAddress, name: receipt.name, complete },
  );
}

async function verifyPreparation(
  origin: string,
  pageUrl: string,
  open: () => Promise<BrowserContext>,
) {
  let context = await open();
  try {
    const page = await context.newPage();
    await page.goto(pageUrl + '?prepare');
    const name = page.locator('#claim-recovery-name');
    const details = page.locator('#claim-quote-summary');
    const prepare = page.locator('#claim-prepare');
    const status = page.locator('#claim-recovery-status');
    await name.fill(receipt.name);
    await page.locator('#claim-review-quote').click();
    await details.filter({ hasText: 'Maximum sponsor fee 100000 SPECKs' }).waitFor();
    assert.match(await details.innerText(), /Registry price 1 smallest NIGHT units/);
    assert.match(await details.innerText(), new RegExp(quote.registryPayee));
    assert.deepEqual(preparationRequests, ['quote']);

    await name.fill('alice.night');
    assert.equal(await prepare.isVisible(), false);
    await name.fill(receipt.name);
    await page.locator('#claim-review-quote').click();
    await details.waitFor();
    await page.route(origin + claimPreparePath, async (route) => {
      assert.equal((await route.fetch()).status(), 200);
      await route.abort('failed');
    });
    await prepare.click();
    await status.filter({ hasText: 'Recover using the saved quote' }).waitFor();
    assert.deepEqual(preparationRequests, ['quote', 'quote', 'prepare']);
    await restoreLegacyJournal(page);
    await context.close();

    context = await open();
    const alternate = await context.newPage();
    await alternate.goto(pageUrl + '?prepare&other');
    await alternate.locator('#claim-recovery-name').fill(receipt.name);
    await alternate.locator('#claim-review-quote').click();
    await alternate
      .locator('#claim-recovery-status')
      .filter({ hasText: /^Claim check unavailable/ })
      .waitFor();
    const resumed = await context.newPage();
    await resumed.goto(pageUrl + '?prepare');
    await resumed.locator('#claim-recovery-name').fill(receipt.name);
    await resumed.locator('#claim-review-quote').click();
    await resumed.getByRole('button', { name: 'Recover prepared receipt' }).click();
    await resumed
      .locator('#claim-recovery-status')
      .filter({ hasText: /^Claim check unavailable/ })
      .waitFor();
    await resumed.locator('#claim-recovery-check').click();
    await resumed
      .locator('#claim-recovery-status')
      .filter({ hasText: /Save the original claim receipt/ })
      .waitFor();
    await resumed.getByRole('button', { name: 'Recover prepared receipt' }).click();
    await resumed
      .locator('#claim-recovery-status')
      .filter({ hasText: /^Claim check unavailable/ })
      .waitFor();
    await resumed.getByRole('button', { name: 'Recover prepared receipt' }).click();
    await resumed
      .locator('#claim-recovery-status')
      .filter({ hasText: 'Original receipt saved' })
      .waitFor();
    assert.deepEqual(preparationRequests, ['quote', 'quote', 'prepare', 'find', 'find', 'find']);
    await resumed.locator('#claim-recovery-check').click();
    await resumed
      .locator('#claim-recovery-status')
      .filter({ hasText: /^Registered/ })
      .waitFor();
  } finally {
    await context.close();
  }
}

async function verifyPreparedImport(
  origin: string,
  pageUrl: string,
  open: () => Promise<BrowserContext>,
) {
  const before = preparationRequests.length;
  let context = await open();
  try {
    const page = await context.newPage();
    await page.goto(pageUrl + '?prepare');
    await page.locator('#claim-recovery-name').fill(receipt.name);
    await page.locator('#claim-review-quote').click();
    await page.locator('#claim-quote-summary').waitFor();
    await page.route(origin + claimPreparePath, async (route) => {
      assert.equal((await route.fetch()).status(), 200);
      await route.abort('failed');
    });
    await page.locator('#claim-prepare').click();
    await page
      .locator('#claim-recovery-status')
      .filter({ hasText: 'Recover using the saved quote' })
      .waitFor();
    await restoreLegacyJournal(page);
    await context.close();

    context = await open();
    const reopened = await context.newPage();
    await reopened.goto(pageUrl + '?prepare');
    await reopened.locator('#claim-recovery-name').fill(receipt.name);
    const status = reopened.locator('#claim-recovery-status');
    const receiptInput = reopened.locator('#claim-recovery-receipt');
    const save = reopened.locator('#claim-recovery-retain');
    await receiptInput.fill(JSON.stringify(wrongQuoteReceipt));
    await save.click();
    await status.filter({ hasText: /^Claim check unavailable/ }).waitFor();
    await receiptInput.fill(JSON.stringify(preparedReceipt));
    await save.click();
    await status.filter({ hasText: 'Original receipt saved' }).waitFor();
    await reopened.locator('#claim-recovery-check').click();
    await status.filter({ hasText: /^Registered/ }).waitFor();
    await restoreLegacyJournal(reopened, true);
    await reopened.reload();
    await reopened.locator('#claim-recovery-name').fill(receipt.name);
    await reopened.locator('#claim-recovery-check').click();
    await status.filter({ hasText: /^Registered/ }).waitFor();
    assert.deepEqual(preparationRequests.slice(before), ['quote', 'prepare']);
  } finally {
    await context.close();
  }
}
try {
  await vite.listen();
  const origin = new URL(vite.resolvedUrls!.local[0]!).origin;
  const requests: Uint8Array[] = [];
  handler = createClaimSponsorHandler(origin, root, {
    async authorize(input, acknowledged) {
      assert.deepEqual(input, bytes);
      assert.deepEqual(acknowledged, receipt);
    },
    async submit(input) {
      requests.push(input);
    },
  });
  const post = (originHeader: string, acknowledgement: ClaimReceipt) =>
    fetch(origin + claimDispatchPath, {
      method: 'POST',
      headers: { Origin: originHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(acknowledgement),
    });
  assert.equal((await post('http://127.0.0.1:1', receipt)).status, 403);
  assert.equal((await post(origin, { ...receipt, name: 'alice.night' })).status, 409);
  assert.equal(requests.length, 0);
  const pageUrl = origin + fixturePage;
  browser = await openBrowser();
  const first = await browser.newPage();
  await first.goto(pageUrl);
  let browserDispatches = 0;
  first.on('request', (request) => {
    if (request.url() === origin + claimDispatchPath) browserDispatches += 1;
  });
  await first.locator('#claim-recovery-name').fill(receipt.name);
  await first.locator('#claim-dispatch').click();
  const status = first.locator('#claim-recovery-status');
  await status.filter({ hasText: 'Save the original claim receipt' }).waitFor();
  assert.equal(browserDispatches, 0);
  await first.locator('#claim-recovery-receipt').fill(JSON.stringify(receipt));
  await first.locator('#claim-recovery-retain').click();
  await status.filter({ hasText: 'Original receipt saved' }).waitFor();
  await first.route(origin + claimDispatchPath, async (route) => {
    const response = await route.fetch();
    assert.equal(response.status(), 202);
    await route.abort('failed');
  });
  await first.locator('#claim-dispatch').click();
  await status.filter({ hasText: /^Claim pending/ }).waitFor();
  assert.equal(browserDispatches, 1);
  assert.deepEqual(requests, [bytes]);
  await browser.close();
  browser = await openBrowser();
  const other = await browser.newPage();
  await other.goto(pageUrl + '?other');
  await other.locator('#claim-recovery-name').fill(receipt.name);
  await other.locator('#claim-dispatch').click();
  await other
    .locator('#claim-recovery-status')
    .filter({ hasText: /^Claim check unavailable/ })
    .waitFor();
  const reopened = await browser.newPage();
  await reopened.goto(pageUrl);
  await reopened.locator('#claim-recovery-name').fill(receipt.name);
  await reopened.locator('#claim-recovery-check').click();
  await reopened
    .locator('#claim-recovery-status')
    .filter({ hasText: /^Registered/ })
    .waitFor();
  assert.deepEqual(requests, [bytes]);
  console.log(
    'PASS: browser acknowledgement, one sponsor call and original receipt recovery after restart',
  );
  await verifyPreparation(origin, pageUrl, () => openBrowser('chrome-preparation-profile'));
  await verifyPreparedImport(origin, pageUrl, () => openBrowser('chrome-preparation-import'));
  assert.deepEqual(requests, [bytes]);
  console.log(
    'PASS: exact quote review, legacy journal recovery and receipt import reject changed owner and quote',
  );
} finally {
  await browser?.close();
  await vite.close();
  rmSync(root, { recursive: true, force: true });
}
