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
    <details id="claim-recovery-details" open><textarea id="claim-recovery-receipt"></textarea></details>
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
          check: async () => window.fixtureOutcome,
        }, () => opened);
        reset();
        window.fixtureOutcome = 'claim-failed';
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
    .getByText(/registration claim failed while the sponsor fee succeeded/)
    .waitFor();
  assert.equal(await page.locator('#claim-release-failed').isVisible(), true);
  await page.evaluate(
    () => ((window as unknown as { fixtureOutcome: string }).fixtureOutcome = 'conflict'),
  );
  await page.locator('#claim-release-failed').click();
  await page
    .locator('#claim-recovery-status')
    .getByText(/Claim check unavailable/)
    .waitFor();
  assert.equal(await page.locator('#claim-release-failed').isVisible(), false);
  await page.evaluate(
    () => ((window as unknown as { fixtureOutcome: string }).fixtureOutcome = 'claim-failed'),
  );
  await page.locator('#claim-recovery-check').click();
  await page
    .locator('#claim-recovery-status')
    .getByText(/registration claim failed while the sponsor fee succeeded/)
    .waitFor();
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
  const sponsored = await browser.newPage();
  await sponsored.route(`${origin}/__failed_claim_fixture`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: html }),
  );
  await sponsored.goto(`${origin}/__failed_claim_fixture`);
  await sponsored.addScriptTag({
    type: 'module',
    content: `
      try {
        const { showClaimRecovery } = await import('/src/midnames/claim-recovery-ui.ts');
        const opened = {
          networkId: 'undeployed', address: ${JSON.stringify(account)},
          credentialId: new Uint8Array(32).fill(2),
        };
        window.fixtureOutcome = 'claim-failed';
        window.fixtureSponsorAvailable = false;
        window.fixtureSponsorArchived = false;
        window.fixtureQuoteCalls = 0;
        const reset = showClaimRecovery({
          registryAddress: ${JSON.stringify(registry)},
          availability: async () => 'available',
          check: async () => window.fixtureOutcome,
          preparation: {
            quote: async (destination) => {
              if (!window.fixtureSponsorArchived) throw new Error('Sponsor still busy.');
              window.fixtureQuoteCalls++;
              return {
                ...destination, id: 'ab'.repeat(32), sponsorAddress: 'ac'.repeat(32),
                sponsorPaymentAddress: 'ad'.repeat(32), registryPayee: 'ae'.repeat(32),
                night: '1', maximumDust: '10000', expiresAt: Date.now() + 240000,
              };
            },
            prove: async () => { throw new Error('No proof in recovery test.'); },
            prepare: async () => { throw new Error('No preparation in recovery test.'); },
            findPrepared: async () => { throw new Error('No preparation in recovery test.'); },
            retireIndexedFailure: async () => {
              if (!window.fixtureSponsorAvailable) throw new Error('Sponsor unavailable.');
              window.fixtureSponsorArchived = true;
              return 'claim-failed';
            },
          },
        }, () => opened);
        reset();
        window.fixtureError = '';
      } catch (error) {
        window.fixtureError = String(error);
      }
      window.fixtureReady = true;
    `,
  });
  await sponsored.waitForFunction('window.fixtureReady === true');
  assert.equal(await sponsored.evaluate('window.fixtureError'), '');
  await sponsored.locator('#claim-recovery-name').fill(original.name);
  await sponsored.locator('#claim-recovery-receipt').fill(JSON.stringify(original));
  await sponsored.locator('#claim-recovery-retain').click();
  await sponsored
    .locator('#claim-recovery-status')
    .getByText(/Original receipt saved/)
    .waitFor();
  await sponsored.locator('#claim-recovery-check').click();
  await sponsored
    .locator('#claim-recovery-status')
    .getByText(/Registration failed while/)
    .waitFor();
  assert.equal(await sponsored.locator('#claim-release-failed').isVisible(), true);
  await sponsored.locator('#claim-release-failed').click();
  await sponsored
    .locator('#claim-recovery-status')
    .getByText(/Claim check unavailable/)
    .waitFor();
  assert.equal(await sponsored.evaluate('window.fixtureSponsorArchived'), false);
  await sponsored.evaluate('window.fixtureSponsorAvailable = true');
  await sponsored.locator('#claim-recovery-check').click();
  await sponsored.locator('#claim-release-failed').click();
  await sponsored
    .locator('#claim-recovery-status')
    .getByText(/Failed original retained in local history/)
    .waitFor();
  assert.equal(await sponsored.evaluate('window.fixtureSponsorArchived'), true);
  await sponsored.locator('#claim-review-quote').click();
  await sponsored
    .locator('#claim-quote-summary')
    .getByText(/Register alice.night/)
    .waitFor();
  assert.equal(await sponsored.evaluate('window.fixtureQuoteCalls'), 1);
  console.log('Midnames failed-claim-segment browser recovery: PASS');
} finally {
  await browser.close();
  await server.close();
}
