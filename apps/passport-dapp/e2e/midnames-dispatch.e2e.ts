import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';
import { createServer } from 'vite';
import { openClaimDispatch } from '../../../examples/midnames-local/claim-dispatch.mts';
import { createClaimSponsorHandler } from '../../../examples/midnames-local/claim-sponsor-http.mts';
import { claimDispatchPath } from '../src/midnames/claim-dispatch.js';
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
const preparationPath = '/__claim-preparation';
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
          if (request.url === preparationPath) {
            let body = '';
            request.on('data', (part: Buffer) => {
              body += part.toString('utf8');
            });
            request.on('end', () => {
              const { action, input } = JSON.parse(body);
              preparationRequests.push(action);
              if (action !== 'quote') assert.deepEqual(input, quote);
              response.setHeader('Content-Type', 'application/json');
              const wrongOwner = action === 'find' && lookups++ === 0;
              response.end(
                JSON.stringify(
                  action === 'quote'
                    ? quote
                    : wrongOwner
                      ? { ...receipt, ownerCommitment: 'ff'.repeat(32) }
                      : receipt,
                ),
              );
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
          const original = ${JSON.stringify(receipt)};
          const other = new URLSearchParams(location.search).has('other');
          const preparing = new URLSearchParams(location.search).has('prepare');
          const invoke = (action, input) => fetch(${JSON.stringify(preparationPath)}, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, input }),
          }).then(response => response.json());
          const account = { address: original.accountAddress, networkId: original.networkId,
            credentialId: new Uint8Array([other ? 2 : 1]) };
          showClaimRecovery({
            registryAddress: original.registryAddress,
            availability: async () => 'available',
            check: async (saved) => JSON.stringify(saved) === JSON.stringify(original) ? 'registered' : 'conflict',
            dispatch: requestClaimDispatch,
            ...(preparing && { preparation: {
              quote: input => invoke('quote', input),
              prove: async () => ({ ownerCommitment: original.ownerCommitment, bytes: new Uint8Array([2, 3, 5]) }),
              prepare: quote => invoke('prepare', quote),
              findPrepared: quote => invoke('find', quote),
            } }),
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
    await page.route(origin + preparationPath, async (route) => {
      assert.equal((await route.fetch()).status(), 200);
      await route.abort('failed');
    });
    await prepare.click();
    await status.filter({ hasText: 'Recover using the saved quote' }).waitFor();
    assert.deepEqual(preparationRequests, ['quote', 'quote', 'prepare']);
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
      .filter({ hasText: 'Original receipt saved' })
      .waitFor();
    assert.deepEqual(preparationRequests, ['quote', 'quote', 'prepare', 'find', 'find']);
    await resumed.locator('#claim-recovery-check').click();
    await resumed
      .locator('#claim-recovery-status')
      .filter({ hasText: /^Registered/ })
      .waitFor();
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
  assert.deepEqual(requests, [bytes]);
  console.log('PASS: exact quote review, saved intent recovery and automatic receipt retention');
} finally {
  await browser?.close();
  await vite.close();
  rmSync(root, { recursive: true, force: true });
}
