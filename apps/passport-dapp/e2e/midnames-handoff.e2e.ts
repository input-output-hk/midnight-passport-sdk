// Synthetic full-app composition check. The connector and naming reads are fixtures;
// no claim transaction, passkey, chain, or provider is simulated as qualified.
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { createClaimSponsorHandler } from '../../../examples/midnames-local/claim-sponsor-http.mts';
import { claimQuotePath } from '../src/midnames/claim-preparation-transport.js';
import { claimQuote, claimQuoteDigest } from '../src/midnames/claim-quote.js';

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
const retryOriginal = {
  ...original,
  transaction: { identifiers: ['00' + '79'.repeat(32)], sha256: '91'.repeat(32) },
};
const quote = {
  networkId: original.networkId,
  registryAddress: registry,
  accountAddress: account,
  name: original.name,
  id: '91'.repeat(32),
  sponsorAddress: '92'.repeat(32),
  sponsorPaymentAddress: '93'.repeat(32),
  registryPayee: '94'.repeat(32),
  night: '1',
  maximumDust: '100000',
  expiresAt: Date.now() + 300_000,
};

const connector = `
  export const ARM = 'p256', SIGNING_MODE = 'passkey', NETWORK_ID = 'undeployed';
  export const BINDING_ID = 'acc-s3r1.1', RP_ID = 'localhost';
  export const ORIGIN = location.origin, SERVICE_URL = location.origin;
  export const ARTEFACT_URL = SERVICE_URL + '/v1/zk/' + BINDING_ID;
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
  import { ClaimPreIntentRefusal, claimQuoteDigest } from './claim-quote.js';
  import { createLocalClaimPreparation } from './claim-preparation-transport.js';
  const quote = ${JSON.stringify(quote)};
  const original = ${JSON.stringify(original)};
  const retryOriginal = ${JSON.stringify(retryOriginal)};
  const count = (key) => localStorage.setItem(key,
    String(Number(localStorage.getItem(key) || '0') + 1));
  export function configureMidnames() {
    const preproof = new URLSearchParams(location.search).has('preproof');
    return {
      provider: { id: 'synthetic-handoff', mode: 'external' },
      async resolve() { return undefined; },
      recovery: {
        registryAddress: ${JSON.stringify(registry)},
        async availability() { return 'available'; },
        async dispatch() { throw Error('Claim dispatch is outside this handoff fixture'); },
        ...(preproof && { preparation: {
          async quote(destination) {
            count('handoff-quotes');
            if (JSON.stringify(destination) !== JSON.stringify({
              networkId: quote.networkId, registryAddress: quote.registryAddress,
              accountAddress: quote.accountAddress, name: quote.name,
            })) throw Error('Unexpected claim destination');
            if (new URLSearchParams(location.search).has('http'))
              return createLocalClaimPreparation(async () => {
                throw Error('The HTTP quote does not invoke a proof');
              }).quote(destination);
            const mode = localStorage.getItem('handoff-quote-mode');
            if (mode === 'unavailable') throw Error('Sponsor unavailable');
            if (mode === 'wrong-account')
              return { ...quote, accountAddress: 'ab'.repeat(32) };
            return quote;
          },
          async prove(reviewed, opened) {
            count('handoff-proofs');
            if (JSON.stringify(reviewed) !== JSON.stringify(quote) ||
                opened.address !== quote.accountAddress) throw Error('Unreviewed owner proof');
            return { ownerCommitment: original.ownerCommitment, bytes: new Uint8Array([2, 3, 5]) };
          },
          async prepare(reviewed, proved) {
            count('handoff-preparations');
            if (JSON.stringify(reviewed) !== JSON.stringify(quote) ||
                proved.ownerCommitment !== original.ownerCommitment) throw Error('Unreviewed preparation');
            const mode = localStorage.getItem('handoff-preparation-mode');
            if (mode === 'refused') throw new ClaimPreIntentRefusal('Policy refused before intent');
            const prepared = localStorage.getItem('handoff-claim-retry') === '1'
              ? retryOriginal : original;
            return { ...prepared, quoteSha256: await claimQuoteDigest(quote) };
          },
          async findPrepared() { throw Error('Recovery is outside this handoff fixture'); },
          async dispatchStatus() {
            return localStorage.getItem('handoff-sponsor-status') || 'prepared';
          },
        } }),
        async check(receipt) {
          if (receipt.name !== 'alice.night' ||
              receipt.accountAddress !== ${JSON.stringify(account)}) return 'conflict';
          const status = localStorage.getItem('handoff-claim-status');
          return status === 'failed' || status === 'unavailable' || status === 'conflict' || status === 'pending'
            ? status : 'registered';
        },
      },
    };
  }
`;

process.env.PASSPORT_MANIFEST_SHA256 = manifest;
const sponsorRoot = realpathSync(mkdtempSync(join(tmpdir(), 'midnames-handoff-quote-')));
const httpQuotes: unknown[] = [];
let sponsorHandler: ReturnType<typeof createClaimSponsorHandler> | undefined;
const server = await createServer({
  root: process.cwd(),
  configFile: 'vite.config.ts',
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [
    {
      name: 'midnames-handoff-fixtures',
      enforce: 'pre',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url !== claimQuotePath || !sponsorHandler) return next();
          void sponsorHandler(request, response).then((handled) => {
            if (!handled) next();
          }, next);
        });
      },
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
sponsorHandler = createClaimSponsorHandler(
  origin,
  sponsorRoot,
  {
    async authorize() {
      throw Error('Dispatch is outside this quote check');
    },
    async submit() {
      throw Error('Dispatch is outside this quote check');
    },
  },
  {
    async issue(destination) {
      httpQuotes.push(destination);
      return claimQuote(quote);
    },
    async authorizeQuote() {
      throw Error('Preparation is outside this quote check');
    },
    async balance() {
      throw Error('Preparation is outside this quote check');
    },
  },
);
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
    .getByText(/Name registration/)
    .waitFor();
  assert.match(
    await page.locator('#passport-name-setup').innerText(),
    /same account|after activating your ACC/i,
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
    /^Name registration\./,
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

    // Keep this browser profile and its archived failed original while a
    // different, reviewed claim is prepared. The fixture never dispatches it.
    await retryPage.evaluate(() => localStorage.setItem('handoff-claim-retry', '1'));
    await retryPage.goto(`${origin}/?preproof`);
    await retryPage
      .locator('#status')
      .filter({ hasText: /^Ready\./ })
      .waitFor({ state: 'attached' });
    await retryPage.locator('#open').click();
    await retryPage.locator('#passport-name-setup').waitFor({ state: 'visible' });
    await retryPage.locator('#claim-recovery-name').fill(original.name);
    await retryPage.locator('#claim-review-quote').click();
    await retryPage.locator('#claim-quote-summary').getByText(original.name).waitFor();
    await retryPage.locator('#claim-prepare').click();
    await retryPage
      .locator('#claim-recovery-status')
      .getByText(/No transaction has been sent\. Review the payment terms/)
      .waitFor();
    assert.deepEqual(JSON.parse(await retryPage.locator('#claim-recovery-receipt').inputValue()), {
      ...retryOriginal,
      quoteSha256: await claimQuoteDigest(claimQuote(quote)),
    });
    assert.equal(
      await retryPage.evaluate(() => localStorage.getItem('handoff-fixture-creates')),
      '1',
    );
    const retained = await retryPage.evaluate(
      async ({ registry, name, account }) => {
        const journalUrl = '/src/midnames/claim-journal.ts';
        const receiptUrl = '/src/midnames/claim-receipt.ts';
        const { openClaimJournal } = (await import(
          journalUrl
        )) as typeof import('../src/midnames/claim-journal.js');
        const { claimDigest } = (await import(
          receiptUrl
        )) as typeof import('../src/midnames/claim-receipt.js');
        const journal = await openClaimJournal(indexedDB);
        try {
          const scope = await claimDigest(new Uint8Array(32).fill(1));
          const current = await journal.read(registry, name, scope);
          const history = await journal.readReleased(registry, name, account, scope);
          return {
            current: current?.transaction.sha256,
            history: history.map((item) => item.transaction.sha256),
          };
        } finally {
          journal.close();
        }
      },
      { registry, name: original.name, account },
    );
    assert.deepEqual(retained, {
      current: retryOriginal.transaction.sha256,
      history: [original.transaction.sha256],
    });
  } finally {
    await retryContext.close();
  }

  // Exercise the full app's pre-proof decision with a same-origin sponsor HTTP quote.
  // Owner proof and preparation remain fixtures; the registry transaction needs native evidence.
  const preparationContext = await browser.newContext();
  try {
    const preparationPage = await preparationContext.newPage();
    preparationPage.on('pageerror', (error) => errors.push(error.message));
    const counts = () =>
      preparationPage.evaluate(() => ({
        quotes: Number(localStorage.getItem('handoff-quotes') || '0'),
        proofs: Number(localStorage.getItem('handoff-proofs') || '0'),
        preparations: Number(localStorage.getItem('handoff-preparations') || '0'),
        creates: Number(localStorage.getItem('handoff-fixture-creates') || '0'),
      }));
    await preparationPage.goto(`${origin}/?preproof&http`);
    await preparationPage
      .locator('#status')
      .filter({ hasText: /^Ready\./ })
      .waitFor({ state: 'attached' });
    await preparationPage.locator('#create').click();
    await preparationPage.locator('#passport-name-setup').waitFor({ state: 'visible' });
    await preparationPage.locator('#claim-recovery-name').fill(original.name);
    assert.equal(await preparationPage.locator('#claim-review-quote').isVisible(), true);
    assert.equal(await preparationPage.locator('#claim-prepare').isVisible(), false);
    assert.deepEqual(await counts(), { quotes: 0, proofs: 0, preparations: 0, creates: 1 });
    assert.deepEqual(httpQuotes, []);

    await preparationPage.locator('#claim-review-quote').click();
    const summary = preparationPage.locator('#claim-quote-summary');
    await summary.getByText(/Maximum sponsor fee 100000 SPECKs/).waitFor();
    const reviewed = await summary.innerText();
    for (const value of [
      original.name,
      original.networkId,
      account,
      registry,
      quote.registryPayee,
      quote.sponsorAddress,
      quote.sponsorPaymentAddress,
      'Registry price 1 smallest NIGHT units',
      new Date(quote.expiresAt).toISOString(),
    ])
      assert.ok(reviewed.includes(value));
    assert.match(reviewed, /Preparing uses the open account’s passkey/);
    assert.equal(await preparationPage.locator('#claim-prepare').isVisible(), true);
    assert.deepEqual(await counts(), { quotes: 1, proofs: 0, preparations: 0, creates: 1 });
    assert.deepEqual(httpQuotes, [
      {
        networkId: original.networkId,
        registryAddress: registry,
        accountAddress: account,
        name: original.name,
      },
    ]);

    await preparationPage.locator('#claim-prepare').click();
    await preparationPage
      .locator('#claim-recovery-status')
      .getByText(/No transaction has been sent\. Review the payment terms/)
      .waitFor();
    assert.deepEqual(await counts(), { quotes: 1, proofs: 1, preparations: 1, creates: 1 });
    assert.deepEqual(
      JSON.parse(await preparationPage.locator('#claim-recovery-receipt').inputValue()),
      { ...original, quoteSha256: await claimQuoteDigest(claimQuote(quote)) },
    );

    await preparationPage.evaluate(() => localStorage.setItem('handoff-claim-status', 'pending'));
    await preparationPage.goto(`${origin}/?preproof&http`);
    await preparationPage
      .locator('#status')
      .filter({ hasText: /^Ready\./ })
      .waitFor({ state: 'attached' });
    await preparationPage.locator('#open').click();
    await preparationPage.locator('#passport-name-setup').waitFor({ state: 'visible' });
    await preparationPage
      .locator('#claim-recovery-status')
      .getByText(/No transaction has been sent\. Review the payment terms/)
      .waitFor();
    assert.equal(await preparationPage.locator('#claim-dispatch').isVisible(), true);
    assert.match(
      (await preparationPage.locator('#passport-name-setup-status').textContent()) ?? '',
      /^Name registration\./,
    );
    assert.equal(await preparationPage.locator('#claim-recovery-name').inputValue(), original.name);
    await preparationPage.evaluate(() =>
      localStorage.setItem('handoff-sponsor-status', 'sent-or-unknown'),
    );
    await preparationPage.goto(`${origin}/?preproof&http`);
    await preparationPage
      .locator('#status')
      .filter({ hasText: /^Ready\./ })
      .waitFor({ state: 'attached' });
    await preparationPage.locator('#open').click();
    await preparationPage
      .locator('#claim-recovery-status')
      .getByText(/The original claim is pending\. This attempt is preserved/)
      .waitFor();
    assert.equal(await preparationPage.locator('#claim-release-failed').isVisible(), false);
    await preparationPage.evaluate(() =>
      localStorage.setItem('handoff-claim-status', 'registered'),
    );
    await preparationPage.locator('#claim-recovery-check').click();
    await preparationPage
      .locator('#passport-name-setup-status')
      .getByText(/^Registered\./)
      .waitFor();
    assert.deepEqual(await counts(), { quotes: 1, proofs: 1, preparations: 1, creates: 1 });
  } finally {
    await preparationContext.close();
  }

  // Full-app negative paths: no owner proof before a valid, displayed quote;
  // a durable pre-intent sponsor refusal releases only this synthetic attempt.
  const refusalContext = await browser.newContext();
  try {
    const refusalPage = await refusalContext.newPage();
    refusalPage.on('pageerror', (error) => errors.push(error.message));
    const counts = () =>
      refusalPage.evaluate(() => ({
        quotes: Number(localStorage.getItem('handoff-quotes') || '0'),
        proofs: Number(localStorage.getItem('handoff-proofs') || '0'),
        preparations: Number(localStorage.getItem('handoff-preparations') || '0'),
        creates: Number(localStorage.getItem('handoff-fixture-creates') || '0'),
      }));
    await refusalPage.goto(`${origin}/?preproof`);
    await refusalPage
      .locator('#status')
      .filter({ hasText: /^Ready\./ })
      .waitFor({ state: 'attached' });
    await refusalPage.locator('#create').click();
    await refusalPage.locator('#passport-name-setup').waitFor({ state: 'visible' });
    await refusalPage.locator('#claim-recovery-name').fill(original.name);

    await refusalPage.evaluate(() => localStorage.setItem('handoff-quote-mode', 'unavailable'));
    await refusalPage.locator('#claim-review-quote').click();
    await refusalPage
      .locator('#claim-recovery-status')
      .getByText(/Claim check unavailable/)
      .waitFor();
    assert.equal(await refusalPage.locator('#claim-prepare').isVisible(), false);
    assert.deepEqual(await counts(), { quotes: 1, proofs: 0, preparations: 0, creates: 1 });

    await refusalPage.evaluate(() => localStorage.setItem('handoff-quote-mode', 'wrong-account'));
    await refusalPage.locator('#claim-review-quote').click();
    await refusalPage
      .locator('#claim-recovery-status')
      .getByText(/Claim check unavailable/)
      .waitFor();
    assert.equal(await refusalPage.locator('#claim-prepare').isVisible(), false);
    assert.deepEqual(await counts(), { quotes: 2, proofs: 0, preparations: 0, creates: 1 });

    await refusalPage.evaluate(() => localStorage.removeItem('handoff-quote-mode'));
    await refusalPage.locator('#claim-review-quote').click();
    await refusalPage.locator('#claim-quote-summary').getByText(original.name).waitFor();
    assert.deepEqual(await counts(), { quotes: 3, proofs: 0, preparations: 0, creates: 1 });
    await refusalPage.locator('#claim-recovery-name').fill('bob.night');
    assert.equal(await refusalPage.locator('#claim-prepare').isVisible(), false);
    await refusalPage.locator('#claim-recovery-name').fill(original.name);
    await refusalPage.locator('#claim-review-quote').click();

    await refusalPage.evaluate(() => localStorage.setItem('handoff-preparation-mode', 'refused'));
    await refusalPage.locator('#claim-prepare').click();
    await refusalPage
      .locator('#claim-recovery-status')
      .getByText(/sponsor refused before preparation/i)
      .waitFor();
    assert.equal(await refusalPage.locator('#claim-prepare').isVisible(), false);
    assert.equal(await refusalPage.locator('#claim-recovery-receipt').inputValue(), '');
    assert.deepEqual(await counts(), { quotes: 4, proofs: 1, preparations: 1, creates: 1 });

    await refusalPage.evaluate(() => localStorage.removeItem('handoff-preparation-mode'));
    await refusalPage.locator('#claim-review-quote').click();
    await refusalPage.locator('#claim-prepare').click();
    await refusalPage
      .locator('#claim-recovery-status')
      .getByText(/No transaction has been sent\. Review the payment terms/)
      .waitFor();
    assert.deepEqual(await counts(), { quotes: 5, proofs: 2, preparations: 2, creates: 1 });
  } finally {
    await refusalContext.close();
  }
  const busyContext = await browser.newContext();
  try {
    const busyPage = await busyContext.newPage();
    busyPage.on('pageerror', (error) => errors.push(error.message));
    await busyPage.route(origin + claimQuotePath, (route) =>
      route.fulfill({ status: 423, body: '' }),
    );
    await busyPage.goto(`${origin}/?preproof&http`);
    await busyPage
      .locator('#status')
      .filter({ hasText: /^Ready\./ })
      .waitFor({ state: 'attached' });
    await busyPage.locator('#create').click();
    await busyPage.locator('#passport-name-setup').waitFor({ state: 'visible' });
    await busyPage.locator('#claim-recovery-name').fill(original.name);
    await busyPage.locator('#claim-review-quote').click();
    await busyPage
      .locator('#claim-recovery-status')
      .getByText(/sponsor has an unresolved original claim/i)
      .waitFor();
    assert.equal(await busyPage.locator('#claim-prepare').isVisible(), false);
    assert.deepEqual(
      await busyPage.evaluate(() => ({
        proofs: Number(localStorage.getItem('handoff-proofs') || '0'),
        preparations: Number(localStorage.getItem('handoff-preparations') || '0'),
      })),
      { proofs: 0, preparations: 0 },
    );
  } finally {
    await busyContext.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    'Midnames synthetic create/open, failed original, sponsor HTTP quote, and pre-proof approval/refusal: PASS',
  );
} finally {
  await browser?.close();
  await server.close();
  rmSync(sponsorRoot, { recursive: true, force: true });
}
