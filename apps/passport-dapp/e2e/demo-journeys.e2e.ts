// Real Chromium UI and synthetic credentials; connector, wallet and chain deliberately mocked.
// Own ephemeral Vite server; localhost:5173 requests are intercepted, never sent to a user's demo.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { settleWithCeremonyReviews } from './approve-ceremonies.ts';
import { journeyArms } from './journey-arms.js';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://localhost:5173';
const selectedArms = journeyArms(process.env.PASSPORT_DEMO_JOURNEY_ARM);
const manifest = '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
const address = 'a1'.repeat(32);
const night = '00'.repeat(32);
const target = '20'.repeat(32);
const grantId = '60'.repeat(32);
const output =
  process.env.PASSPORT_DEMO_JOURNEY_OUTPUT ??
  resolve(appRoot, '../../review', `demo-journeys-${Date.now()}.json`);
const cases: { arm: string; name: string }[] = [];
const failures: string[] = [];
const pageErrors: string[] = [];
const credentialFailureCodes: string[] = [];
const ceremonyPurposesByArm: Record<string, string[]> = {};
const archivedPurposes: Record<string, string[]> = {};
const closingContexts = new WeakSet<BrowserContext>();
async function archiveObservations(page: Page, arm: string) {
  const saved = await page.evaluate(() => {
    const w = window as unknown as {
      __passportPurposeObservations?: { purpose: string }[];
      __passportPurposeFailureCodes?: string[];
    };
    return {
      purposes: (w.__passportPurposeObservations ?? []).map((o) => o.purpose),
      failures: w.__passportPurposeFailureCodes ?? [],
    };
  });
  assert.deepEqual(saved.failures, [], 'reload must not hide any credential observer failure');
  (archivedPurposes[arm] ??= []).push(...saved.purposes);
}
const repoRoot = resolve(appRoot, '../..');
const started = Date.now();
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();
const dirty =
  execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).length > 0;
const runtimeIdentity = () => {
  const files = [
    ...globSync(
      [
        'apps/passport-dapp/src/**/*.{ts,css}',
        'apps/passport-dapp/e2e/**/*.ts',
        'apps/passport-dapp/index.html',
        'apps/passport-dapp/examples/**/*.html',
        'apps/passport-dapp/vite.config.ts',
        'packages/*/dist/**/*.js',
        'packages/*/package.json',
        'packages/contract/generated/acc-s3r1.1/*.js',
        'packages/contract/resources/acc-s3r1.1.capabilities.json',
        'pnpm-lock.yaml',
        'node_modules/.pnpm/react@*/node_modules/react/**/*.js',
        'node_modules/.pnpm/react-dom@*/node_modules/react-dom/**/*.js',
        'node_modules/.pnpm/scheduler@*/node_modules/scheduler/**/*.js',
      ],
      { cwd: repoRoot },
    ),
  ].sort();
  return createHash('sha256')
    .update(
      JSON.stringify(
        files.map((file) => [
          file,
          createHash('sha256')
            .update(readFileSync(resolve(repoRoot, file)))
            .digest('hex'),
        ]),
      ),
    )
    .digest('hex');
};
const initialRuntimeIdentity = runtimeIdentity();
interface FixtureState {
  ownerPublicKey?: string;
  nonce: number;
  epoch: number;
  entries: string[];
  night: number;
  wallet: number;
  txHash: string;
  grant?: { id: string; active: boolean; scope: Record<string, unknown>; spent: number };
}
const replacements: Record<string, string> = {
  '/src/connector.ts': 'demo-connector.ts',
  '/src/wallet/dev-wallet.ts': 'demo-wallet.ts',
  '/src/grant-holder-demo.ts': 'demo-holder.ts',
};
const savedPin = process.env.PASSPORT_MANIFEST_SHA256;
process.env.PASSPORT_MANIFEST_SHA256 = manifest;
let ownedCache: string | undefined;
let server: Awaited<ReturnType<typeof createServer>> | undefined;
const serverOptions: Parameters<typeof createServer>[0] = {
  root: appRoot,
  configFile: resolve(appRoot, 'vite.config.ts'),
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  plugins: [
    {
      name: 'isolated-demo-journey-fixtures',
      enforce: 'pre',
      async load(id) {
        for (const [suffix, fixture] of Object.entries(replacements)) {
          if (id.split('?')[0] === resolve(appRoot, `.${suffix}`))
            return (await readFile(resolve(appRoot, 'e2e/fixtures', fixture), 'utf8')).replaceAll(
              "'../../src/",
              "'/src/",
            );
        }
        return null;
      },
    },
  ],
};
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let browserVersion: string | undefined;
let outcome = 'failed';
// Use actual navigation, including the mobile drawer; never reveal content by mutating hidden state.
async function openNavigation(page: Page): Promise<void> {
  if ((await page.locator('#main').getAttribute('data-landing')) === 'true') {
    const tools = page.locator('#landing-demo-tools');
    if (!(await tools.evaluate((element) => (element as HTMLDetailsElement).open)))
      await tools.locator('summary').click();
    await page.locator('#landing-settings').click();
  }
  await page.waitForFunction(() => {
    const nav = document.querySelector('.workspace-nav');
    return matchMedia('(max-width: 900px)').matches
      ? nav?.parentElement?.id === 'navigation-sheet'
      : nav?.parentElement?.id === 'main';
  });
  if (await page.locator('#navigation-toggle').isVisible()) {
    if (
      !(await page
        .locator('#navigation-sheet')
        .evaluate((item) => (item as HTMLDialogElement).open))
    )
      await page.locator('#navigation-toggle').click();
    await page.locator('#navigation-sheet').waitFor({ state: 'visible' });
  }
}
async function navClick(page: Page, selector: string): Promise<void> {
  await openNavigation(page);
  await page.locator(selector).click();
}
async function assertAccountWorkspace(page: Page): Promise<void> {
  assert.equal(await page.locator('#workspace-account').isVisible(), true);
  assert.equal(await page.locator('#account-page-balances').isVisible(), true);
  assert.equal(await page.locator('#account-tab-balances').getAttribute('aria-current'), 'page');
  assert.equal(await page.evaluate(() => location.hash), '#account/balances');
  assert.notEqual(await page.locator('#main').getAttribute('data-landing'), 'true');
}
async function reveal(page: Page, selector: string): Promise<void> {
  const location = await page.locator(selector).evaluate((element) => ({
    inNavigation: !!element.closest('.workspace-nav'),
    view: element.closest<HTMLElement>('[data-workspace]')?.dataset.workspace,
    control: element.closest('[data-workspace-page]')?.getAttribute('aria-labelledby'),
    details: [...(element.closest('[data-workspace]')?.querySelectorAll('details') ?? [])]
      .filter((details) => details.contains(element))
      .map((details) => details.id),
  }));
  if (location.inNavigation) {
    await openNavigation(page);
    return;
  }
  if (
    location.control &&
    (await page.locator(`#${location.control}`).getAttribute('aria-current')) !== 'page'
  )
    await navClick(page, `#${location.control}`);
  else if (
    location.view &&
    (await page.locator(`#nav-${location.view}`).getAttribute('aria-current')) !== 'page'
  )
    await navClick(page, `#nav-${location.view}`);
  for (const id of location.details) {
    if (
      id &&
      !(await page.locator(`#${id}`).evaluate((element) => (element as HTMLDetailsElement).open))
    )
      await page.locator(`#${id} > summary`).click();
  }
}
async function readSessionState(page: Page): Promise<string> {
  await reveal(page, '#session-state');
  return (await page.locator('#session-state').getAttribute('data-status')) ?? '';
}
async function click(page: Page, selector: string): Promise<void> {
  await reveal(page, selector);
  await page.locator(selector).click();
}
async function fill(page: Page, selector: string, value: string): Promise<void> {
  await reveal(page, selector);
  await page.locator(selector).fill(value);
}
async function check(page: Page, selector: string): Promise<void> {
  await reveal(page, selector);
  await page.locator(selector).check();
}
async function select(page: Page, selector: string, value: string): Promise<void> {
  await reveal(page, selector);
  await page.locator(selector).selectOption(value);
}

async function observeCredentialAccess(page: Page): Promise<void> {
  await page.addScriptTag({ type: 'module', url: `${origin}/e2e/fixtures/credential-observer.ts` });
}

try {
  ownedCache = await mkdtemp(resolve(tmpdir(), 'passport-demo-vite-'));
  server = await createServer({ ...serverOptions, cacheDir: ownedCache });
  await server.listen();
  const listener = server.httpServer!.address();
  assert.ok(listener && typeof listener !== 'string');
  const base = `http://127.0.0.1:${listener.port}`;
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    ...(process.env.CHROME_BIN && { executablePath: process.env.CHROME_BIN }),
  });
  browserVersion = browser.version();
  for (const arm of selectedArms) {
    const state: FixtureState = {
      nonce: 0,
      epoch: 0,
      entries: ['10'.repeat(32)],
      night: 0,
      wallet: 0,
      txHash: '01'.repeat(32),
    };
    const calls: string[] = [];
    const fundingIds: string[] = [];
    const fundedIds = new Map<string, number>();
    let unknownFunding = false;
    let unknownWithdrawal = false;
    let unsettledGrantSpend = false;
    let unknownSession = false;
    let unknownRevocation = false;
    let holdSessionSpend: (() => Promise<void>) | undefined;
    let heldOwnerAction: string | undefined;
    let holdOwnerReceipt: (() => Promise<void>) | undefined;
    let receiptReadUnavailable = false;
    let serviceUnavailable = false;
    let staleOwnerReads = false;
    let staleReadCount = 0;
    let rejectNextDialog = false;
    const contexts: BrowserContext[] = [];
    const fixture = (action: string, request: Record<string, unknown>) => {
      calls.push(action);
      if (
        action === 'spend' &&
        (!state.grant?.active ||
          state.grant.spent + Number(request.amount) > Number(state.grant.scope.cap))
      )
        return false;
      if (
        [
          'rotate',
          'enroll',
          'enroll-owner',
          'remove',
          'issue',
          'revoke',
          'withdraw',
          'spend',
        ].includes(action)
      )
        state.nonce++;
      state.txHash = state.nonce.toString(16).padStart(64, '0');
      if (action === 'enroll-owner') {
        state.ownerPublicKey = String(request.publicKey);
        state.entries.push(state.ownerPublicKey);
      }
      if (action === 'rotate') state.epoch++;
      if (action === 'enroll') state.entries.push(target);
      if (action === 'remove') state.entries = state.entries.filter((e) => e !== request.target);
      if (action === 'issue')
        state.grant = {
          id: typeof request.grantId === 'string' ? request.grantId : grantId,
          active: true,
          scope: request.scope as Record<string, unknown>,
          spent: 0,
        };
      if (action === 'revoke') state.grant!.active = false;
      if (action === 'withdraw') {
        state.night -= Number(request.amount);
        state.wallet += Number(request.amount);
      }
      if (action === 'spend') {
        state.grant!.spent += Number(request.amount);
        state.night -= Number(request.amount);
        state.wallet += Number(request.amount);
      }
      return true;
    };
    const newPage = async (existing?: BrowserContext, reactExample = false, fragment = '') => {
      const context = existing ?? (await browser!.newContext({ serviceWorkers: 'block' }));
      if (!existing) {
        contexts.push(context);
        await context.route('**/*', async (route) => {
          try {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin === origin && url.pathname === '/__demo-fixture') {
              const data = request.postDataJSON() as Record<string, unknown>;
              const action = String(data.action);
              if (action === 'state' && receiptReadUnavailable) {
                await route.fulfill({ status: 503, json: { code: 'IndexerUnavailable' } });
              } else if (action === 'spend' && holdSessionSpend) {
                fixture(action, data);
                await holdSessionSpend();
                await route.fulfill({ json: state });
              } else if (action === 'spend' && unknownSession) {
                fixture(action, data); // Realistic fake: effect occurred, acknowledgement was lost.
                await route.fulfill({ status: 503, json: { code: 'SubmissionUnknown' } });
              } else if (action === 'revoke' && unknownRevocation) {
                fixture(action, data);
                await route.fulfill({ status: 503, json: { code: 'SubmissionUnknown' } });
              } else if (action === 'withdraw' && unknownWithdrawal) {
                calls.push('withdraw-unknown');
                await route.fulfill({ status: 503, json: { code: 'SubmissionUnknown' } });
              } else {
                const accepted = fixture(action, data);
                if (action === heldOwnerAction && holdOwnerReceipt) await holdOwnerReceipt();
                await route.fulfill({
                  status: accepted ? 200 : 409,
                  json: accepted
                    ? action === 'state' && staleOwnerReads
                      ? { ...state, nonce: state.nonce + (staleReadCount++ % 2) }
                      : {
                          ...state,
                          ...(action === 'spend' &&
                            unsettledGrantSpend && { grantUnsettled: true }),
                        }
                    : { code: 'GrantRevoked' },
                });
              }
            } else if (url.origin === 'http://localhost:8787') {
              if (url.pathname === '/v1/demo/funding') {
                if (serviceUnavailable) {
                  await route.fulfill({
                    status: 503,
                    json: { error: 'Synthetic service unavailable' },
                  });
                  return;
                }
                if (request.method() === 'POST') {
                  const data = request.postDataJSON();
                  fundingIds.push(data.requestId);
                  if (unknownFunding) {
                    await route.fulfill({
                      status: 503,
                      json: { error: 'Synthetic funding outcome unknown; reconcile original ID' },
                    });
                    return;
                  }
                  if (!fundedIds.has(data.requestId)) {
                    state.night += 10;
                    fundedIds.set(data.requestId, state.night);
                  }
                  await route.fulfill({
                    json: {
                      ...data,
                      amount: '10',
                      txId: '70'.repeat(32),
                      creditedBalance: String(fundedIds.get(data.requestId)),
                    },
                  });
                } else if (url.searchParams.has('accountAddress')) {
                  await route.fulfill({
                    json: {
                      accountAddress: address,
                      balances: { night: String(state.night), fundedAsset: String(state.night) },
                    },
                  });
                } else {
                  await route.fulfill({
                    json: { assets: [{ color: night, amount: '10' }], balanceAssetColor: night },
                  });
                }
              } else if (url.pathname === '/v1/demo/value-call') {
                const body = request.postDataJSON();
                assert.equal(body.circuit, 'withdraw_unshielded_with_grant_jubjub');
                const accepted = fixture('spend', { amount: body.args[1].$bigint });
                if (holdSessionSpend) await holdSessionSpend();
                await route.fulfill({
                  status: !accepted || unknownSession ? 503 : 200,
                  json:
                    !accepted || unknownSession
                      ? { error: 'Synthetic session outcome unknown' }
                      : { txHash: state.txHash },
                });
              } else if (url.pathname === '/v1/config' || url.pathname === '/config') {
                await route.fulfill({
                  json: {
                    networkId: 'undeployed',
                    bindingId: 'acc-s3r1.1',
                    manifestSha256: manifest,
                    serviceApiVersion: '1.0.0',
                    artefactUrl: 'http://localhost:8787/v1/zk/acc-s3r1.1',
                    indexerUri: 'http://localhost:18088',
                    indexerWsUri: 'ws://localhost:18088',
                    nodeUri: 'ws://localhost:19944',
                    proofServerUri: 'http://localhost:16300',
                    zkBaseUrl: 'http://localhost:8787/v1/zk/acc-s3r1.1',
                    coinPublicKey: '80'.repeat(32),
                    encryptionPublicKey: '90'.repeat(32),
                  },
                });
              } else {
                failures.push(`unhandled-service:${url.pathname}`);
                await route.abort();
              }
            } else if (url.origin === origin) {
              // Raw requests go only to our owned Vite server; no existing localhost app is touched.
              const response = await route.fetch({
                url: `${base}${url.pathname}${url.search}`,
                // Only source-module GETs from our owned Vite server: never replay account/value requests.
                maxRetries: request.method() === 'GET' ? 2 : 0,
              });
              await route.fulfill({ response });
            } else {
              // Fonts and browser telemetry are not needed; unexpected network access fails the run.
              if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname))
                failures.push(`unhandled-network:${url.hostname}`);
              await route.abort();
            }
          } catch (error) {
            if (!closingContexts.has(context)) {
              failures.push(
                `route-error:${error instanceof Error ? error.message.split('\n')[0] : 'unknown'}`,
              );
            }
            await route.abort().catch(() => {});
          }
        });
        await context.addInitScript(() => {
          const nativeNow = Date.now;
          const clock = window as unknown as { __sessionClockOffset?: number };
          Date.now = () => nativeNow() + (clock.__sessionClockOffset ?? 0);
        });
      }
      const page = await context.newPage();
      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });
      page.on('dialog', (dialog) => {
        if (rejectNextDialog) {
          rejectNextDialog = false;
          void dialog.dismiss();
        } else void dialog.accept();
      });
      if (reactExample) {
        // Install before any example code; a regression cannot open a real credential prompt.
        await page.addInitScript({
          content: `
          window.__reactCredentialCalls = 0;
          Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
            async create() { window.__reactCredentialCalls++; throw Error('Unexpected credential access'); },
            async get() { window.__reactCredentialCalls++; throw Error('Unexpected credential access'); }
          }});
        `,
        });
        await page.goto(`${origin}/examples/react-activity.html`);
        await page.locator('#react-revision').filter({ hasText: 'Revision 0' }).waitFor();
        return page;
      }
      await page.goto(`${origin}/?mockPasskey&fixtureArm=${arm}${fragment}`);
      await page
        .locator('#status')
        .filter({ hasText: /^Ready\./ })
        .waitFor({ state: 'attached' })
        .catch(async (error: unknown) => {
          console.error(
            'Startup errors:',
            failures,
            pageErrors,
            await page.locator('#status').allTextContents(),
          );
          throw error;
        });
      await observeCredentialAccess(page);
      return page;
    };
    const done = (name: string) => {
      cases.push({ arm, name });
      console.log(`PASS ${arm}: ${name}`);
    };
    const waitStatus = async (page: Page, expected: RegExp, expectedError?: RegExp) => {
      try {
        await settleWithCeremonyReviews(page);
        const codes = await page.evaluate(
          () =>
            (window as unknown as { __passportPurposeFailureCodes?: string[] })
              .__passportPurposeFailureCodes ?? [],
        );
        assert.deepEqual(
          codes,
          [],
          'unexpected credential observer failure, even in a negative scenario',
        );
        assert.match(
          await page
            .locator('#status')
            .textContent()
            .then((text) => text ?? ''),
          expected,
        );
        if (expectedError)
          assert.match(
            (
              await page.locator('#log .run').first().locator('.error-message').allTextContents()
            ).join('\n'),
            expectedError,
          );
      } catch (error) {
        const codes = await page
          .evaluate(
            () =>
              (window as unknown as { __passportPurposeFailureCodes?: string[] })
                .__passportPurposeFailureCodes ?? [],
          )
          .catch(() => [] as string[]);
        credentialFailureCodes.push(...codes);
        console.error(
          'Journey status:',
          await page
            .locator('#status')
            .textContent()
            .then((text) => text ?? ''),
        );
        console.error('Fixture/browser errors:', failures, pageErrors);
        throw error;
      }
    };
    const approve = async (page: Page, action: string) => {
      await page.bringToFront();
      // Each authenticated action is declined first: no handler, credential or driver effect.
      const beforeCalls = calls.length;
      const beforeCredential = await page.evaluate(() =>
        localStorage.getItem('passport-dev:mock-passkey:v1'),
      );
      await click(page, `#${action}`);
      await page.locator('#consent-dialog').waitFor({ state: 'visible' });
      await click(page, '#consent-cancel');
      await waitStatus(page, /declined before passkey/);
      assert.equal(calls.length, beforeCalls, `declining ${action} must not invoke a driver`);
      assert.ok(
        (await page.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1'))) ===
          beforeCredential,
        `declining ${action} must not use a credential`,
      );
      await click(page, `#${action}`);
      await page.locator('#consent-dialog').waitFor({ state: 'visible' });
      if (action === 'create') await check(page, '#consent-retirement-ack');
      await click(page, '#consent-continue');
    };
    try {
      const owner = await newPage();
      assert.equal(await owner.locator('#main').getAttribute('data-landing'), 'true');
      assert.equal(await owner.locator('#workspace-overview').isVisible(), true);
      assert.equal(await owner.locator('.workspace-nav').isVisible(), false);
      assert.equal(await owner.locator('#navigation-toggle').isVisible(), false);
      assert.equal(await owner.locator('#landing-demo-tools > summary').isVisible(), true);
      assert.equal(calls.length, 0);
      assert.equal(
        await owner.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1')),
        null,
      );
      done(
        'signed-out landing hides workspace navigation and starts no credential or account work',
      );
      await owner.locator('#landing-demo-tools > summary').click();
      await owner.locator('#landing-audit').click();
      assert.equal(await owner.locator('#workspace-audit').isVisible(), true);
      await navClick(owner, '#nav-overview');
      assert.equal(await owner.locator('#main').getAttribute('data-landing'), 'true');
      assert.equal(calls.length, 0);
      done('landing Demo tools keeps Audit reachable without logging in or clearing account state');
      const react = await newPage(undefined, true);
      const beforeReactCalls = calls.length;
      assert.equal(await react.locator('#react-runtime').innerText(), 'React 19.3.1');
      assert.deepEqual(await react.locator('.theme-a h3').allTextContents(), [
        'Current operation',
        'Your journey',
      ]);
      assert.deepEqual(await react.locator('.theme-b h3').allTextContents(), [
        'Your journey',
        'Current operation',
      ]);
      await react.locator('#react-publish').click();
      await react.locator('#react-revision').filter({ hasText: 'Revision 1' }).waitFor();
      assert.equal(await react.locator('[data-phase="unknown"]').count(), 2);
      await react.locator('#react-toggle').click();
      assert.equal(await react.locator('.theme-a').count(), 0);
      await react.locator('#react-toggle').click();
      assert.match(
        await react.locator('.theme-a .intent').innerText(),
        /original-synthetic-intent/,
      );
      assert.equal(await react.locator('#react-revision').innerText(), 'Revision 1');
      await react.locator('.theme-b [data-action="audit"]').click();
      await react
        .locator('#react-audit-output')
        .filter({ hasText: 'synthetic-operation' })
        .waitFor();
      assert.equal(await react.locator('#react-revision').innerText(), 'Revision 1');
      await react.locator('#react-resolve').click();
      await react.locator('#react-revision').filter({ hasText: 'Revision 2' }).waitFor();
      assert.equal(await react.locator('[data-phase="succeeded"]').count(), 2);
      assert.equal(
        await react.evaluate(
          () => (window as unknown as { __reactCredentialCalls: number }).__reactCredentialCalls,
        ),
        0,
      );
      assert.equal(calls.length, beforeReactCalls);
      await react.close();
      await owner.bringToFront();
      done(
        'optional React StrictMode hosts use public snapshots without credential access, command replay or SDK effects',
      );
      const external = await newPage();
      const externalCallsBefore = calls.length;
      const recipientBeforeExternal = await external.locator('#withdraw-recipient').inputValue();
      await click(external, '#lace-wallet-discover');
      assert.match(await external.locator('#lace-wallet-status').innerText(), /No compatible/);
      await external.evaluate(async () => {
        const path = '/e2e/fixtures/lace-provider.ts';
        const fixture = await import(/* @vite-ignore */ path);
        fixture.installLaceFixture();
      });
      const fixtureCall = async (method: string, value?: string) =>
        external.evaluate(
          async ({ method, value }) => {
            const path = '/e2e/fixtures/lace-provider.ts';
            const fixture = await import(/* @vite-ignore */ path);
            return fixture[method](value);
          },
          { method, value },
        );
      await click(external, '#lace-wallet-discover');
      assert.equal(await external.locator('#lace-wallet-provider option').count(), 3);
      assert.equal(await external.locator('#lace-wallet-connect').isDisabled(), true);
      assert.equal(await external.locator('#lace-wallet-controls img').count(), 0);
      await select(external, '#lace-wallet-provider', '10000000-0000-0000-0000-000000000001');
      await click(external, '#lace-wallet-connect');
      await external.keyboard.press('Tab');
      assert.equal(
        await external.evaluate(() => document.activeElement?.id),
        'lace-wallet-approve',
      );
      await external.keyboard.press('Shift+Tab');
      assert.equal(await external.evaluate(() => document.activeElement?.id), 'lace-wallet-cancel');
      await external.keyboard.press('Escape');
      assert.deepEqual(await fixtureCall('laceFixtureCalls'), []);
      await click(external, '#lace-wallet-connect');
      await external.locator('#lace-wallet-approve').click();
      await external
        .locator('#lace-wallet-status')
        .filter({ hasText: 'Connected for this page' })
        .waitFor();
      await click(external, '#wallet-tab-lace');
      assert.match(
        await external.locator('#lace-wallet-snapshot').innerText(),
        /NIGHT[\s\S]*5 smallest units/,
      );
      assert.equal(
        await external.locator('#withdraw-recipient').inputValue(),
        recipientBeforeExternal,
      );
      assert.match((await external.locator('#account-empty').textContent()) ?? '', /No account/);
      await external.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await external.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'external-wallet long address must fit mobile',
      );
      await click(external, '#nav-settings');
      assert.ok(
        await external.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'provider advertisements and controls must fit mobile',
      );
      await external.setViewportSize({ width: 1280, height: 900 });
      await click(external, '#nav-wallet');
      await fixtureCall('setLaceFixtureMode', 'wrong-network');
      await click(external, '#lace-wallet-refresh');
      await click(external, '#nav-settings');
      await external
        .locator('#lace-wallet-status')
        .filter({ hasText: 'NetworkMismatch' })
        .waitFor();
      assert.match(
        (await external.locator('#lace-wallet-snapshot').textContent()) ?? '',
        /Balance unavailable/,
      );
      await fixtureCall('setLaceFixtureMode', 'reject');
      await click(external, '#lace-wallet-connect');
      await external.locator('#lace-wallet-approve').click();
      await external
        .locator('#lace-wallet-status')
        .filter({ hasText: 'PermissionRejected' })
        .waitFor();
      assert.doesNotMatch(
        await external.locator('#lace-wallet-status').innerText(),
        /private detail/,
      );
      await fixtureCall('setLaceFixtureMode', 'delay');
      await click(external, '#lace-wallet-connect');
      await external.locator('#lace-wallet-approve').click();
      await external.locator('#lace-wallet-status').filter({ hasText: 'Waiting for' }).waitFor();
      await click(external, '#lace-wallet-forget');
      await fixtureCall('releaseLaceFixture');
      await external.waitForTimeout(30);
      assert.match(await external.locator('#lace-wallet-status').innerText(), /forgotten/);
      await fixtureCall('setLaceFixtureMode', 'ready');
      await click(external, '#lace-wallet-connect');
      const connectCountBeforeReplacement = (
        (await fixtureCall('laceFixtureCalls')) as string[]
      ).filter((c) => c === 'connect').length;
      await fixtureCall('replaceLaceFixture');
      await external.locator('#lace-wallet-approve').click();
      await external
        .locator('#lace-wallet-status')
        .filter({ hasText: 'ProviderUnavailable' })
        .waitFor();
      assert.equal(
        ((await fixtureCall('laceFixtureCalls')) as string[]).filter((c) => c === 'connect').length,
        connectCountBeforeReplacement,
      );
      assert.equal(
        await external.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1')),
        null,
      );
      assert.equal(calls.length, externalCallsBefore, 'wallet reads must not call the ACC driver');
      await external.close();
      await owner.bringToFront();
      done(
        'optional Lace Wallet has explicit review, separate read-only balances, network/rejection/replacement refusals and late-result forget fencing',
      );
      const obscured = await newPage();
      await obscured.evaluate(() =>
        document.addEventListener(
          'passport:present-ceremony',
          () => document.getElementById('activity-toggle')!.click(),
          { once: true },
        ),
      );
      const callsBeforeObscured = calls.length;
      await approve(obscured, 'create');
      await obscured.locator('#ceremony-continue').click();
      await waitStatus(obscured, /UserCancelled/, /explanation is not visible/);
      assert.equal(
        await obscured.evaluate(
          () =>
            (window as unknown as { __passportPurposeObservations: unknown[] })
              .__passportPurposeObservations.length,
        ),
        0,
      );
      assert.equal(calls.length, callsBeforeObscured);
      await obscured.close();
      await owner.bringToFront();
      done('hiding Activity between approval and browser access refuses the credential call');
      const controlChecks = await owner.evaluate(async () => {
        const path = '/e2e/fixtures/activity-controls-check.ts';
        const module = (await import(/* @vite-ignore */ path)) as {
          checkActivityControls(): {
            hosts: number;
            markupEscaped: boolean;
            themesIndependent: boolean;
            remountReplays: number;
            originalIntentPreserved: boolean;
          };
        };
        return module.checkActivityControls();
      });
      assert.deepEqual(controlChecks, {
        hosts: 2,
        markupEscaped: true,
        themesIndependent: true,
        remountReplays: 0,
        originalIntentPreserved: true,
      });
      assert.equal(calls.length, 0);
      done(
        'two white-label Activity hosts render shared public snapshots with independent cleanup and no replay',
      );
      await openNavigation(owner);
      assert.deepEqual(await owner.locator('.workspace-nav-group > button').allTextContents(), [
        'Overview',
        'Passport account',
        'Midnight wallet',
        'Audit',
        'Settings',
      ]);
      for (const label of [
        'Overview',
        'Passport account',
        'Midnight wallet',
        'Audit',
        'Settings',
      ]) {
        const control = owner.getByRole('button', { name: label, exact: true });
        assert.equal(await control.count(), 1, 'decorative icons preserve accessible names');
        const icon = control.locator('svg');
        assert.equal(await icon.getAttribute('aria-hidden'), 'true');
        assert.equal(await icon.getAttribute('focusable'), 'false');
        assert.equal(await icon.getAttribute('stroke'), 'currentColor');
      }
      assert.equal(await owner.locator('#create svg, #open svg').count(), 2);
      const menuPositions = () =>
        owner.locator('.workspace-nav-group > button').evaluateAll((items) => {
          const nav = document.querySelector<HTMLElement>('.workspace-nav')!;
          return items.map(
            (item) =>
              item.getBoundingClientRect().top - nav.getBoundingClientRect().top + nav.scrollTop,
          );
        });
      const originalMenuPositions = await menuPositions();
      const contentTop = await owner
        .locator('.workspace-center')
        .evaluate((item) => item.getBoundingClientRect().top);
      for (const control of [
        '#account-tab-deposit',
        '#wallet-tab-lace',
        '#audit-tab-requests',
        '#settings-tab-developer',
        '#nav-settings',
      ]) {
        await navClick(owner, control);
        const current = await menuPositions();
        assert.ok(
          current.every((top, index) => Math.abs(top - originalMenuPositions[index]!) < 1),
          'navigation row positions must not change with the selected page',
        );
        assert.equal(
          await owner
            .locator('.workspace-center')
            .evaluate((item) => item.getBoundingClientRect().top),
          contentTop,
        );
        assert.equal(
          await owner.evaluate(() => scrollY),
          0,
          'navigation must not scroll the document',
        );
      }
      for (const id of ['account', 'wallet', 'audit', 'settings'])
        assert.equal(await owner.locator(`#nav-${id}-submenu`).isVisible(), true);
      await navClick(owner, '#wallet-tab-builtin');
      assert.equal(await owner.locator('#wallet-page-builtin').isVisible(), true);
      assert.equal(await owner.locator('#wallet-page-lace').isVisible(), false);
      await navClick(owner, '#wallet-tab-lace');
      assert.equal(await owner.locator('#lace-wallet-view').isVisible(), true);
      assert.equal(await owner.locator('#wallet-page-builtin').isVisible(), false);
      for (const id of ['events', 'requests', 'export']) {
        await navClick(owner, `#audit-tab-${id}`);
        assert.equal(await owner.locator(`#audit-page-${id}`).isVisible(), true);
        assert.equal(
          await owner.locator('#workspace-audit [data-workspace-page]:visible').count(),
          1,
        );
        assert.equal(await owner.locator('.workspace-submenu [aria-current="page"]').count(), 1);
        assert.equal(await owner.evaluate(() => location.hash), `#audit/${id}`);
      }
      await navClick(owner, '#nav-overview');
      assert.equal(calls.length, 0);
      done(
        'persistent navigation keeps parent positions and document scroll stable; wallet and Audit use consistent side-effect-free page links',
      );

      await navClick(owner, '#nav-settings');
      await owner.setViewportSize({ width: 390, height: 844 });
      await owner.locator('#navigation-toggle').waitFor({ state: 'visible' });
      assert.equal(await owner.locator('#navigation-toggle').isVisible(), true);
      assert.equal(await owner.locator('.workspace-nav').isVisible(), false);
      const compactTop = await owner
        .locator('.workspace-center')
        .evaluate((item) => item.getBoundingClientRect().top);
      await owner.locator('#navigation-toggle').click();
      assert.equal(await owner.locator('#navigation-sheet').isVisible(), true);
      assert.equal(await owner.evaluate(() => document.activeElement?.id), 'navigation-close');
      await owner.keyboard.press('Shift+Tab');
      assert.equal(
        await owner.evaluate(() => document.activeElement?.id),
        'settings-tab-developer',
      );
      await owner.keyboard.press('Tab');
      assert.equal(await owner.evaluate(() => document.activeElement?.id), 'navigation-close');
      await owner.keyboard.press('Escape');
      await owner.locator('#navigation-sheet').waitFor({ state: 'hidden' });
      await owner.waitForFunction(() => document.activeElement?.id === 'navigation-toggle');
      await navClick(owner, '#wallet-tab-lace');
      await owner.locator('#navigation-sheet').waitFor({ state: 'hidden' });
      await owner.waitForFunction(() => document.activeElement?.id === 'workspace-wallet-title');
      assert.equal(await owner.locator('#lace-wallet-view').isVisible(), true);
      assert.equal(
        await owner
          .locator('.workspace-center')
          .evaluate((item) => item.getBoundingClientRect().top),
        compactTop,
      );
      assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await owner.locator('#navigation-toggle').click();
      await owner.setViewportSize({ width: 1280, height: 900 });
      await owner.locator('#navigation-sheet').waitFor({ state: 'hidden' });
      assert.equal(await owner.locator('main > .workspace-nav').count(), 1);
      assert.equal(await owner.locator('#navigation-sheet .workspace-nav').count(), 0);
      assert.equal(await owner.locator('.workspace-nav').count(), 1);
      await owner.locator('#wallet-tab-lace').focus();
      await owner.setViewportSize({ width: 390, height: 844 });
      await owner.locator('#navigation-toggle').waitFor({ state: 'visible' });
      await owner.waitForFunction(() => document.activeElement?.id === 'navigation-toggle');
      await owner.setViewportSize({ width: 1280, height: 900 });
      await owner.waitForFunction(() => document.activeElement?.id === 'workspace-wallet-title');

      await navClick(owner, '#nav-overview');
      assert.equal(calls.length, 0);
      done(
        'compact navigation drawer contains focus, returns focus on cancel or navigation, and resizes without duplicating controls or shifting content',
      );
      for (const [fragment, control] of [
        ['#wallet/lace', '#wallet-tab-lace'],
        ['#audit/requests', '#audit-tab-requests'],
        ['#wallet/unknown', '#wallet-tab-builtin'],
        ['#audit/unknown', '#audit-tab-events'],
      ]) {
        const linked = await newPage(undefined, false, fragment);
        assert.equal(await linked.locator(control!).getAttribute('aria-current'), 'page');
        await linked.close();
      }
      await owner.bringToFront();
      assert.equal(calls.length, 0);
      done(
        'wallet and Audit deep links select presentation only, with safe fallback for unknown subpages',
      );
      assert.equal(await owner.locator('#activity-panel').isVisible(), false);
      assert.equal(await owner.locator('#activity-toggle').getAttribute('aria-expanded'), 'false');
      assert.equal(await owner.locator('.overview-welcome').count(), 1);
      assert.equal(
        await owner.locator('.overview-welcome > h3').textContent(),
        'Get started with Passport',
      );
      assert.equal(
        (await owner.locator('.landing-introduction h1').innerText()).replace(/\s+/g, ' '),
        'Your Passport account for the Midnight network.',
      );
      assert.deepEqual(
        (await owner.locator('.overview-choices button').allTextContents()).map((text) =>
          text.trim(),
        ),
        ['Sign up', 'Log in'],
      );
      assert.ok(
        await owner
          .locator('#create')
          .evaluate((button) => button.classList.contains('btn-primary')),
      );
      assert.ok(
        await owner
          .locator('#open')
          .evaluate(
            (button) =>
              button.classList.contains('btn-secondary') &&
              !button.classList.contains('btn-primary'),
          ),
      );
      assert.equal(await owner.locator('.overview-welcome > .overview-note').count(), 1);
      assert.equal(
        await owner.locator('#overview-open-address > summary').textContent(),
        'Log in with an account address',
      );
      assert.equal(await owner.locator('#open-address').isVisible(), false);
      await owner.locator('#overview-open-address > summary').click();
      assert.equal(await owner.locator('#open-address').isVisible(), true);
      await owner.locator('#open-address').fill('not-an-address');
      assert.equal(await owner.locator('#openAt').isDisabled(), true);
      await owner.locator('#open-address').fill(address);
      assert.equal(await owner.locator('#openAt').isEnabled(), true);
      await owner.locator('#overview-open-address > summary').click();
      await navClick(owner, '#nav-wallet');
      await navClick(owner, '#nav-overview');
      assert.equal(await owner.locator('#open-address').inputValue(), address);
      assert.equal(await owner.locator('#open-address').isVisible(), false);
      const choiceBounds = await owner.locator('.overview-choices button').evaluateAll((buttons) =>
        buttons.map((button) => {
          const bounds = button.getBoundingClientRect();
          return { x: bounds.x, y: bounds.y, height: bounds.height, width: bounds.width };
        }),
      );
      assert.ok(choiceBounds[1]!.y >= choiceBounds[0]!.y + choiceBounds[0]!.height);
      assert.ok(Math.abs(choiceBounds[0]!.x - choiceBounds[1]!.x) < 2);
      assert.ok(Math.abs(choiceBounds[0]!.width - choiceBounds[1]!.width) < 2);
      await owner.setViewportSize({ width: 390, height: 844 });
      assert.equal(await owner.locator('#navigation-toggle').isVisible(), false);
      assert.equal(await owner.locator('.workspace-nav').isVisible(), false);
      assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.ok(
        await owner.locator('.overview-choices button').evaluateAll((buttons) =>
          buttons.every((button) => {
            const bounds = button.getBoundingClientRect();
            return bounds.width >= 44 && bounds.height >= 44;
          }),
        ),
        'landing entry actions retain usable touch targets',
      );
      await owner.setViewportSize({ width: 1280, height: 900 });
      if (process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS && arm === 'p256') {
        const screenshots = process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS;
        await mkdir(screenshots, { recursive: true });
        await owner.emulateMedia({ colorScheme: 'dark' });
        await owner.screenshot({
          path: resolve(screenshots, 'overview-idle-desktop.png'),
          animations: 'disabled',
          fullPage: true,
        });
        await owner.setViewportSize({ width: 390, height: 844 });
        assert.equal(await owner.locator('#navigation-toggle').isVisible(), false);
        assert.equal(await owner.locator('.workspace-nav').isVisible(), false);
        assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await owner.screenshot({
          path: resolve(screenshots, 'overview-idle-mobile.png'),
          animations: 'disabled',
          fullPage: true,
        });
        await owner.setViewportSize({ width: 1280, height: 900 });
      }
      assert.equal(calls.length, 0);
      assert.equal(
        await owner.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1')),
        null,
      );
      done(
        'landing offers balanced Sign up and Log in actions; optional address login preserves drafts without credential or account work',
      );
      assert.deepEqual(
        await owner
          .locator('#activity-content .operation-status > h2, #activity-content .journey > h2')
          .allTextContents(),
        ['Current operation', 'Your journey'],
      );
      assert.equal(await owner.locator('#capability-operation').isVisible(), false);
      assert.equal(await owner.locator('#session-minutes').isVisible(), false);
      for (const view of ['account', 'wallet', 'audit', 'settings', 'overview']) {
        await navClick(owner, `#nav-${view}`);
        assert.equal(await owner.locator(`#workspace-${view}`).isVisible(), true);
        assert.equal(await owner.locator('.workspace-view:visible').count(), 1);
      }
      assert.equal(calls.length, 0);
      assert.equal(
        await owner.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1')),
        null,
      );
      await navClick(owner, '#nav-settings');
      assert.deepEqual(await owner.locator('.settings-nav a').allTextContents(), [
        'Devices & passkeys',
        'Quick actions',
        'Permissions',
        'Wallet connections',
        'Developer tools',
      ]);
      assert.equal(await owner.locator('#nav-settings + .settings-nav').isVisible(), true);
      assert.equal(await owner.locator('#nav-settings').getAttribute('aria-expanded'), null);
      assert.equal(await owner.locator('#nav-account-submenu').isVisible(), true);
      assert.equal(await owner.locator('#workspace-settings > .settings-nav').count(), 0);
      assert.equal(await owner.locator('[data-settings-page]:visible').count(), 1);
      assert.equal(await owner.locator('#workspace-settings > details').count(), 0);
      for (const page of ['sessions', 'grants', 'wallets', 'developer', 'security']) {
        await navClick(owner, `#settings-tab-${page}`);
        assert.equal(await owner.locator('[data-settings-page]:visible').count(), 1);
        assert.equal(await owner.evaluate(() => location.hash), `#settings/${page}`);
      }
      await owner.locator('#joiner-account-address').fill(address);
      await navClick(owner, '#settings-tab-grants');
      assert.equal(await owner.locator('#grantee-account-address').inputValue(), address);
      await navClick(owner, '#settings-tab-wallets');
      await navClick(owner, '#settings-tab-security');
      assert.equal(await owner.locator('#joiner-account-address').inputValue(), address);
      await owner.setViewportSize({ width: 390, height: 844 });
      assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await owner.setViewportSize({ width: 1280, height: 900 });
      const settingsLink = await newPage(undefined, false, '#settings/sessions');
      assert.equal(
        await settingsLink.locator('#settings-tab-sessions').getAttribute('aria-current'),
        'page',
      );
      assert.equal(await settingsLink.locator('#unlockRoutine').isEnabled(), false);
      await settingsLink.close();
      const unknownSettings = await newPage(undefined, false, '#settings/unknown');
      assert.equal(
        await unknownSettings.locator('#settings-tab-security').getAttribute('aria-current'),
        'page',
      );
      await unknownSettings.close();
      await owner.bringToFront();
      assert.equal(calls.length, 0);
      done(
        'Settings submenus preserve public drafts, deep-link safely and fit mobile without credential effects',
      );
      await navClick(owner, '#nav-audit');
      assert.equal(await owner.locator('#nav-settings-submenu').isVisible(), true);
      assert.equal(await owner.locator('#nav-settings').getAttribute('aria-expanded'), null);
      assert.equal(await owner.locator('#activity-panel').isVisible(), false);
      const wide = await owner.locator('.workspace-center').evaluate((e) => e.clientWidth);
      await owner.locator('#activity-toggle').click();
      assert.equal(await owner.locator('#activity-panel').isVisible(), true);
      assert.ok((await owner.locator('.workspace-center').evaluate((e) => e.clientWidth)) < wide);
      await click(owner, '#nav-settings');
      assert.equal(await owner.locator('#demo-configuration').isVisible(), false);
      await navClick(owner, '#settings-tab-developer');
      assert.match(await owner.locator('#demo-configuration').innerText(), new RegExp(manifest));
      assert.match(await owner.locator('#demo-configuration').innerText(), /acc-s3r1.1/);
      assert.equal(await owner.locator('#demo-configuration input').count(), 0);
      await navClick(owner, '#settings-tab-security');
      await navClick(owner, '#nav-overview');
      done('five workspaces separate settings and Audit without credentials or connector effects');
      await click(owner, '#account-tab-balances');
      assert.deepEqual(await owner.locator('.account-tabs a').allTextContents(), [
        'Balances',
        'Deposit',
        'Withdraw',
      ]);
      assert.equal(await owner.locator('#nav-account + .account-tabs').isVisible(), true);
      assert.equal(await owner.locator('#nav-account').getAttribute('aria-expanded'), null);
      assert.equal(await owner.locator('#workspace-account > .account-tabs').count(), 0);
      assert.equal(await owner.locator('.account-tabs').getAttribute('role'), null);
      assert.equal(await owner.locator('#account-page-balances').isVisible(), true);
      assert.equal(await owner.locator('#fund').isVisible(), false);
      await owner.locator('#account-tab-balances').focus();
      await owner.keyboard.press('ArrowDown');
      assert.equal(
        await owner.locator('#account-tab-balances').getAttribute('aria-current'),
        'page',
      );
      assert.equal(await owner.locator('#account-tab-deposit').getAttribute('aria-current'), null);
      await owner.keyboard.press('Enter');
      assert.equal(
        await owner.locator('#account-tab-deposit').getAttribute('aria-current'),
        'page',
      );
      assert.equal(await owner.evaluate(() => document.activeElement?.id), 'account-tab-deposit');
      await owner.keyboard.press('End');
      await owner.keyboard.press('Enter');
      assert.equal(await owner.locator('#account-page-withdraw').isVisible(), true);
      assert.equal(await owner.locator('#account-page-balances').isVisible(), false);
      assert.equal(await owner.locator('#account-page-deposit').isVisible(), false);
      assert.equal(await owner.locator('#withdraw').isEnabled(), false);
      await owner.keyboard.press('Home');
      await owner.keyboard.press('Enter');
      assert.equal(
        await owner.locator('#account-tab-balances').getAttribute('aria-current'),
        'page',
      );
      await owner.keyboard.press('ArrowUp');
      await owner.keyboard.press('Enter');
      assert.equal(
        await owner.locator('#account-tab-withdraw').getAttribute('aria-current'),
        'page',
      );
      await owner.setViewportSize({ width: 390, height: 844 });
      assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await owner.setViewportSize({ width: 1280, height: 900 });
      assert.equal(calls.length, 0);
      assert.equal(
        await owner.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1')),
        null,
      );
      done(
        'consistent account page links support arrow keyboard navigation and mobile layout without an account, credentials or implicit actions',
      );
      const deepLinked = await newPage(undefined, false, '#account/deposit');
      assert.equal(await deepLinked.locator('#nav-account').getAttribute('aria-current'), 'page');
      assert.equal(
        await deepLinked.locator('#account-tab-deposit').getAttribute('aria-current'),
        'page',
      );
      assert.equal(await deepLinked.locator('#fund').isEnabled(), false);
      await deepLinked.close();
      const unknownTab = await newPage(undefined, false, '#account/unknown');
      assert.equal(
        await unknownTab.locator('#account-tab-balances').getAttribute('aria-current'),
        'page',
      );
      await unknownTab.close();
      await owner.bringToFront();
      assert.equal(calls.length, 0);
      done(
        'account operation deep links restore presentation only; unknown subpages fall back to balances',
      );
      await navClick(owner, '#nav-overview');

      assert.equal(await owner.locator('.workspace-center #progress').count(), 0);
      assert.equal(await owner.locator('.workspace-center #status').count(), 0);
      assert.equal(await owner.locator('.workspace-center #ceremony-purpose').count(), 0);
      assert.equal(await owner.locator('#activity-content #progress').count(), 1);
      assert.equal(await owner.locator('#activity-content #ceremony-purpose').count(), 1);
      assert.equal(await owner.locator('#activity-content #operation-safety-notice').count(), 1);
      done('Activity owns progress, results and explanations without a floating header banner');

      await owner.setViewportSize({ width: 390, height: 844 });
      await owner.locator('#activity-panel').waitFor({ state: 'hidden' });
      assert.equal(await owner.locator('#activity-panel').isVisible(), false);
      await owner.locator('#activity-toggle').click();
      assert.equal(
        await owner.locator('#activity-sheet').evaluate((e) => (e as HTMLDialogElement).open),
        true,
      );
      assert.equal(
        await owner.locator('#activity-close').evaluate((e) => e === document.activeElement),
        true,
      );
      assert.deepEqual(
        await owner
          .locator('#activity-sheet .operation-status > h2, #activity-sheet .journey > h2')
          .allTextContents(),
        ['Current operation', 'Your journey'],
      );
      await owner.keyboard.press('Shift+Tab');
      assert.equal(
        await owner.locator('#activity-sheet').evaluate((e) => e.contains(document.activeElement)),
        true,
      );
      await owner.keyboard.press('Escape');
      await owner.locator('#activity-sheet').waitFor({ state: 'hidden' });
      await owner.waitForFunction(() => document.activeElement?.id === 'activity-toggle');
      assert.equal(
        await owner.locator('#activity-sheet').evaluate((e) => (e as HTMLDialogElement).open),
        false,
      );
      assert.equal(
        await owner.locator('#activity-toggle').evaluate((e) => e === document.activeElement),
        true,
      );
      assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(calls.length, 0);
      done(
        'mobile Activity sheet contains focus and Escape restores the trigger without starting work',
      );
      await owner.setViewportSize({ width: 1280, height: 900 });
      if (process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS && arm === 'p256') {
        const screenshots = process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS;
        await mkdir(screenshots, { recursive: true });
        await owner.setViewportSize({ width: 1280, height: 900 });
        await owner.screenshot({ path: resolve(screenshots, 'desktop.png'), fullPage: true });
        await owner.setViewportSize({ width: 390, height: 844 });
        await owner.screenshot({ path: resolve(screenshots, 'mobile.png'), fullPage: true });
        assert.ok(
          await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          'mobile page must not overflow horizontally',
        );
        await owner.setViewportSize({ width: 1280, height: 900 });
      }
      await click(owner, '#create');
      await owner.locator('#consent-dialog').waitFor({ state: 'visible' });
      await assert.rejects(owner.locator('#activity-toggle').click({ timeout: 200 }));
      await assert.rejects(owner.locator('#nav-settings').click({ timeout: 200 }));
      assert.ok(await owner.locator('#consent-continue').isDisabled());
      await click(owner, '#consent-cancel');
      await waitStatus(owner, /declined before passkey/);
      assert.equal(await owner.locator('#main').getAttribute('data-landing'), 'true');
      assert.equal(await owner.locator('#workspace-account').isVisible(), false);
      assert.equal(calls.length, 0);
      assert.equal(
        await owner.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1')),
        null,
      );
      done('declined irreversible create has no credential or connector effect');
      assert.equal(
        await owner.locator('.operation-status').getAttribute('data-phase'),
        'cancelled',
      );
      assert.equal(await owner.locator('#progress').getAttribute('aria-valuenow'), null);
      assert.match(await owner.locator('#progress-label').innerText(), /attempt cancelled/);
      assert.match(
        (await owner.locator('#audit-operation-1 .run-meta').textContent()) ?? '',
        /Cancelled attempt/,
      );
      await owner.locator('[data-control="operation-audit-link"]').click();
      assert.equal(await owner.locator('#workspace-audit').isVisible(), true);
      assert.equal(await owner.locator('#audit-operation-1').count(), 1);
      assert.equal(await owner.locator('#activity-panel').isVisible(), false);
      await navClick(owner, '#nav-overview');
      await owner.locator('#activity-toggle').click();
      done(
        'blocking consent prevents background navigation; cancelled attempt links to its original Audit entry',
      );
      await owner.setViewportSize({ width: 390, height: 844 });
      await owner.locator('#activity-panel').waitFor({ state: 'hidden' });
      await owner.locator('#activity-toggle').click();
      await owner.locator('#activity-sheet [data-control="operation-audit-link"]').click();
      await owner.locator('#activity-sheet').waitFor({ state: 'hidden' });
      assert.equal(await owner.locator('#workspace-audit').isVisible(), true);
      await owner.waitForFunction(() => document.activeElement?.id === 'workspace-audit-title');
      assert.equal(calls.length, 0);
      await owner.setViewportSize({ width: 1280, height: 900 });
      await navClick(owner, '#nav-overview');
      await owner.locator('#activity-toggle').click();
      done(
        'mobile operation-to-Audit navigation closes the sheet and focuses the destination without account effects',
      );

      const credentialsUsed = () =>
        owner.evaluate(
          () =>
            (window as unknown as { __passportPurposeObservations: unknown[] })
              .__passportPurposeObservations.length,
        );
      await approve(owner, 'create');
      await owner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
      await owner.setViewportSize({ width: 390, height: 844 });
      await assert.rejects(owner.locator('#activity-toggle').click({ timeout: 200 }));
      assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await credentialsUsed(), 0, 'operation approval alone must not use a passkey');
      assert.equal(
        await owner.locator('#ceremony-cancel').evaluate((e) => e === document.activeElement),
        true,
      );
      await owner.keyboard.press('Escape');
      await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
      await owner.setViewportSize({ width: 1280, height: 900 });
      assert.equal(await credentialsUsed(), 0);
      assert.equal(calls.length, 0);
      done('Escape on the first ceremony refuses credential creation and deployment');
      done('mobile passkey review remains a separate blocking dialog above the workspace');

      await owner.addScriptTag({
        type: 'module',
        url: `${origin}/e2e/fixtures/consent-controls.ts`,
      });
      const controlsRefusal = () =>
        owner.evaluate(() =>
          (
            window as unknown as { __consentControls: { refused(): Promise<string> } }
          ).__consentControls.refused(),
        );
      assert.equal(await controlsRefusal(), 'UserCancelled');
      await approve(owner, 'create');
      await owner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
      const pendingId = await owner.locator('#ceremony-dialog').getAttribute('data-ceremony-id');
      assert.equal(await controlsRefusal(), 'UserCancelled', 'overlapping requests must refuse');
      assert.equal(
        await owner.locator('#ceremony-dialog').getAttribute('data-ceremony-id'),
        pendingId,
      );
      await owner.evaluate(() =>
        (window as unknown as { __consentControls: { finish(): void } }).__consentControls.finish(),
      );
      await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
      assert.equal(await credentialsUsed(), 0);
      assert.equal(calls.length, 0);
      assert.equal(await controlsRefusal(), 'UserCancelled');
      done(
        'operation termination closes pending consent; overlap and ended approvals cannot access a credential',
      );

      await owner.setViewportSize({ width: 390, height: 844 });
      await approve(owner, 'create');
      await owner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
      await click(owner, '#ceremony-continue');
      await owner
        .locator('#ceremony-details')
        .filter({ hasText: /second request checks/ })
        .waitFor();
      assert.equal(await credentialsUsed(), 1, 'only the expressly approved create was accessed');
      await click(owner, '#ceremony-cancel');
      await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
      assert.equal(
        await credentialsUsed(),
        1,
        'declining verification must not assert the passkey',
      );
      assert.equal(calls.length, 0, 'declining the probe must not deploy');
      assert.equal(
        await owner.locator('#activity-sheet').evaluate((e) => (e as HTMLDialogElement).open),
        false,
      );
      await owner.setViewportSize({ width: 1280, height: 900 });
      done(
        'approved mobile access reveals its purpose in Activity and closes the automatic sheet when the operation ends',
      );
      done('the second initial prompt requires separate approval before the compatibility probe');

      if (arm === 'p256') {
        await approve(owner, 'create');
        for (const purpose of ['create', 'verify-created', 'sign']) {
          await owner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
          assert.equal(
            await owner.locator('#ceremony-purpose').getAttribute('data-purpose'),
            purpose,
          );
          const id = await owner.locator('#ceremony-dialog').getAttribute('data-ceremony-id');
          await click(owner, '#ceremony-continue');
          await owner.waitForFunction((previous) => {
            const dialog = document.getElementById('ceremony-dialog') as HTMLDialogElement;
            return !dialog.open || dialog.dataset.ceremonyId !== previous;
          }, id);
        }
        await owner
          .locator('#ceremony-details')
          .filter({ hasText: /Setup signature 2/ })
          .waitFor();
        const beforeCancel = await credentialsUsed();
        await click(owner, '#ceremony-cancel');
        await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
        assert.equal(await credentialsUsed(), beforeCancel);
        assert.equal(calls.filter((c) => c === 'publish-envelope').length, 1);
        assert.equal(calls.filter((c) => c === 'publish-registration').length, 0);
        done(
          'each later setup signature needs new approval; declining preserves the prior publication',
        );
      }

      await approve(owner, 'create');
      await waitStatus(owner, /is created/);
      await assertAccountWorkspace(owner);
      done('acknowledged creation and one explicit approval per credential request');
      await archiveObservations(owner, arm);
      // Revisit the landing before reload: saved passkey hints must not reopen the account.
      // Explicit workspace deep links retain their separate presentation-only coverage.
      await navClick(owner, '#nav-overview');
      await owner.reload();
      await owner
        .locator('#status')
        .filter({ hasText: /^Ready\./ })
        .waitFor({ state: 'attached' });
      await observeCredentialAccess(owner);
      assert.equal(await owner.locator('#main').getAttribute('data-landing'), 'true');
      assert.equal(await owner.locator('#workspace-account').isVisible(), false);
      await approve(owner, 'open');
      await owner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
      assert.equal(
        await owner.locator('#ceremony-purpose').getAttribute('data-purpose'),
        'identify-and-unlock',
      );
      await click(owner, '#ceremony-cancel');
      await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
      assert.equal(await owner.locator('#main').getAttribute('data-landing'), 'true');
      assert.equal(await owner.locator('#workspace-account').isVisible(), false);
      assert.equal(
        await credentialsUsed(),
        0,
        'declining combined login prevents both identification and PRF access',
      );
      done(
        'combined login has an explicit purpose review; declining it starts no credential access',
      );

      const beforeLogin = await credentialsUsed();
      const beforeLoginOwnerEnrollment = calls.filter((action) => action === 'enroll-owner').length;
      await approve(owner, 'open');
      await waitStatus(owner, /is reopened/);
      await assertAccountWorkspace(owner);
      assert.equal(
        await credentialsUsed(),
        beforeLogin + 1,
        'login uses one actual credential call',
      );
      assert.match((await owner.locator('#routine-status').textContent())!, /locked/);
      assert.equal(
        calls.filter((action) => action === 'enroll-owner').length,
        beforeLoginOwnerEnrollment,
        'login never enrolls a companion owner',
      );
      assert.equal(
        await owner.locator('#ceremony-purpose').getAttribute('data-purpose'),
        'identify-and-unlock',
      );
      done(
        'active account login uses one combined request without unlocking or enrolling an owner',
      );
      await fill(owner, '#open-address', address);
      const beforeAddressLogin = await credentialsUsed();
      await approve(owner, 'openAt');
      await waitStatus(owner, /opened by address/);
      await assertAccountWorkspace(owner);
      assert.equal(
        await credentialsUsed(),
        beforeAddressLogin + 1,
        'address login uses one actual credential call',
      );
      assert.match((await owner.locator('#routine-status').textContent())!, /locked/);
      done('address login uses one combined request and leaves retained account keys locked');
      done(
        'reload stays on landing; successful creation, login and address login select account balances',
      );

      await approve(owner, 'holdings');
      await owner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
      assert.equal(
        await owner.locator('#ceremony-purpose').getAttribute('data-purpose'),
        'derive-keys',
      );
      const beforeUnlock = await credentialsUsed();
      const readsBeforeUnlock = calls.filter((c) => c === 'holdings').length;
      await click(owner, '#ceremony-cancel');
      await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
      assert.equal(await credentialsUsed(), beforeUnlock);
      assert.equal(calls.filter((c) => c === 'holdings').length, readsBeforeUnlock);
      done('declining PRF unlock prevents credential access and the dependent holdings read');

      for (const [action, status] of [
        ['refresh', /Account|ACC|refreshed/i],
        ['roster', /roster|device|entries/i],
        ['grantRoster', /grant/i],
      ] as const) {
        const before = await owner.locator('#ceremony-purpose').innerText();
        if (await owner.locator('#activity-panel').isVisible())
          await owner.locator('#activity-toggle').click();
        await click(owner, `#${action}`);
        await waitStatus(owner, status);
        assert.equal(await owner.locator('#activity-panel').isVisible(), true);
        assert.equal(await owner.locator('#ceremony-purpose').innerText(), before);
      }
      await owner.setViewportSize({ width: 390, height: 844 });
      const beforePublicRead = await credentialsUsed();
      await click(owner, '#refresh');
      await waitStatus(owner, /Account|ACC|refreshed/i);
      assert.equal(
        await owner.locator('#activity-sheet').evaluate((e) => (e as HTMLDialogElement).open),
        true,
      );
      assert.equal(await credentialsUsed(), beforePublicRead);
      await owner.locator('#activity-close').click();
      await owner.setViewportSize({ width: 1280, height: 900 });
      await owner.waitForFunction(
        () =>
          document.getElementById('activity-toggle')?.getAttribute('aria-controls') ===
          'activity-panel',
      );
      done(
        'public reads reveal Activity without a ceremony; mobile results stay readable until dismissed',
      );
      if (await owner.locator('#activity-panel').isVisible())
        await owner.locator('#activity-toggle').click();
      assert.equal(await owner.locator('#activity-panel').isVisible(), false);
      await approve(owner, 'holdings');
      await waitStatus(owner, /Verified 1 shielded/);
      assert.equal(await owner.locator('#activity-panel').isVisible(), true);
      done('approved desktop passkey access reveals Activity before calling the credential API');
      done('chain-labelled holdings UI through synthetic driver');
      await approve(owner, 'rotate');
      await waitStatus(owner, /confirmed its new sealed/);
      done('rotation review and result');

      await owner.evaluate(() => {
        const fixture = window as unknown as {
          __demoHoldDust?: () => Promise<void>;
          __demoReleaseDust?: () => void;
        };
        const pending = new Promise<void>((resolve) => {
          fixture.__demoReleaseDust = resolve;
        });
        fixture.__demoHoldDust = () => pending;
      });
      await approve(owner, 'wallet');
      await waitStatus(owner, /wallet connected through/);
      await reveal(owner, '#walletRefresh');
      assert.equal(await owner.locator('#walletRefresh').isEnabled(), true);
      assert.match((await owner.locator('#wallet-facts').textContent()) ?? '', /NIGHT/);
      assert.match(
        (await owner.locator('#wallet-facts').textContent()) ?? '',
        /Syncing independently/,
      );
      await owner.evaluate(() => {
        const fixture = window as unknown as {
          __demoHoldDust?: () => Promise<void>;
          __demoReleaseDust?: () => void;
        };
        fixture.__demoReleaseDust?.();
        delete fixture.__demoHoldDust;
        delete fixture.__demoReleaseDust;
      });
      await owner.waitForFunction(() =>
        document.getElementById('wallet-facts')?.textContent?.includes('0 of 0'),
      );
      done('NIGHT and wallet actions stay ready while DUST sync waits independently');
      const recipient = await owner
        .locator('#wallet-facts .fact')
        .filter({ hasText: 'Unshielded address' })
        .locator('.value')
        .getAttribute('title');
      assert.ok(recipient);
      const beforeAccountNavigation = calls.length;
      await fill(owner, '#withdraw-recipient', recipient);
      await fill(owner, '#withdraw-amount', '3');
      for (const tab of ['deposit', 'balances', 'withdraw'])
        await navClick(owner, `#account-tab-${tab}`);
      assert.equal(await owner.locator('#withdraw-amount').inputValue(), '3');
      assert.equal(await owner.locator('#withdraw-recipient').inputValue(), recipient);
      assert.equal(await owner.locator('#withdraw').isVisible(), true);
      assert.equal(await owner.locator('#fund').isVisible(), false);
      assert.ok(
        (await owner.locator('#account-action-context .value').first().getAttribute('title')) ===
          address,
      );
      await navClick(owner, '#nav-wallet');
      await navClick(owner, '#nav-account');
      assert.equal(
        await owner.locator('#account-tab-withdraw').getAttribute('aria-current'),
        'page',
      );
      assert.equal(await owner.locator('#withdraw-amount').inputValue(), '3');
      await navClick(owner, '#account-tab-balances');
      assert.equal(
        await owner
          .locator('#account-state-details')
          .evaluate((node) => (node as HTMLDetailsElement).open),
        false,
      );
      assert.equal(await owner.locator('#account-state-facts').isVisible(), false);
      await owner.locator('#account-state-details > summary').click();
      assert.match(await owner.locator('#account-state-facts').innerText(), /Auth nonce/);
      await owner.locator('#account-state-details > summary').click();
      assert.equal(calls.length, beforeAccountNavigation);
      done(
        'account forms preserve their values across tabs/workspaces; identity stays visible and technical state remains inspectable',
      );
      if (process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS && arm === 'p256') {
        const folder = process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS;
        await mkdir(folder, { recursive: true });
        for (const theme of ['dark', 'light'] as const) {
          await owner.emulateMedia({ colorScheme: theme });
          for (const tab of ['balances', 'deposit', 'withdraw']) {
            await navClick(owner, `#account-tab-${tab}`);
            await owner.locator('#workspace-account').screenshot({
              path: resolve(folder, `account-${tab}-${theme}.png`),
              style: '.mock-banner { position: static !important; }',
            });
          }
        }
        await owner.setViewportSize({ width: 390, height: 844 });
        assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await owner.locator('#workspace-account').screenshot({
          path: resolve(folder, 'account-withdraw-mobile.png'),
          style: '.mock-banner { position: static !important; }',
        });
        await owner.setViewportSize({ width: 1280, height: 900 });
      }
      await fill(owner, '#withdraw-amount', '1');

      await click(owner, '#fund');
      await waitStatus(owner, /account balance: 10/);
      const successfulFundingId = fundingIds.at(-1)!;
      await owner.evaluate(({ key, id }) => localStorage.setItem(key, id), {
        key: `passport-demo:fund:undeployed:${address}:${night}`,
        id: successfulFundingId,
      });
      await click(owner, '#fund');
      await waitStatus(owner, /account balance: 10/);
      assert.equal(state.night, 10, 'replayed funding ID must not credit twice');
      await fill(owner, '#withdraw-amount', '1');
      await fill(owner, '#withdraw-recipient', 'invalid-recipient');
      const withdrawals = calls.filter((c) => c === 'withdraw').length;
      const beforeInvalidRecipient = await credentialsUsed();
      await owner.setViewportSize({ width: 390, height: 844 });
      await approve(owner, 'withdraw');
      await waitStatus(
        owner,
        /failed\./,
        /Enter a valid unshielded Midnight address for undeployed/,
      );
      assert.equal(calls.filter((c) => c === 'withdraw').length, withdrawals);
      assert.equal(await credentialsUsed(), beforeInvalidRecipient);
      assert.equal(
        await owner.locator('#activity-sheet').evaluate((e) => (e as HTMLDialogElement).open),
        true,
      );
      await owner.locator('#activity-close').click();
      await owner.setViewportSize({ width: 1280, height: 900 });
      done(
        'early failure before any credential ceremony reveals its mobile result without signing or sending',
      );
      const phaseBeforeBackground = await owner
        .locator('.operation-status')
        .getAttribute('data-phase');
      const refsBeforeBackground = await owner.locator('.activity-references').textContent();
      const callsBeforeBackground = calls.length;
      await owner.evaluate(async () => {
        const path = '/src/operation-trace.ts';
        const module = (await import(/* @vite-ignore */ path)) as {
          traceOperation(kind: string, details: Record<string, unknown>): void;
        };
        module.traceOperation('session.state', {
          phase: 'blocked',
          intentId: 'background-not-this-operation',
        });
      });
      assert.equal(
        await owner.locator('.operation-status').getAttribute('data-phase'),
        phaseBeforeBackground,
      );
      assert.equal(await owner.locator('.activity-references').textContent(), refsBeforeBackground);
      assert.equal(calls.length, callsBeforeBackground);
      done('background telemetry cannot relabel a finished attempt or borrow its intent reference');
      const wrongNetwork = MidnightBech32m.encode(
        'preview',
        new UnshieldedAddress(Buffer.alloc(32, 7)),
      ).asString();
      await fill(owner, '#withdraw-recipient', wrongNetwork);
      await approve(owner, 'withdraw');
      await waitStatus(
        owner,
        /failed\./,
        /Enter a valid unshielded Midnight address for undeployed/,
      );
      assert.equal(calls.filter((c) => c === 'withdraw').length, withdrawals);
      await fill(owner, '#withdraw-recipient', recipient);
      rejectNextDialog = true;
      await approve(owner, 'withdraw');
      await waitStatus(owner, /cancelled before signing/i);
      assert.equal(rejectNextDialog, false, 'the exact withdrawal review must have appeared');
      assert.equal(calls.filter((c) => c === 'withdraw').length, withdrawals);
      await approve(owner, 'withdraw');
      await waitStatus(owner, /Withdrawal confirmed/);
      assert.equal(state.night, 9);
      assert.equal(state.wallet, 1);
      await click(owner, '#walletRefresh');
      await waitStatus(owner, /snapshot refreshed/);
      done('fund ten, reject invalid recipient, withdraw one and refresh wallet');
      const beforeRoutineUnlock = await credentialsUsed();
      await approve(owner, 'unlockRoutine');
      await waitStatus(owner, /Quick actions unlocked/);
      assert.equal(await credentialsUsed(), beforeRoutineUnlock + 1);
      const afterRoutineUnlock = await credentialsUsed();
      await approve(owner, 'holdings');
      await waitStatus(owner, /Verified 1 shielded/);
      await approve(owner, 'holdings');
      await waitStatus(owner, /Verified 1 shielded/);
      await approve(owner, 'wallet');
      await waitStatus(owner, /wallet connected through/);
      assert.equal(
        await credentialsUsed(),
        afterRoutineUnlock,
        'unlocked reads and wallet connection must not access the credential API',
      );
      await approve(owner, 'rotate');
      await waitStatus(owner, /confirmed its new sealed/);
      assert.ok(
        (await credentialsUsed()) > afterRoutineUnlock,
        'critical owner changes retain fresh passkey use',
      );
      await click(owner, '#lock-routine');
      assert.match(await owner.locator('#routine-status').innerText(), /locked/);
      const afterRoutineLock = await credentialsUsed();
      await approve(owner, 'holdings');
      await waitStatus(owner, /Verified 1 shielded/);
      assert.ok(
        (await credentialsUsed()) > afterRoutineLock,
        'locked reader cannot reuse old key material',
      );
      done(
        'one PRF unlock serves repeated readings and wallet connection; critical rotation stays fresh and lock prevents reuse',
      );
      for (const action of ['holdings', 'wallet']) {
        await approve(owner, 'unlockRoutine');
        await waitStatus(owner, /Quick actions unlocked/);
        const beforeExpiry = await credentialsUsed();
        await click(owner, `#${action}`);
        await owner.locator('#consent-dialog').waitFor({ state: 'visible' });
        await owner.evaluate(() => {
          (window as unknown as { __sessionClockOffset: number }).__sessionClockOffset =
            31 * 60_000;
        });
        await click(owner, '#consent-continue');
        await waitStatus(owner, /failed\./, /locked or expired/);
        await owner.evaluate(() => {
          (window as unknown as { __sessionClockOffset: number }).__sessionClockOffset = 0;
        });
        assert.equal(
          await credentialsUsed(),
          beforeExpiry,
          'expired review cannot fall back to a passkey',
        );
        assert.equal(await owner.locator('#ceremony-dialog').isVisible(), false);
        done(`${action} review expiry refuses without silently requesting a passkey`);
      }
      await approve(owner, 'unlockRoutine');
      await waitStatus(owner, /Quick actions unlocked/);
      const beforeWalletRace = await credentialsUsed();
      const walletStarts = await owner.evaluate(() => {
        const w = window as unknown as {
          __demoWalletStarts?: number;
          __demoHoldWalletStop?: () => Promise<void>;
          __demoWalletStopping?: boolean;
          __demoReleaseWalletStop?: () => void;
        };
        w.__demoHoldWalletStop = () =>
          new Promise<void>((resolve) => {
            w.__demoWalletStopping = true;
            w.__demoReleaseWalletStop = resolve;
          });
        return w.__demoWalletStarts;
      });
      await approve(owner, 'wallet');
      await owner.waitForFunction(
        () => (window as unknown as { __demoWalletStopping?: boolean }).__demoWalletStopping,
      );
      await owner.evaluate(() => {
        const w = window as unknown as {
          __demoHoldWalletStop?: () => Promise<void>;
          __demoReleaseWalletStop?: () => void;
        };
        window.dispatchEvent(new Event('pagehide'));
        delete w.__demoHoldWalletStop;
        w.__demoReleaseWalletStop!();
      });
      await waitStatus(owner, /failed\./, /locked or expired/);
      assert.equal(
        await owner.evaluate(
          () => (window as unknown as { __demoWalletStarts?: number }).__demoWalletStarts,
        ),
        walletStarts,
      );
      assert.equal(await credentialsUsed(), beforeWalletRace);
      done(
        'lock while the previous wallet stops discards copied seed without starting a new wallet',
      );
      await approve(owner, 'unlockRoutine');
      await waitStatus(owner, /Quick actions unlocked/);
      await owner.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await reveal(owner, '#routine-status');
      assert.match(await owner.locator('#routine-status').innerText(), /locked/);
      done('page exit disposes quick-action keys without revoking or replacing a chain grant');

      await click(owner, '#nav-wallet');
      if (await owner.locator('#activity-panel').isVisible())
        await owner.locator('#activity-toggle').click();
      assert.equal(await owner.locator('#progress').isVisible(), false);
      assert.equal(await owner.locator('#status').isVisible(), false);
      assert.match(await owner.locator('#activity-toggle').innerText(), /Completed/);
      await owner.locator('#activity-toggle').click();
      assert.equal(await owner.locator('#progress').isVisible(), true);
      done('completed operation results stay in collapsible Activity when changing workspace');

      const beforeAudit = calls.length;
      await navClick(owner, '#nav-audit');
      await reveal(owner, '#trace');
      await owner
        .locator('#trace')
        .filter({ hasText: /http.request|funding.intent/ })
        .waitFor();
      assert.match(await owner.locator('#trace').innerText(), /http.request|funding.intent/);
      await owner.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            async writeText(text: string) {
              (window as unknown as { __copiedPublicAudit: string }).__copiedPublicAudit = text;
            },
          },
        });
      });
      await click(owner, '#copy');
      await waitStatus(owner, /Full operation log copied/);
      const copied = await owner.evaluate(() => {
        const text = (window as unknown as { __copiedPublicAudit: string }).__copiedPublicAudit;
        const result = JSON.parse(text) as {
          account: { address: string };
          runs: { result: string; outcome: string }[];
          trace: unknown[];
        };
        const forbidden =
          /"(?:privateKey|prfOutput|seed|authenticatorData|clientDataJSON|bearerToken)"\s*:/i.test(
            text,
          );
        return {
          account: result.account.address,
          runs: result.runs.length,
          trace: result.trace.length,
          forbidden,
          hasCancellation: result.runs.some(
            (run) => run.result === 'done' && run.outcome === 'cancelled',
          ),
        };
      });
      assert.equal(copied.account, address);
      assert.ok(copied.runs > 0 && copied.trace > 0);
      assert.equal(copied.forbidden, false);
      assert.equal(copied.hasCancellation, true);
      assert.equal(calls.length, beforeAudit);
      done(
        'dedicated Audit renders and copies public exchanges without secrets, a real clipboard write or connector effects',
      );

      const joiner = await newPage();
      await fill(joiner, '#open-address', address);
      await approve(joiner, 'prepareJoiner');
      await waitStatus(joiner, /handoff|fingerprint|public keys/i);
      const handoff = await joiner.locator('#handoff-output').inputValue();
      await fill(owner, '#handoff-input', '{}');
      const enrollments = calls.filter((c) => c === 'enroll').length;
      await approve(owner, 'enrollDevice');
      await waitStatus(owner, /failed\./, /handoff does not match|joining-device JSON/i);
      assert.equal(calls.filter((c) => c === 'enroll').length, enrollments);
      await fill(owner, '#handoff-input', handoff);
      staleOwnerReads = true;
      await approve(owner, 'enrollDevice');
      await waitStatus(owner, /failed\./, /ACC roster changed while preparing enrollment/);
      assert.equal(calls.filter((c) => c === 'enroll').length, enrollments);
      staleOwnerReads = false;
      await approve(owner, 'enrollDevice');
      await waitStatus(owner, /Joining device confirmed/);
      await approve(joiner, 'openAt');
      await waitStatus(joiner, /opened by address/);
      await fill(owner, '#remove-commitment', target);
      await approve(owner, 'removeDevice');
      await waitStatus(owner, /entry is absent/);
      assert.equal(state.entries.length, 1);
      done('prepare joiner, reject malformed handoff, enroll, open and remove entry');

      const holder = await newPage();
      await fill(holder, '#open-address', address);
      await approve(holder, 'prepareGrantee');
      await waitStatus(holder, /Public grantee key ready/);
      await fill(owner, '#grant-grantee', await holder.locator('#grantee-output').inputValue());
      await fill(owner, '#grant-recipient', recipient);
      await fill(owner, '#grant-per-call', '1');
      await fill(owner, '#grant-cap', '2');
      const issuesBeforeDecline = calls.filter((c) => c === 'issue').length;
      const credentialsBeforeGrantDecline = await credentialsUsed();
      rejectNextDialog = true;
      await approve(owner, 'issueGrant');
      await waitStatus(owner, /Grant issue cancelled before signing/);
      assert.equal(
        await owner.locator('.operation-status').getAttribute('data-phase'),
        'cancelled',
      );
      assert.equal(await owner.locator('#progress').getAttribute('aria-valuenow'), null);
      assert.equal(calls.filter((c) => c === 'issue').length, issuesBeforeDecline);
      assert.equal(await credentialsUsed(), credentialsBeforeGrantDecline);
      await approve(owner, 'issueGrant');
      await waitStatus(owner, /Grant .*active|grant.*issued/i);
      await fill(owner, '#export-grant-id', grantId);
      rejectNextDialog = true;
      await approve(owner, 'exportGrant');
      await waitStatus(owner, /Grant opening export cancelled/);
      assert.equal(
        await owner.locator('.operation-status').getAttribute('data-phase'),
        'cancelled',
      );
      await approve(owner, 'exportGrant');
      await waitStatus(owner, /Opening ready/);
      await fill(
        holder,
        '#grant-opening-input',
        await owner.locator('#grant-opening-output').inputValue(),
      );
      await fill(holder, '#grant-spend-amount', '1');
      await fill(holder, '#grant-spent-prev', '0');
      const beforeDeclinedSpend = calls.filter((c) => c === 'spend').length;
      rejectNextDialog = true;
      await approve(holder, 'spendGrant');
      await waitStatus(holder, /failed\./, /Spend declined/);
      assert.equal(rejectNextDialog, false, 'the exact grant spend review must have appeared');
      assert.equal(calls.filter((c) => c === 'spend').length, beforeDeclinedSpend);
      await approve(holder, 'spendGrant');
      await waitStatus(holder, /Grant spend .*confirmed/);
      await fill(holder, '#grant-spent-prev', '1');
      unsettledGrantSpend = true;
      await approve(holder, 'spendGrant');
      await waitStatus(holder, /failed\./, /submitted/);
      unsettledGrantSpend = false;
      assert.equal(await holder.locator('.operation-status').getAttribute('data-phase'), 'unknown');
      assert.match(await holder.locator('.operation-status').innerText(), new RegExp(state.txHash));
      await click(holder, '#nav-audit');
      assert.match(
        await holder.locator('#log .run').first().locator('.run-meta').innerText(),
        /Outcome unknown/,
      );
      done(
        'submitted grant spend with unsettled roster preserves its hash and unknown outcome in Activity and Audit',
      );

      await fill(owner, '#revoke-grant-id', grantId);
      const revocationsBeforeDecline = calls.filter((c) => c === 'revoke').length;
      rejectNextDialog = true;
      await approve(owner, 'revokeGrant');
      await waitStatus(owner, /Grant revocation cancelled before signing/);
      assert.equal(
        await owner.locator('.operation-status').getAttribute('data-phase'),
        'cancelled',
      );
      assert.equal(calls.filter((c) => c === 'revoke').length, revocationsBeforeDecline);
      assert.equal(state.grant?.active, true);
      done(
        'declining exact issue, export and revoke reviews reports cancellation without grant mutations',
      );
      await approve(owner, 'revokeGrant');
      await waitStatus(owner, /is revoked/);
      const balance = state.night;
      await approve(holder, 'spendGrant');
      await waitStatus(holder, /failed\./, /Synthetic grant refused/);
      assert.equal(state.night, balance);
      await approve(owner, 'recoverGrants');
      await waitStatus(owner, /Published 0 pending grants/);
      done('prepare holder, issue/export/spend/revoke, refuse revoked spend and recover pending');

      const beforeInspection = calls.length;
      const recipientBeforeLookup = await owner.locator('#withdraw-recipient').inputValue();
      await click(owner, '#name-service-resolve');
      await owner
        .locator('#name-service-status')
        .filter({ hasText: 'Mock record found' })
        .waitFor();
      assert.match(await owner.locator('#name-service-result').innerText(), /"mode": "mock"/);
      assert.match(
        await owner.locator('#name-service-result').innerText(),
        /"networkId": "undeployed"/,
      );
      await fill(owner, '#name-service-name', 'missing.passport.test');
      await click(owner, '#name-service-resolve');
      await owner.locator('#name-service-status').filter({ hasText: 'Name not found' }).waitFor();
      assert.equal(await owner.locator('#name-service-result').innerText(), '');
      await fill(owner, '#name-service-name', 'alice\u202e.passport.test');
      await click(owner, '#name-service-resolve');
      await owner.locator('#name-service-status').filter({ hasText: 'InvalidQuery' }).waitFor();
      assert.equal(await owner.locator('#withdraw-recipient').inputValue(), recipientBeforeLookup);
      assert.equal(calls.length, beforeInspection);
      done(
        'mock name lookup, absence and invalid input never access credentials or change recipient',
      );
      await select(owner, '#capability-operation', 'withdraw-shielded');
      assert.match(
        await owner.locator('#capability-report').innerText(),
        /Exact-value selected shielded coin only/,
      );
      await select(owner, '#capability-operation', 'issue-grant');
      await check(owner, '#capability-read-grant');
      assert.match(await owner.locator('#capability-report').innerText(), /rotate_enc_key_with_/);
      assert.equal(calls.length, beforeInspection);
      done('capability/proof-plan inspection invokes no connector or credentials');

      unknownFunding = true;
      await click(owner, '#fund');
      await waitStatus(owner, /failed\./, /Synthetic funding outcome unknown/);
      const original = fundingIds.at(-1)!;
      assert.equal(await owner.locator('.operation-status').getAttribute('data-phase'), 'unknown');
      assert.equal(await owner.locator('#progress').getAttribute('aria-valuenow'), null);
      assert.match(await owner.locator('#progress-label').innerText(), /not confirmed/);
      assert.match(
        (await owner.locator('#log .run').first().locator('.run-meta').textContent()) ?? '',
        /Outcome unknown/,
      );
      assert.match(
        (await owner.locator('.activity-references').textContent()) ?? '',
        new RegExp(original),
      );
      const beforeUnknownNavigation = fundingIds.length;
      for (const view of ['audit', 'settings', 'account']) await navClick(owner, `#nav-${view}`);
      assert.equal(
        fundingIds.length,
        beforeUnknownNavigation,
        'navigation never retries an unknown deposit',
      );
      assert.match(
        (await owner.locator('.activity-references').textContent()) ?? '',
        new RegExp(original),
      );
      done('unknown deposit IDs survive navigation with no implicit retry');
      await click(owner, '#fund');
      await waitStatus(owner, /failed\./, /Synthetic funding outcome unknown/);
      assert.equal(fundingIds.at(-1), original);
      assert.equal(fundingIds.filter((id) => id === original).length, 2);
      unknownFunding = false;
      done('uncertain funding retains the original request ID across explicit retry');
      unknownWithdrawal = true;
      await approve(owner, 'withdraw');
      await waitStatus(owner, /failed\./, /Synthetic fixture refusal/);
      await owner.waitForTimeout(100);
      assert.equal(calls.filter((c) => c === 'withdraw-unknown').length, 1);
      unknownWithdrawal = false;
      done('uncertain withdrawal is not automatically replayed');
      serviceUnavailable = true;
      await click(owner, '#refresh');
      await waitStatus(owner, /refreshed|unavailable|failed/i);
      await reveal(owner, '#account-facts');
      assert.match(await owner.locator('#account-facts').innerText(), /Latest refresh unavailable/);
      done('balance service outage labels prior snapshots without signing or inferring zero');
      serviceUnavailable = false;
      await owner.bringToFront();
      await fill(owner, '#withdraw-recipient', recipient);
      await fill(owner, '#withdraw-amount', '1');
      await fill(owner, '#session-cap', '2');
      await fill(owner, '#session-per-call', '1');
      const staleTab = await newPage(owner.context());
      await approve(staleTab, 'open');
      await waitStatus(staleTab, /opened/);
      await fill(staleTab, '#withdraw-recipient', recipient);
      await fill(staleTab, '#withdraw-amount', '1');
      const countCredentials = () =>
        owner.evaluate(
          () =>
            (window as unknown as { __passportPurposeObservations: unknown[] })
              .__passportPurposeObservations.length,
        );
      rejectNextDialog = true;
      await approve(owner, 'startSession');
      await waitStatus(owner, /authorization declined before passkey/);
      assert.equal(
        await owner.locator('.operation-status').getAttribute('data-phase'),
        'cancelled',
      );
      await owner.bringToFront();
      await approve(owner, 'unlockRoutine');
      await waitStatus(owner, /Quick actions unlocked/);
      const beforeAuthorize = await countCredentials();
      await approve(owner, 'startSession');
      await waitStatus(owner, /JubJub session active/);
      assert.equal(
        (await countCredentials()) - beforeAuthorize,
        arm === 'p256' ? 3 : 2,
        'the grant child reuses PRF material; owner issue and its journal unlock remain fresh',
      );
      assert.ok(
        (await countCredentials()) > beforeAuthorize,
        'session issue must freshly access the owner passkey',
      );
      assert.equal(state.grant?.scope.expiresAt !== null, true);
      assert.ok(Number(state.grant?.scope.expiresAt) > Date.now() / 1000);
      await reveal(owner, '#session-state');
      assert.match(await owner.locator('#session-state').innerText(), /Ready for quick transfers/);
      assert.match(await owner.locator('#session-current-scope').innerText(), /NIGHT/);
      assert.equal(await owner.locator('#session-state').getAttribute('data-status'), 'active');
      const recordedScope = await owner.locator('#session-current-scope').innerText();
      await click(owner, '#session-edit-target');
      assert.equal(
        await owner.locator('#account-tab-withdraw').getAttribute('aria-current'),
        'page',
      );
      assert.equal(await owner.evaluate(() => document.activeElement?.id), 'withdraw-recipient');
      const credentialsBeforeInspection = await countCredentials();
      const callsBeforeInspection = calls.length;
      await fill(owner, '#withdraw-recipient', recipient + 'draft');
      await reveal(owner, '#session-target-summary');
      assert.match(await owner.locator('#session-target-summary').innerText(), /NIGHT/);
      assert.ok(
        !(await owner.locator('#session-target-summary').innerText()).includes('00'.repeat(32)),
      );
      assert.equal(
        await owner.locator('#session-current-scope').innerText(),
        recordedScope,
        'editing a draft target must not relabel the existing permission',
      );
      await owner.locator('#session-record > summary').click();
      assert.ok((await owner.locator('#session-identifiers').innerText()).includes(recipient));
      assert.ok(
        (await owner.locator('#session-identifiers').innerText()).includes('00'.repeat(32)),
      );
      await owner.locator('#session-record > summary').click();
      await fill(owner, '#withdraw-recipient', recipient);
      await reveal(owner, '#session-minutes');
      await owner.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'session labels, limits and exact values must fit mobile',
      );
      if (process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS && arm === 'p256') {
        const folder = process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS;
        await mkdir(folder, { recursive: true });
        // Capture the actual panel, not an extremely long, expanded Settings page.
        await owner.emulateMedia({ colorScheme: 'dark' });
        await owner
          .locator('#settings-sessions')
          .screenshot({ path: resolve(folder, 'sessions-mobile.png') });
        await owner.setViewportSize({ width: 1440, height: 1000 });
        await owner
          .locator('#settings-sessions')
          .screenshot({ path: resolve(folder, 'sessions-desktop.png') });
        await owner.emulateMedia({ colorScheme: 'light' });
        await owner
          .locator('#settings-sessions')
          .screenshot({ path: resolve(folder, 'sessions-light.png') });
        await owner.emulateMedia({ colorScheme: 'dark' });
      }
      await owner.setViewportSize({ width: 1280, height: 900 });
      assert.equal(await countCredentials(), credentialsBeforeInspection);
      assert.equal(calls.length, callsBeforeInspection);
      done(
        'readable session scope distinguishes draft settings from active authority; exact IDs and mobile inspection never sign or send',
      );

      const beforeSessionSpend = await countCredentials();
      const ownerSendsBefore = calls.filter((c) => c === 'withdraw').length;
      if (await owner.locator('#activity-panel').isVisible())
        await owner.locator('#activity-toggle').click();
      await owner.setViewportSize({ width: 390, height: 844 });
      await approve(owner, 'withdraw');
      await waitStatus(owner, /Withdrawal confirmed/);
      assert.equal(
        await countCredentials(),
        beforeSessionSpend,
        'matching session withdrawal uses no credential API',
      );
      assert.equal(
        calls.filter((c) => c === 'withdraw').length,
        ownerSendsBefore,
        'session uses holder circuit, not owner path',
      );
      assert.equal(state.grant?.spent, 1);
      assert.equal(
        await owner.locator('#activity-sheet').evaluate((e) => (e as HTMLDialogElement).open),
        true,
      );
      assert.match(
        await owner.locator('#activity-sheet .operation-status').innerText(),
        /Completed/,
      );
      await owner.locator('#activity-close').click();
      await owner.setViewportSize({ width: 1280, height: 900 });
      done(
        'consented PRF child session signs without another passkey and shows its mobile result from collapsed Activity',
      );
      const beforeCritical = await countCredentials();
      await approve(owner, 'rotate');
      await waitStatus(owner, /confirmed its new sealed viewing secret/);
      assert.ok(
        (await countCredentials()) > beforeCritical,
        'critical rotation requires a fresh passkey despite an active session',
      );
      done('critical owner rotation cannot reuse the cached session signer');
      let releaseHeldSpend!: () => void;
      let observeHeldSpend!: () => void;
      const heldSpend = new Promise<void>((r) => {
        releaseHeldSpend = r;
      });
      const spendObserved = new Promise<void>((r) => {
        observeHeldSpend = r;
      });
      holdSessionSpend = () => {
        observeHeldSpend();
        return heldSpend;
      };
      await approve(owner, 'withdraw');
      await spendObserved;
      const sendsBeforeConcurrent = calls.filter((c) => c === 'withdraw' || c === 'spend').length;
      await staleTab.bringToFront();
      await click(staleTab, '#withdraw');
      await waitStatus(staleTab, /failed\./, /Another Passport tab is handling an operation/);
      assert.equal(
        calls.filter((c) => c === 'withdraw' || c === 'spend').length,
        sendsBeforeConcurrent,
      );
      await owner.bringToFront();
      done('real browser Web Locks refuse a second shared-storage tab while an effect is pending');
      for (const view of ['audit', 'wallet', 'settings', 'account'])
        await navClick(owner, `#nav-${view}`);
      for (const tab of ['balances', 'deposit', 'withdraw'])
        await navClick(owner, `#account-tab-${tab}`);
      assert.equal(await owner.locator('#withdraw').isEnabled(), false);
      assert.equal(
        calls.filter((c) => c === 'withdraw' || c === 'spend').length,
        sendsBeforeConcurrent,
      );
      assert.equal(await owner.locator('.operation-status').getAttribute('data-phase'), 'running');
      done(
        'workspace/account-tab navigation during a pending spend preserves the operation and sends no replacement',
      );
      assert.ok(
        await owner.locator('#endSession').isEnabled(),
        'explicit lock is available while an operation is running',
      );
      await click(owner, '#endSession');
      assert.match(await readSessionState(owner), /blocked/);
      releaseHeldSpend();
      await waitStatus(owner, /Withdrawal confirmed/);
      holdSessionSpend = undefined;
      assert.match(await readSessionState(owner), /locked/);
      assert.match(
        await owner.locator('#session-current-scope').innerText(),
        /2 \/ 2 smallest units/,
      );
      done(
        'immediate lock during settlement retains a confirmed transfer and keeps the signer locked',
      );
      await click(owner, '#endSession');
      await waitStatus(owner, /Local session locked/);
      assert.ok(state.grant?.active, 'local lock is not chain revocation');
      const beforeAfterLock = await countCredentials();
      await approve(owner, 'withdraw');
      await waitStatus(owner, /Withdrawal confirmed/);
      assert.ok(
        (await countCredentials()) > beforeAfterLock,
        'local lock restores owner passkey authorization',
      );
      const revokesBeforeSessionDecline = calls.filter((c) => c === 'revoke').length;
      const credentialsBeforeSessionDecline = await countCredentials();
      rejectNextDialog = true;
      await approve(owner, 'revokeSession');
      await waitStatus(owner, /Session grant revocation cancelled before signing/);
      assert.equal(
        await owner.locator('.operation-status').getAttribute('data-phase'),
        'cancelled',
      );
      assert.equal(calls.filter((c) => c === 'revoke').length, revokesBeforeSessionDecline);
      assert.equal(await countCredentials(), credentialsBeforeSessionDecline);
      done(
        'declined exact session authorization and revocation reviews are cancelled without owner-key or grant effects',
      );
      await approve(owner, 'revokeSession');
      await waitStatus(owner, /Session grant revoked on chain/);
      assert.equal(state.grant?.active, false);
      done('local lock erases authority locally and a fresh owner ceremony revokes the grant');
      await approve(owner, 'unlockRoutine');
      await waitStatus(owner, /Quick actions unlocked/);
      await approve(owner, 'startSession');
      await waitStatus(owner, /JubJub session active/);
      await click(owner, '#lock-routine');
      assert.equal(await readSessionState(owner), 'locked');
      assert.equal(state.grant?.active, true, 'local cache lock does not revoke the chain grant');
      await approve(owner, 'revokeSession');
      await waitStatus(owner, /Session grant revoked on chain/);
      done(
        'routine cache lock disposes its derived grant signer while leaving chain revocation explicit',
      );
      await approve(owner, 'startSession');
      await waitStatus(owner, /JubJub session active/);
      const independentScope = await owner.locator('#session-current-scope').innerText();
      const beforeDeclinedRoutine = await countCredentials();
      await approve(owner, 'unlockRoutine');
      await owner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
      await click(owner, '#ceremony-cancel');
      await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
      assert.equal(await countCredentials(), beforeDeclinedRoutine);
      assert.equal(await readSessionState(owner), 'active');
      await approve(owner, 'unlockRoutine');
      await waitStatus(owner, /Quick actions unlocked/);
      assert.equal(await readSessionState(owner), 'active');
      await click(owner, '#lock-routine');
      assert.equal(await readSessionState(owner), 'active');
      assert.equal(await owner.locator('#session-current-scope').innerText(), independentScope);
      assert.equal(state.grant?.active, true);
      done(
        'cancelled or successful routine unlock and cache lock preserve an independently authorized grant signer',
      );
      await owner.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // visible page: no lock
      await owner.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
      assert.match(await readSessionState(owner), /locked/);
      const storedSession = await owner.evaluate(() =>
        localStorage.getItem('passport-demo:session:v1:undeployed:acc-s3r1.1'),
      );
      assert.ok(
        storedSession && !/scopeSalt|sessionId|private|authoriser|seed|secret/.test(storedSession),
        'only public metadata is retained',
      );
      await archiveObservations(owner, arm);
      await owner.reload();
      await owner
        .locator('#status')
        .filter({ hasText: /^Ready\./ })
        .waitFor({ state: 'attached' });
      await observeCredentialAccess(owner);
      assert.match(await readSessionState(owner), /locked/);
      await approve(owner, 'open');
      await waitStatus(owner, /opened/);
      await approve(owner, 'revokeSession');
      await waitStatus(owner, /Session grant revoked on chain/);
      done('pagehide/reload retains public grant metadata without restoring a signing session');
      await fill(owner, '#withdraw-recipient', recipient);
      await fill(owner, '#withdraw-amount', '1');
      await approve(owner, 'startSession');
      await waitStatus(owner, /JubJub session active/);
      await owner.evaluate(() => {
        (window as unknown as { __sessionClockOffset: number }).__sessionClockOffset = 16 * 60_000;
      });
      await owner.waitForFunction(
        () => document.getElementById('session-state')!.dataset.status === 'expired',
      );
      await owner.evaluate(() => {
        (window as unknown as { __sessionClockOffset: number }).__sessionClockOffset = 0;
      });
      await approve(owner, 'revokeSession');
      await waitStatus(owner, /Session grant revoked on chain/);
      done('absolute session expiry disposes the signer and requires fresh owner authorization');
      await approve(owner, 'startSession');
      await waitStatus(owner, /JubJub session active/);
      unknownSession = true;
      await approve(owner, 'withdraw');
      await waitStatus(owner, /failed\./, /Synthetic session outcome unknown/);
      assert.equal(await owner.locator('.operation-status').getAttribute('data-phase'), 'unknown');
      assert.equal(await owner.locator('#progress').getAttribute('aria-valuenow'), null);
      assert.match(
        await owner.locator('#activity-toggle').innerText(),
        /Needs attention|Hide Activity/,
      );
      await navClick(owner, '#nav-audit');
      assert.match(await owner.locator('#activity-toggle').innerText(), /Needs attention/);
      assert.equal(await owner.locator('#operation-safety-notice').isVisible(), false);
      await owner.locator('#activity-toggle').click();
      assert.equal(await owner.locator('#operation-safety-notice').isVisible(), true);
      await readSessionState(owner);
      const unknownSessionIntent = await owner
        .locator('#session-state')
        .getAttribute('data-intent-id');
      assert.ok(unknownSessionIntent);
      assert.ok(
        (await owner.locator('.activity-references').textContent())?.includes(unknownSessionIntent),
      );
      assert.ok(
        (await owner.locator('#operation-safety-notice').textContent())?.includes(
          unknownSessionIntent,
        ),
      );
      done(
        'lost session acknowledgement is an unknown outcome with its original intent and persistent safety notice',
      );
      const sendsAfterUnknown = calls.filter((c) => c === 'spend' || c === 'withdraw').length;
      unknownSession = false;
      const stalePrompts = await staleTab.evaluate(
        () =>
          (window as unknown as { __passportPurposeObservations: unknown[] })
            .__passportPurposeObservations.length,
      );
      await approve(staleTab, 'withdraw');
      await waitStatus(staleTab, /failed\./, /Reconcile the original session transaction/);
      await click(staleTab, '#endSession');
      await waitStatus(staleTab, /Local session locked/);
      assert.equal(
        calls.filter((c) => c === 'spend' || c === 'withdraw').length,
        sendsAfterUnknown,
      );
      assert.equal(
        await staleTab.evaluate(
          () =>
            (window as unknown as { __passportPurposeObservations: unknown[] })
              .__passportPurposeObservations.length,
        ),
        stalePrompts,
      );
      done('stale tab cannot bypass or erase an independent unknown-spend fence');
      await approve(owner, 'withdraw');
      await waitStatus(owner, /failed\./, /Reconcile the original session transaction/);
      assert.equal(
        calls.filter((c) => c === 'spend' || c === 'withdraw').length,
        sendsAfterUnknown,
        'unknown session never falls back or retries',
      );
      await archiveObservations(owner, arm);
      await owner.reload();
      await owner
        .locator('#status')
        .filter({ hasText: /^Ready\./ })
        .waitFor({ state: 'attached' });
      await observeCredentialAccess(owner);
      assert.match(await readSessionState(owner), /blocked/);
      await approve(owner, 'open');
      await waitStatus(owner, /opened/);
      await fill(owner, '#withdraw-recipient', recipient);
      await approve(owner, 'withdraw');
      await waitStatus(owner, /failed\./, /Reconcile the original session transaction/);
      assert.equal(
        calls.filter((c) => c === 'spend' || c === 'withdraw').length,
        sendsAfterUnknown,
        'page reload retains uncertainty fence',
      );
      done('lost session spend acknowledgement blocks retry and owner fallback across page reload');
      const revoker = await newPage();
      await approve(revoker, 'create');
      await waitStatus(revoker, /created/);
      await fill(revoker, '#withdraw-recipient', recipient);
      await approve(revoker, 'startSession');
      await waitStatus(revoker, /JubJub session active/);
      const revokeCalls = calls.filter((c) => c === 'revoke').length;
      unknownRevocation = true;
      await approve(revoker, 'revokeSession');
      await waitStatus(revoker, /failed\./, /Synthetic fixture refusal/);
      unknownRevocation = false;
      await approve(revoker, 'revokeSession');
      await waitStatus(revoker, /failed\./, /Reconcile/);
      await archiveObservations(revoker, arm);
      await revoker.reload();
      await revoker
        .locator('#status')
        .filter({ hasText: /^Ready\./ })
        .waitFor({ state: 'attached' });
      await observeCredentialAccess(revoker);
      await approve(revoker, 'open');
      await waitStatus(revoker, /opened/);
      await approve(revoker, 'revokeSession');
      await waitStatus(revoker, /failed\./, /Reconcile/);
      assert.equal(calls.filter((c) => c === 'revoke').length, revokeCalls + 1);
      done('uncertain revocation is never replayed and remains fenced across reload');

      const fullOwner = await newPage();
      await approve(fullOwner, 'create');
      await waitStatus(fullOwner, /created/);
      const ownerCredentials = () =>
        fullOwner.evaluate(
          () =>
            (window as unknown as { __passportPurposeObservations: unknown[] })
              .__passportPurposeObservations.length,
        );
      const initialEnrollments = calls.filter((c) => c === 'enroll-owner').length;
      if (arm === 'p256') {
        rejectNextDialog = true;
        await approve(fullOwner, 'unlockOwner');
        await waitStatus(fullOwner, /failed\./, /Owner enrollment declined/);
        assert.equal(calls.filter((c) => c === 'enroll-owner').length, initialEnrollments);
        done('full owner enrollment is explicit; declining creates no on-chain owner');
      }
      await approve(fullOwner, 'unlockOwner');
      await waitStatus(fullOwner, /Account unlocked/);
      const publicOwner = await fullOwner.locator('#authenticated-owner-key').textContent();
      assert.match(publicOwner!, /^[0-9a-f]{64}$/);
      assert.equal(
        calls.filter((c) => c === 'enroll-owner').length,
        initialEnrollments + (arm === 'p256' ? 1 : 0),
      );
      await fullOwner.setViewportSize({ width: 390, height: 844 });
      await fullOwner.locator('#authenticated-owner-key').locator('..').locator('summary').click();
      assert.ok(await fullOwner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS)
        await fullOwner.screenshot({
          path: resolve(
            process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS,
            `${arm}-authenticated-owner-mobile.png`,
          ),
          fullPage: true,
        });
      await fullOwner.locator('#authenticated-owner-key').locator('..').locator('summary').click();
      await fullOwner.setViewportSize({ width: 1280, height: 900 });
      done('authenticated owner public-key disclosure fits the mobile workspace');
      assert.ok(
        !(await fullOwner.locator('#workspace-settings').innerText()).includes(
          'administration still requires your passkey',
        ),
      );
      const ownerDialogs: string[] = [];
      fullOwner.on('dialog', (dialog) => ownerDialogs.push(dialog.message()));
      const authenticatedCredentials = await ownerCredentials();
      await approve(fullOwner, 'holdings');
      await waitStatus(fullOwner, /Verified 1 shielded/);
      await approve(fullOwner, 'wallet');
      await waitStatus(fullOwner, /wallet connected through/);
      await approve(fullOwner, 'rotate');
      await waitStatus(fullOwner, /confirmed its new sealed/);
      await fill(fullOwner, '#handoff-input', handoff);
      await approve(fullOwner, 'enrollDevice');
      await waitStatus(fullOwner, /Joining device confirmed/);
      await fill(fullOwner, '#remove-commitment', target);
      await approve(fullOwner, 'removeDevice');
      await waitStatus(fullOwner, /selected entry is absent/i);
      await fill(fullOwner, '#grant-grantee', publicOwner!);
      await fill(fullOwner, '#grant-recipient', recipient);
      await fill(fullOwner, '#grant-per-call', '1');
      await fill(fullOwner, '#grant-cap', '2');
      await approve(fullOwner, 'issueGrant');
      await waitStatus(fullOwner, /Grant.*confirmed|Grant.*active|Grant.*issued/i);
      await fill(fullOwner, '#revoke-grant-id', state.grant!.id);
      await approve(fullOwner, 'revokeGrant');
      await waitStatus(fullOwner, /revoked/i);
      await fill(fullOwner, '#withdraw-recipient', recipient);
      await fill(fullOwner, '#withdraw-amount', '1');
      await approve(fullOwner, 'startSession');
      await waitStatus(fullOwner, /JubJub session active/);
      await approve(fullOwner, 'revokeSession');
      await waitStatus(fullOwner, /Session grant revoked on chain/);
      assert.ok(
        ownerDialogs.some((text) => text.includes('Grant issuer: authenticated JubJub full owner')),
      );
      assert.ok(
        ownerDialogs.some(
          (text) =>
            text.includes('Revoke session grant') &&
            text.includes('Authorization: authenticated JubJub full owner'),
        ),
      );
      done(
        'scoped grant issue and revocation disclose the authenticated full-owner issuer without credential access',
      );
      await approve(fullOwner, 'withdraw');
      await waitStatus(fullOwner, /Withdrawal confirmed/);
      assert.ok(
        ownerDialogs.some((text) =>
          text.includes('Authorization: authenticated JubJub full owner (no new passkey prompt)'),
        ),
      );
      assert.ok(
        !ownerDialogs.some((text) =>
          /fresh owner passkey|Critical actions still require your passkey/.test(text),
        ),
      );
      assert.ok(
        ownerDialogs.some(
          (text) =>
            text.includes('selected scoped session does not match') &&
            text.includes('owner authority instead'),
        ),
      );
      done('exact owner withdrawal confirmation names the authenticated full owner');
      assert.equal(
        await ownerCredentials(),
        authenticatedCredentials,
        'all owner operations must reuse the authenticated JubJub owner',
      );
      done(
        'authenticated deterministic JubJub owner performs readings, wallet connection, rotation, enrollment, removal, grants and transfer without new credential access',
      );
      const rotationsBeforeExpiry = calls.filter((c) => c === 'rotate').length;
      await click(fullOwner, '#rotate');
      await fullOwner.locator('#consent-dialog').waitFor({ state: 'visible' });
      await fullOwner.evaluate(() => {
        (window as unknown as { __sessionClockOffset: number }).__sessionClockOffset = 31 * 60_000;
      });
      await click(fullOwner, '#consent-continue');
      await waitStatus(fullOwner, /failed\./, /locked or expired/);
      await fullOwner.evaluate(() => {
        (window as unknown as { __sessionClockOffset: number }).__sessionClockOffset = 0;
      });
      assert.equal(calls.filter((c) => c === 'rotate').length, rotationsBeforeExpiry);
      assert.equal(await ownerCredentials(), authenticatedCredentials);
      done(
        'expired full-owner approval cannot fall back to a passkey or submit owner administration',
      );
      const enrollmentsAfterFirstUnlock = calls.filter((c) => c === 'enroll-owner').length;
      await approve(fullOwner, 'unlockOwner');
      await waitStatus(fullOwner, /Account unlocked/);
      assert.equal(await fullOwner.locator('#authenticated-owner-key').textContent(), publicOwner);
      assert.equal(calls.filter((c) => c === 'enroll-owner').length, enrollmentsAfterFirstUnlock);
      assert.equal(
        await ownerCredentials(),
        authenticatedCredentials + 1,
        'reauthentication needs only the pinned PRF unlock, not enrollment',
      );
      await click(fullOwner, '#lock-routine');
      await approve(fullOwner, 'rotate');
      await waitStatus(fullOwner, /confirmed its new sealed/);
      assert.ok((await ownerCredentials()) > authenticatedCredentials + 1);
      done(
        'reauthentication restores the same owner without enrollment; local lock returns to explicitly reviewed passkey access',
      );

      for (const scenario of ['rotate', 'removeDevice', 'revokeGrant', 'indexer-outage']) {
        await approve(fullOwner, 'unlockOwner');
        await waitStatus(fullOwner, /Account unlocked/);
        if (scenario === 'removeDevice') {
          await fill(fullOwner, '#handoff-input', handoff);
          await approve(fullOwner, 'enrollDevice');
          await waitStatus(fullOwner, /Joining device confirmed/);
          await fill(fullOwner, '#remove-commitment', target);
        }
        if (scenario === 'revokeGrant') {
          await approve(fullOwner, 'issueGrant');
          await waitStatus(fullOwner, /Grant.*active/i);
          await fill(fullOwner, '#revoke-grant-id', state.grant!.id);
        }
        let releaseReceipt!: () => void;
        let observeReceipt!: () => void;
        const heldReceipt = new Promise<void>((resolve) => {
          releaseReceipt = resolve;
        });
        const receiptObserved = new Promise<void>((resolve) => {
          observeReceipt = resolve;
        });
        const action = scenario === 'indexer-outage' ? 'rotate' : scenario;
        heldOwnerAction =
          action === 'removeDevice' ? 'remove' : action === 'revokeGrant' ? 'revoke' : action;
        holdOwnerReceipt = () => {
          observeReceipt();
          return heldReceipt;
        };
        const originalCalls = calls.filter((call) => call === heldOwnerAction).length;
        const credentialsBefore = await ownerCredentials();
        await approve(fullOwner, action);
        await receiptObserved;
        const originalHash = state.txHash;
        await fullOwner.evaluate(() => {
          (window as unknown as { __sessionClockOffset: number }).__sessionClockOffset =
            31 * 60_000;
        });
        await fullOwner
          .locator('#routine-status')
          .filter({ hasText: /expired/ })
          .waitFor({ state: 'attached' });
        receiptReadUnavailable = scenario === 'indexer-outage';
        releaseReceipt();
        await waitStatus(
          fullOwner,
          scenario === 'rotate'
            ? /confirmed its new sealed/
            : scenario === 'removeDevice'
              ? /selected entry is absent/
              : scenario === 'revokeGrant'
                ? /revoked on chain/
                : /Transaction receipt retained/,
        );
        receiptReadUnavailable = false;
        assert.equal(calls.filter((call) => call === heldOwnerAction).length, originalCalls + 1);
        assert.equal(await ownerCredentials(), credentialsBefore);
        heldOwnerAction = undefined;
        holdOwnerReceipt = undefined;
        await fullOwner.evaluate(() => {
          (window as unknown as { __sessionClockOffset: number }).__sessionClockOffset = 0;
        });
        await navClick(fullOwner, '#nav-audit');
        await reveal(fullOwner, '#evidence');
        await fullOwner
          .locator('#evidence')
          .filter({ hasText: originalHash })
          .waitFor({ state: 'visible' });
        assert.match(
          (await fullOwner.locator('#evidence').textContent())!,
          /accountOperationReceipt/,
        );
        done(
          `confirmed owner ${scenario} retains its original receipt after local expiry without another signer or submission`,
        );
      }

      await approve(fullOwner, 'unlockOwner');
      await waitStatus(fullOwner, /Account unlocked/);
      await fullOwner.evaluate(() => {
        (window as unknown as { __partialOwnerRotation: boolean }).__partialOwnerRotation = true;
      });
      let releasePartial!: () => void;
      let observePartial!: () => void;
      const partialWait = new Promise<void>((resolve) => {
        releasePartial = resolve;
      });
      const partialObserved = new Promise<void>((resolve) => {
        observePartial = resolve;
      });
      heldOwnerAction = 'rotation-tail';
      holdOwnerReceipt = () => {
        observePartial();
        return partialWait;
      };
      const rotatesBeforePartial = calls.filter((call) => call === 'rotate').length;
      const credentialsBeforePartial = await ownerCredentials();
      await approve(fullOwner, 'rotate');
      await partialObserved;
      const partialHash = state.txHash;
      assert.ok(
        await fullOwner.evaluate(
          (hash) =>
            Object.keys(localStorage).some(
              (key) =>
                key.startsWith('passport-demo:transaction-receipt:v1:') && key.endsWith(hash),
            ),
          partialHash,
        ),
      );
      await fullOwner.evaluate(() => {
        (window as unknown as { __sessionClockOffset: number }).__sessionClockOffset = 31 * 60_000;
      });
      await fullOwner
        .locator('#routine-status')
        .filter({ hasText: /expired/ })
        .waitFor({ state: 'attached' });
      releasePartial();
      await waitStatus(fullOwner, /failed\./, /locked|expired/);
      assert.equal(await ownerCredentials(), credentialsBeforePartial);
      assert.equal(calls.filter((call) => call === 'rotate').length, rotatesBeforePartial + 1);
      heldOwnerAction = undefined;
      holdOwnerReceipt = undefined;
      await archiveObservations(fullOwner, arm);
      await fullOwner.reload();
      await fullOwner
        .locator('#status')
        .filter({ hasText: /^Ready/ })
        .waitFor({ state: 'attached' });
      await observeCredentialAccess(fullOwner);
      await navClick(fullOwner, '#nav-audit');
      await reveal(fullOwner, '#trace');
      await fullOwner
        .locator('#trace')
        .filter({ hasText: partialHash })
        .waitFor({ state: 'visible' });
      assert.match(
        (await fullOwner.locator('#trace').textContent())!,
        /account.transaction.retained/,
      );
      assert.equal(calls.filter((call) => call === 'rotate').length, rotatesBeforePartial + 1);
      done(
        'intermediate key-switch submission survives a later signing expiry and reload without replay',
      );

      await approve(fullOwner, 'open');
      await waitStatus(fullOwner, /opened/);
      await approve(fullOwner, 'unlockOwner');
      await waitStatus(fullOwner, /Account unlocked/);
      const beforePrivateDisplay = await fullOwner.locator('#holdings-facts').textContent();
      await fullOwner.evaluate(() => {
        (window as unknown as { __ownerReadValue: number }).__ownerReadValue = 99;
      });
      let releaseRead!: () => void;
      let observeRead!: () => void;
      const privateReadWait = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      const privateReadObserved = new Promise<void>((resolve) => {
        observeRead = resolve;
      });
      heldOwnerAction = 'holdings';
      holdOwnerReceipt = () => {
        observeRead();
        return privateReadWait;
      };
      const credentialsBeforeRead = await ownerCredentials();
      await approve(fullOwner, 'holdings');
      await privateReadObserved;
      await fullOwner.evaluate(() => {
        (window as unknown as { __sessionClockOffset: number }).__sessionClockOffset = 31 * 60_000;
      });
      await fullOwner
        .locator('#routine-status')
        .filter({ hasText: /expired/ })
        .waitFor({ state: 'attached' });
      releaseRead();
      await waitStatus(fullOwner, /failed\./, /locked or expired/);
      assert.equal(await fullOwner.locator('#holdings-facts').textContent(), beforePrivateDisplay);
      assert.equal(await ownerCredentials(), credentialsBeforeRead);
      heldOwnerAction = undefined;
      holdOwnerReceipt = undefined;
      done(
        'private holdings arriving after owner lock are not displayed and cause no fallback credential access',
      );

      await fullOwner.evaluate(() => {
        (window as unknown as { __sessionClockOffset: number }).__sessionClockOffset = 0;
      });
      await approve(fullOwner, 'unlockOwner');
      await waitStatus(fullOwner, /Account unlocked/);
      await fill(fullOwner, '#withdraw-recipient', recipient);
      await fill(fullOwner, '#withdraw-amount', '1');
      await approve(fullOwner, 'startSession');
      await waitStatus(fullOwner, /JubJub session active/);
      await approve(fullOwner, 'wallet');
      await waitStatus(fullOwner, /wallet connected through/);
      const beforeStorageFaultCredentials = await ownerCredentials();
      const beforeStorageFaultRotations = calls.filter((call) => call === 'rotate').length;
      await fullOwner.evaluate(() => {
        const set = Storage.prototype.setItem;
        (window as unknown as { __restoreReceiptSet: () => void }).__restoreReceiptSet = () => {
          Storage.prototype.setItem = set;
        };
        Storage.prototype.setItem = function (key, value) {
          if (key.startsWith('passport-demo:transaction-receipt:v1:'))
            throw Error('Synthetic receipt quota');
          return set.call(this, key, value);
        };
      });
      await click(fullOwner, '#rotate');
      await waitStatus(fullOwner, /failed\./, /Synthetic receipt quota/);
      await click(fullOwner, '#walletRefresh');
      await waitStatus(fullOwner, /snapshot refreshed/);
      await click(fullOwner, '#endSession');
      await waitStatus(fullOwner, /Local session locked/);
      assert.equal(await ownerCredentials(), beforeStorageFaultCredentials);
      assert.equal(calls.filter((call) => call === 'rotate').length, beforeStorageFaultRotations);
      await fullOwner.evaluate(() => {
        (window as unknown as { __restoreReceiptSet: () => void }).__restoreReceiptSet();
      });
      done(
        'receipt quota refuses new owner work but cannot block idle local lock or public wallet refresh',
      );

      await approve(fullOwner, 'unlockOwner');
      await waitStatus(fullOwner, /Account unlocked/);
      await approve(fullOwner, 'revokeSession');
      await waitStatus(fullOwner, /Session grant revoked on chain/);
      await approve(fullOwner, 'startSession');
      await waitStatus(fullOwner, /JubJub session active/);
      let releaseStorageFault!: () => void, observeStorageFault!: () => void;
      const storageFaultWait = new Promise<void>((resolve) => {
        releaseStorageFault = resolve;
      });
      const storageFaultObserved = new Promise<void>((resolve) => {
        observeStorageFault = resolve;
      });
      heldOwnerAction = 'rotate';
      holdOwnerReceipt = () => {
        observeStorageFault();
        return storageFaultWait;
      };
      await approve(fullOwner, 'rotate');
      await storageFaultObserved;
      const storageFaultHash = state.txHash;
      await fullOwner.evaluate(() => {
        const get = Storage.prototype.getItem;
        (window as unknown as { __restoreReceiptGet: () => void }).__restoreReceiptGet = () => {
          Storage.prototype.getItem = get;
        };
        Storage.prototype.getItem = function (key) {
          if (
            key.startsWith('passport-demo:transaction-receipt:v1:') ||
            key.startsWith('passport-demo:session:v1:')
          )
            throw Error('Synthetic unreadable storage');
          return get.call(this, key);
        };
      });
      releaseStorageFault();
      await waitStatus(fullOwner, /Transaction receipt storage failed.*Copy Audit/);
      assert.match((await fullOwner.locator('#routine-status').textContent())!, /locked/);
      await fullOwner.evaluate(() => {
        (window as unknown as { __restoreReceiptGet: () => void }).__restoreReceiptGet();
      });
      heldOwnerAction = undefined;
      holdOwnerReceipt = undefined;
      await navClick(fullOwner, '#nav-audit');
      await reveal(fullOwner, '#trace');
      await fullOwner
        .locator('#trace')
        .filter({ hasText: storageFaultHash })
        .waitFor({ state: 'visible' });
      const credentialsAfterStorageFailure = await ownerCredentials();
      await click(fullOwner, '#rotate');
      await waitStatus(fullOwner, /Transaction receipt storage failed.*Copy Audit/);
      assert.equal(await ownerCredentials(), credentialsAfterStorageFailure);
      done(
        'receipt persistence failure locks both local key families and preserves the acknowledgement plus Audit warning despite unreadable checkpoints',
      );

      assert.equal(failures.length, 0, failures.join(', '));
      assert.equal(pageErrors.length, 0, pageErrors.join(', '));
      const observedPurposes = new Set<string>(archivedPurposes[arm] ?? []);
      for (const context of contexts)
        for (const page of context.pages()) {
          const observations = await page.evaluate(
            () =>
              (
                window as unknown as {
                  __passportPurposeObservations: { purpose: string; attempt: number }[];
                }
              ).__passportPurposeObservations,
          );
          assert.ok(
            observations.length > 0,
            'each profile must exercise observed credential purposes',
          );
          assert.deepEqual(
            await page.evaluate(
              () =>
                (window as unknown as { __passportPurposeFailureCodes?: string[] })
                  .__passportPurposeFailureCodes ?? [],
            ),
            [],
            'no profile may hide an observer rejection in an expected UI failure',
          );
          for (const observation of observations) observedPurposes.add(observation.purpose);
        }
      for (const purpose of [
        'create',
        'verify-created',
        'identify',
        'identify-and-unlock',
        'derive-keys',
        ...(arm === 'p256' ? ['sign'] : []),
      ])
        assert.ok(observedPurposes.has(purpose), `missing observed ${purpose} access for ${arm}`);
      ceremonyPurposesByArm[arm] = [...observedPurposes].sort();
    } finally {
      for (const context of contexts) {
        closingContexts.add(context);
        await context.close();
      }
    }
  }
  assert.equal(
    runtimeIdentity(),
    initialRuntimeIdentity,
    'runtime inputs changed during qualification',
  );
  outcome = 'passed';
} finally {
  const cleanup: Record<string, string> = {};
  const close = async (name: string, present: boolean, operation: () => Promise<unknown>) => {
    if (!present) {
      cleanup[name] = 'not-created';
      return;
    }
    try {
      await operation();
      cleanup[name] = 'closed';
    } catch {
      cleanup[name] = 'failed';
      outcome = 'failed';
    }
  };
  await close('browser', !!browser, async () => browser?.close());
  await close('server', !!server, async () => server?.close());
  await close(
    'ownedCache',
    !!ownedCache,
    async () => ownedCache && rm(ownedCache, { recursive: true, force: true }),
  );
  const resourcesClosed = Object.values(cleanup).every((status) => status !== 'failed');
  if (savedPin === undefined) delete process.env.PASSPORT_MANIFEST_SHA256;
  else process.env.PASSPORT_MANIFEST_SHA256 = savedPin;
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(
    output,
    JSON.stringify(
      {
        schemaVersion: 1,
        outcome,
        tier: 'browser-ui-synthetic-connector',
        binding: 'acc-s3r1.1',
        manifestSha256: manifest,
        sourceCommit,
        dirty,
        nodeVersion: process.version,
        browserVersion,
        runtimeSha256: initialRuntimeIdentity,
        elapsedMs: Date.now() - started,
        cases,
        selectedArms,
        credentialFailureCodes,
        ceremonyPurposesByArm,
        actual: [
          'Chromium DOM/actions',
          'mock WebAuthn credential API',
          'ceremony hooks',
          'handoff parsing',
          'capability/proof planner',
          'PRF-derived bounded session controller and generated JubJub signature/holder guards',
          'shared-origin Web Locks and independent public intent records across real tabs',
        ],
        simulated: ['account API', 'chain', 'funding', 'grant settlement', 'wallet balances'],
        nativeProofs: false,
        realProvider: false,
        resourcesClosed,
        cleanup,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx' },
  );
  console.log(`Demo journey receipt: ${output}`);
  if (!resourcesClosed)
    throw new Error('Demo journey resource cleanup failed; inspect its receipt.');
}
