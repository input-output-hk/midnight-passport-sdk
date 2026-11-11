import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
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
          const account = { address: original.accountAddress, networkId: original.networkId,
            credentialId: new Uint8Array([other ? 2 : 1]) };
          showClaimRecovery({
            registryAddress: original.registryAddress,
            availability: async () => 'available',
            check: async (saved) => JSON.stringify(saved) === JSON.stringify(original) ? 'registered' : 'conflict',
            dispatch: requestClaimDispatch,
          }, () => account);
        </script>`,
          );
        });
      },
    },
  ],
});
let browser: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
const openBrowser = () =>
  chromium.launchPersistentContext(join(root, 'chrome-profile'), {
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
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
} finally {
  await browser?.close();
  await vite.close();
  rmSync(root, { recursive: true, force: true });
}
