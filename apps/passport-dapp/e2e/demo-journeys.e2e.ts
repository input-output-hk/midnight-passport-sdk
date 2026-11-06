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
// Exercise actual navigation and native disclosure controls before interacting with a field.
// This does not call account methods, edit hidden state or bypass consent.
async function reveal(page: Page, selector: string): Promise<void> {
  const location = await page.locator(selector).evaluate((element) => ({
    view: element.closest<HTMLElement>('[data-workspace]')?.dataset.workspace,
    accountPage: element.closest<HTMLElement>('[data-account-page]')?.dataset.accountPage,
    details: [...(element.closest('[data-workspace]')?.querySelectorAll('details') ?? [])]
      .filter((details) => details.contains(element))
      .map((details) => details.id),
  }));
  if (
    location.view &&
    (await page.locator(`#nav-${location.view}`).getAttribute('aria-current')) !== 'page'
  ) {
    await page.locator(`#nav-${location.view}`).click();
  }
  if (
    location.accountPage &&
    (await page.locator(`#account-tab-${location.accountPage}`).getAttribute('aria-selected')) !==
      'true'
  ) {
    await page.locator(`#account-tab-${location.accountPage}`).click();
  }
  for (const id of location.details) {
    if (
      id &&
      !(await page.locator(`#${id}`).evaluate((element) => (element as HTMLDetailsElement).open))
    ) {
      await page.locator(`#${id} > summary`).click();
    }
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
      if (['rotate', 'enroll', 'remove', 'issue', 'revoke', 'withdraw', 'spend'].includes(action))
        state.nonce++;
      state.txHash = state.nonce.toString(16).padStart(64, '0');
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
              if (action === 'spend' && holdSessionSpend) {
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
        .waitFor()
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
      await click(external, '#nav-wallet');
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
      assert.deepEqual(await owner.locator('.workspace-nav button').allTextContents(), [
        'Overview',
        'Passport account',
        'Midnight wallet',
        'Audit',
        'Settings',
      ]);
      assert.deepEqual(
        await owner
          .locator('#activity-content .operation-status > h2, #activity-content .journey > h2')
          .allTextContents(),
        ['Current operation', 'Your journey'],
      );
      assert.equal(await owner.locator('#capability-operation').isVisible(), false);
      assert.equal(await owner.locator('#session-minutes').isVisible(), false);
      for (const view of ['account', 'wallet', 'audit', 'settings', 'overview']) {
        await owner.locator(`#nav-${view}`).click();
        assert.equal(await owner.locator(`#workspace-${view}`).isVisible(), true);
        assert.equal(await owner.locator('.workspace-view:visible').count(), 1);
      }
      assert.equal(calls.length, 0);
      assert.equal(
        await owner.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1')),
        null,
      );
      await owner.locator('#nav-settings').click();
      for (const id of [
        'settings-devices',
        'settings-sessions',
        'settings-advanced-access',
        'settings-developer-tools',
      ]) {
        assert.equal(
          await owner.locator(`#${id}`).evaluate((e) => (e as HTMLDetailsElement).open),
          false,
        );
      }
      await owner.locator('#nav-audit').click();
      assert.equal(await owner.locator('#activity-panel').isVisible(), false);
      const wide = await owner.locator('.workspace-center').evaluate((e) => e.clientWidth);
      await owner.locator('#activity-toggle').click();
      assert.equal(await owner.locator('#activity-panel').isVisible(), true);
      assert.ok((await owner.locator('.workspace-center').evaluate((e) => e.clientWidth)) < wide);
      await click(owner, '#nav-settings');
      assert.equal(
        await owner
          .locator('#settings-developer-tools')
          .evaluate((e) => (e as HTMLDetailsElement).open),
        false,
      );
      await owner.locator('#settings-developer-tools > summary').click();
      assert.match(await owner.locator('#demo-configuration').innerText(), new RegExp(manifest));
      assert.match(await owner.locator('#demo-configuration').innerText(), /acc-s3r1.1/);
      assert.equal(await owner.locator('#demo-configuration input').count(), 0);
      await owner.locator('#settings-developer-tools > summary').click();
      await owner.locator('#nav-overview').click();
      done('five workspaces separate settings and Audit without credentials or connector effects');
      await click(owner, '#nav-account');
      assert.deepEqual(await owner.locator('.account-tabs button').allTextContents(), [
        'Balances',
        'Deposit',
        'Withdraw',
      ]);
      assert.equal(await owner.locator('#account-page-balances').isVisible(), true);
      assert.equal(await owner.locator('#fund').isVisible(), false);
      await owner.locator('#account-tab-balances').focus();
      await owner.keyboard.press('ArrowRight');
      assert.equal(
        await owner.locator('#account-tab-deposit').getAttribute('aria-selected'),
        'true',
      );
      assert.equal(await owner.evaluate(() => document.activeElement?.id), 'account-tab-deposit');
      await owner.keyboard.press('End');
      assert.equal(await owner.locator('#account-page-withdraw').isVisible(), true);
      assert.equal(await owner.locator('#account-page-balances').isVisible(), false);
      assert.equal(await owner.locator('#account-page-deposit').isVisible(), false);
      assert.equal(await owner.locator('#withdraw').isEnabled(), false);
      await owner.keyboard.press('Home');
      assert.equal(
        await owner.locator('#account-tab-balances').getAttribute('aria-selected'),
        'true',
      );
      await owner.keyboard.press('ArrowLeft');
      assert.equal(
        await owner.locator('#account-tab-withdraw').getAttribute('aria-selected'),
        'true',
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
        'account tabs support keyboard navigation and mobile layout without an account, credentials or implicit actions',
      );
      const deepLinked = await newPage(undefined, false, '#account/deposit');
      assert.equal(await deepLinked.locator('#nav-account').getAttribute('aria-current'), 'page');
      assert.equal(
        await deepLinked.locator('#account-tab-deposit').getAttribute('aria-selected'),
        'true',
      );
      assert.equal(await deepLinked.locator('#fund').isEnabled(), false);
      await deepLinked.close();
      const unknownTab = await newPage(undefined, false, '#account/unknown');
      assert.equal(
        await unknownTab.locator('#account-tab-balances').getAttribute('aria-selected'),
        'true',
      );
      await unknownTab.close();
      await owner.bringToFront();
      assert.equal(calls.length, 0);
      done(
        'account operation deep links restore presentation only; unknown subpages fall back to balances',
      );
      await owner.locator('#nav-overview').click();

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
      await owner.locator('#nav-overview').click();
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
      await owner.locator('#nav-overview').click();
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
      done('acknowledged creation and one explicit approval per credential request');
      await archiveObservations(owner, arm);
      await owner.reload();
      await owner
        .locator('#status')
        .filter({ hasText: /^Ready\./ })
        .waitFor();
      await observeCredentialAccess(owner);
      // Simulate the exact recognized Chromium variant once; a retry needs another approval.
      await owner.addScriptTag({ type: 'module', url: `${origin}/e2e/fixtures/profile-retry.ts` });
      await approve(owner, 'open');
      await owner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
      await click(owner, '#ceremony-continue');
      await owner
        .locator('#ceremony-details')
        .filter({ hasText: /Retry 2/ })
        .waitFor();
      assert.equal(await credentialsUsed(), 1);
      await click(owner, '#ceremony-cancel');
      await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
      assert.equal(
        await credentialsUsed(),
        1,
        'a browser-profile retry cannot reuse prior approval',
      );
      done(
        'a recognized signing-format retry explains the reason and can be declined before access',
      );

      await approve(owner, 'open');
      await waitStatus(owner, /is reopened/);
      await fill(owner, '#open-address', address);
      await approve(owner, 'openAt');
      await waitStatus(owner, /opened by address/);
      done('reload, reopen and known-address opening');

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
        await click(owner, `#${action}`);
        await waitStatus(owner, status);
        assert.equal(await owner.locator('#ceremony-purpose').innerText(), before);
      }
      done('public state and rosters need no ceremony');
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

      await approve(owner, 'wallet');
      await waitStatus(owner, /wallet connected through/);
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
        await owner.locator(`#account-tab-${tab}`).click();
      assert.equal(await owner.locator('#withdraw-amount').inputValue(), '3');
      assert.equal(await owner.locator('#withdraw-recipient').inputValue(), recipient);
      assert.equal(await owner.locator('#withdraw').isVisible(), true);
      assert.equal(await owner.locator('#fund').isVisible(), false);
      assert.ok(
        (await owner.locator('#account-action-context .value').first().getAttribute('title')) ===
          address,
      );
      await owner.locator('#nav-wallet').click();
      await owner.locator('#nav-account').click();
      assert.equal(
        await owner.locator('#account-tab-withdraw').getAttribute('aria-selected'),
        'true',
      );
      assert.equal(await owner.locator('#withdraw-amount').inputValue(), '3');
      await owner.locator('#account-tab-balances').click();
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
            await owner.locator(`#account-tab-${tab}`).click();
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
      await approve(owner, 'withdraw');
      await waitStatus(
        owner,
        /failed\./,
        /Enter a valid unshielded Midnight address for undeployed/,
      );
      assert.equal(calls.filter((c) => c === 'withdraw').length, withdrawals);
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
      await owner.locator('#nav-audit').click();
      const traceDetails = owner.locator('details').filter({ has: owner.locator('#trace') });
      await traceDetails.locator('summary').click();
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
      for (const view of ['audit', 'settings', 'account'])
        await owner.locator(`#nav-${view}`).click();
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
      const beforeAuthorize = await countCredentials();
      await approve(owner, 'startSession');
      await waitStatus(owner, /JubJub session active/);
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
        await owner.locator('#account-tab-withdraw').getAttribute('aria-selected'),
        'true',
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
      done(
        'consented PRF child session issues an expiring grant and signs without another passkey',
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
        await owner.locator(`#nav-${view}`).click();
      for (const tab of ['balances', 'deposit', 'withdraw'])
        await owner.locator(`#account-tab-${tab}`).click();
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
      await approve(owner, 'startSession');
      await waitStatus(owner, /JubJub session active/);
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
        .waitFor();
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
      await owner.locator('#nav-audit').click();
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
        .waitFor();
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
        .waitFor();
      await observeCredentialAccess(revoker);
      await approve(revoker, 'open');
      await waitStatus(revoker, /opened/);
      await approve(revoker, 'revokeSession');
      await waitStatus(revoker, /failed\./, /Reconcile/);
      assert.equal(calls.filter((c) => c === 'revoke').length, revokeCalls + 1);
      done('uncertain revocation is never replayed and remains fenced across reload');

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
