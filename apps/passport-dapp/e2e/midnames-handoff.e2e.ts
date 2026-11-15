// Synthetic full-app composition check. The connector and naming reads are fixtures;
// no claim transaction, passkey, chain, or provider is simulated as qualified.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const registry = '12'.repeat(32);
const account = '34'.repeat(32);
const manifest = '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
const original = {
  networkId: 'undeployed',
  registryAddress: registry,
  accountAddress: account,
  name: 'alice.night',
  ownerCommitment: '56'.repeat(32),
  transaction: { identifiers: ['00' + '78'.repeat(32)], sha256: '90'.repeat(32) },
};

const connector = `
  export const ARM = 'p256', SIGNING_MODE = 'passkey', NETWORK_ID = 'undeployed';
  export const BINDING_ID = 'acc-s3r1.1', RP_ID = 'localhost';
  export const ORIGIN = location.origin, SERVICE_URL = location.origin;
  export const MANIFEST_SHA256 = ${JSON.stringify(manifest)};
  export const exportDemoGrantOpening = async () => { throw Error('Outside handoff fixture'); };
  const account = (alternate) => ({
    scheme: 'p256-webauthn', networkId: NETWORK_ID, bindingId: BINDING_ID,
    address: ${JSON.stringify(account)}, credentialId: new Uint8Array(32).fill(alternate ? 2 : 1),
    async state() {
      return { specVersion: 3, booted: true, authNonce: 0n, deviceEpoch: 0n, entryCount: 1 };
    },
  });
  export const connect = async () => ({
    async createAccount() {
      localStorage.setItem('handoff-fixture-creates',
        String(Number(localStorage.getItem('handoff-fixture-creates') || '0') + 1));
      return account(false);
    },
    async openAccount() { return account(new URLSearchParams(location.search).has('alternate')); },
  });
  export function installShim() { window.midnight = { passport: { connect } }; }
`;

const naming = `
  export function configureMidnames() {
    return {
      provider: { id: 'synthetic-handoff', mode: 'external' },
      async resolve() { return undefined; },
      recovery: {
        registryAddress: ${JSON.stringify(registry)},
        async availability() { return 'available'; },
        async dispatch() { throw Error('Claim dispatch is outside this handoff fixture'); },
        async check(receipt) {
          if (receipt.name !== 'alice.night' ||
              receipt.accountAddress !== ${JSON.stringify(account)}) return 'conflict';
          const status = localStorage.getItem('handoff-claim-status');
          return status === 'failed' || status === 'unavailable' || status === 'conflict'
            ? status : 'registered';
        },
      },
    };
  }
`;

process.env.PASSPORT_MANIFEST_SHA256 = manifest;
const server = await createServer({
  root: process.cwd(),
  configFile: 'vite.config.ts',
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [
    {
      name: 'midnames-handoff-fixtures',
      enforce: 'pre',
      load(id) {
        const path = id.split('?')[0];
        if (path === `${process.cwd()}/src/connector.ts`) return connector;
        if (path === `${process.cwd()}/src/midnames/config.ts`) return naming;
      },
    },
  ],
});
await server.listen();
const address = server.httpServer?.address();
assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  browser = await chromium.launch({
    executablePath:
      process.env.CHROME_BIN ??
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) =>
    errors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`),
  );
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  const ready = async () => {
    try {
      await page
        .locator('#status')
        .filter({ hasText: /^Ready\./ })
        .waitFor({
          state: 'attached',
          timeout: 10_000,
        });
    } catch (error) {
      throw new Error(`App did not become ready: ${errors.join('; ')}`, { cause: error });
    }
  };
  await page.goto(origin);
  await ready();
  await page.locator('#create').click();
  await page.locator('#passport-name-setup').waitFor({ state: 'visible' });
  await page
    .locator('#passport-name-setup-status')
    .getByText(/Pending Passport setup/)
    .waitFor();
  assert.match(
    await page.locator('#passport-name-setup').innerText(),
    /same account|after your ACC exists/i,
  );
  assert.equal(await page.locator('#account-action-context').isVisible(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('handoff-fixture-creates')), '1');

  await page.locator('#claim-recovery-name').fill(original.name);
  await page.locator('#claim-recovery-receipt').fill(JSON.stringify(original));
  await page.locator('#claim-recovery-retain').click();
  await page
    .locator('#claim-recovery-status')
    .getByText(/Original receipt saved/)
    .waitFor();
  await page.locator('#claim-recovery-check').click();
  await page
    .locator('#passport-name-setup-status')
    .getByText(/^Registered\./)
    .waitFor();

  await page.goto(`${origin}/?alternate`);
  await ready();
  await page.locator('#open').click();
  await page.locator('#passport-name-setup').waitFor({ state: 'visible' });
  assert.match(
    (await page.locator('#passport-name-setup-status').textContent()) ?? '',
    /^Pending Passport setup\./,
  );
  await page.locator('#claim-recovery-name').fill(original.name);
  await page.locator('#claim-recovery-check').click();
  await page
    .locator('#claim-recovery-status')
    .getByText(/A different original claim is retained for this name/)
    .waitFor();

  await page.goto(origin);
  await ready();
  await page.locator('#open').click();
  await page.locator('#passport-name-setup').waitFor({ state: 'visible' });
  await page.locator('#claim-recovery-name').fill(original.name);
  await page.locator('#claim-recovery-check').click();
  await page
    .locator('#passport-name-setup-status')
    .getByText(/^Registered\./)
    .waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('handoff-fixture-creates')), '1');

  // A second, isolated browser profile exercises the full app's failed-original
  // path. The naming statuses are synthetic; this does not qualify chain finality.
  const retryContext = await browser.newContext();
  try {
    const retryPage = await retryContext.newPage();
    retryPage.on('pageerror', (error) => errors.push(error.message));
    await retryPage.goto(origin);
    await retryPage
      .locator('#status')
      .filter({ hasText: /^Ready\./ })
      .waitFor({ state: 'attached' });
    await retryPage.locator('#create').click();
    await retryPage.locator('#passport-name-setup').waitFor({ state: 'visible' });
    await retryPage.locator('#claim-recovery-name').fill(original.name);
    await retryPage.locator('#claim-recovery-receipt').fill(JSON.stringify(original));
    await retryPage.locator('#claim-recovery-retain').click();
    await retryPage
      .locator('#claim-recovery-status')
      .getByText(/Original receipt saved/)
      .waitFor();

    await retryPage.evaluate(() => localStorage.setItem('handoff-claim-status', 'conflict'));
    await retryPage.locator('#claim-recovery-check').click();
    await retryPage
      .locator('#claim-recovery-status')
      .getByText(/original transaction or current registry binding conflicts/)
      .waitFor();
    assert.equal(await retryPage.locator('#claim-release-failed').isVisible(), false);

    await retryPage.evaluate(() => localStorage.setItem('handoff-claim-status', 'failed'));
    await retryPage.locator('#claim-recovery-check').click();
    await retryPage
      .locator('#claim-recovery-status')
      .getByText(/exact original transaction failed/)
      .waitFor();
    assert.equal(await retryPage.locator('#claim-release-failed').isVisible(), true);

    await retryPage.evaluate(() => localStorage.setItem('handoff-claim-status', 'unavailable'));
    await retryPage.locator('#claim-release-failed').click();
    await retryPage
      .locator('#claim-recovery-status')
      .getByText(/Claim check unavailable/)
      .waitFor();
    assert.equal(await retryPage.locator('#claim-release-failed').isVisible(), false);

    await retryPage.evaluate(() => localStorage.setItem('handoff-claim-status', 'failed'));
    await retryPage.locator('#claim-recovery-check').click();
    await retryPage
      .locator('#claim-recovery-status')
      .getByText(/exact original transaction failed/)
      .waitFor();
    await retryPage.locator('#claim-release-failed').click();
    await retryPage
      .locator('#claim-recovery-status')
      .getByText(/Failed original retained in local history/)
      .waitFor();
    assert.equal(await retryPage.locator('#claim-release-failed').isVisible(), false);

    await retryPage.goto(origin);
    await retryPage
      .locator('#status')
      .filter({ hasText: /^Ready\./ })
      .waitFor({ state: 'attached' });
    await retryPage.locator('#open').click();
    await retryPage.locator('#passport-name-setup').waitFor({ state: 'visible' });
    await retryPage.locator('#claim-recovery-name').fill(original.name);
    await retryPage.locator('#claim-recovery-check').click();
    await retryPage
      .locator('#claim-recovery-status')
      .getByText(/retained in local history/)
      .waitFor();
    assert.deepEqual(
      JSON.parse(await retryPage.locator('#claim-recovery-receipt').inputValue()),
      original,
    );
    assert.equal(
      await retryPage.evaluate(() => localStorage.getItem('handoff-fixture-creates')),
      '1',
    );
  } finally {
    await retryContext.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Midnames synthetic create/open, credential scope, and failed-original handoff: PASS',
  );
} finally {
  await browser?.close();
  await server.close();
}
