import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const registry = '12'.repeat(32);
const account = '34'.repeat(32);
const original = {
  networkId: 'undeployed',
  registryAddress: registry,
  accountAddress: account,
  name: 'alice.night',
  ownerCommitment: '56'.repeat(32),
  transaction: { identifiers: ['00' + '78'.repeat(32)], sha256: '90'.repeat(32) },
};

const html = `<!doctype html><html><body>
  <form id="claim-recovery" hidden>
    <input id="claim-recovery-name" required>
    <button id="claim-check-availability" type="submit">Availability</button>
    <button id="claim-review-quote" type="submit" hidden>Review</button>
    <button id="claim-prepare" type="submit" hidden>Prepare</button>
    <pre id="claim-quote-summary" hidden></pre>
    <textarea id="claim-recovery-receipt"></textarea>
    <button id="claim-recovery-retain" type="submit">Save</button>
    <button id="claim-dispatch" type="submit" hidden>Send</button>
    <button id="claim-recovery-check" type="submit">Check</button>
    <button id="claim-release-failed" type="submit" hidden>Release</button>
    <p id="claim-recovery-status"></p>
  </form>
</body></html>`;

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
await server.listen();
const address = server.httpServer?.address();
assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});

try {
  const page = await browser.newPage();
  await page.route(`${origin}/__failed_claim_fixture`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: html }),
  );
  await page.goto(`${origin}/__failed_claim_fixture`);
  await page.addScriptTag({
    type: 'module',
    content: `
      try {
        const { showClaimRecovery } = await import('/src/midnames/claim-recovery-ui.ts');
        const opened = {
          networkId: 'undeployed', address: ${JSON.stringify(account)},
          credentialId: new Uint8Array(32).fill(1),
        };
        const reset = showClaimRecovery({
          registryAddress: ${JSON.stringify(registry)},
          availability: async () => 'available',
          check: async () => 'failed',
        }, () => opened);
        reset();
        window.fixtureError = '';
      } catch (error) {
        window.fixtureError = String(error);
      }
      window.fixtureReady = true;
    `,
  });
  await page.waitForFunction('window.fixtureReady === true');
  assert.equal(await page.evaluate('window.fixtureError'), '');
  await page.locator('#claim-recovery-name').fill(original.name);
  await page.locator('#claim-recovery-receipt').fill(JSON.stringify(original));
  await page.locator('#claim-recovery-retain').click();
  await page
    .locator('#claim-recovery-status')
    .getByText(/Original receipt saved/)
    .waitFor();
  await page.locator('#claim-recovery-check').click();
  await page
    .locator('#claim-recovery-status')
    .getByText(/exact original transaction failed/)
    .waitFor();
  assert.equal(await page.locator('#claim-release-failed').isVisible(), true);
  await page.locator('#claim-release-failed').click();
  await page
    .locator('#claim-recovery-status')
    .getByText(/Failed original retained in local history/)
    .waitFor();
  assert.equal(await page.locator('#claim-release-failed').isVisible(), false);
  await page.locator('#claim-recovery-check').click();
  await page
    .locator('#claim-recovery-status')
    .getByText(/retained in local history/)
    .waitFor();
  assert.deepEqual(
    JSON.parse(await page.locator('#claim-recovery-receipt').inputValue()),
    original,
  );
  await page.locator('#claim-recovery-retain').click();
  await page
    .locator('#claim-recovery-status')
    .getByText(/already released/)
    .waitFor();
  console.log('Midnames failed-original browser recovery: PASS');
} finally {
  await browser.close();
  await server.close();
}
