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
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const origin = 'http://localhost:5173';
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
        'apps/passport-dapp/vite.config.ts',
        'packages/*/dist/**/*.js',
        'packages/*/package.json',
        'packages/contract/generated/acc-s3r1.1/*.js',
        'packages/contract/resources/acc-s3r1.1.capabilities.json',
        'pnpm-lock.yaml',
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
  for (const arm of ['p256', 'jubjub'] as const) {
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
          id: grantId,
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
    const newPage = async () => {
      const context = await browser!.newContext({ serviceWorkers: 'block' });
      contexts.push(context);
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === origin && url.pathname === '/__demo-fixture') {
          const data = request.postDataJSON() as Record<string, unknown>;
          const action = String(data.action);
          if (action === 'withdraw' && unknownWithdrawal) {
            calls.push('withdraw-unknown');
            await route.fulfill({ status: 503, json: { code: 'SubmissionUnknown' } });
          } else {
            const accepted = fixture(action, data);
            await route.fulfill({
              status: accepted ? 200 : 409,
              json: accepted
                ? action === 'state' && staleOwnerReads
                  ? { ...state, nonce: state.nonce + (staleReadCount++ % 2) }
                  : state
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
          const response = await route.fetch({ url: `${base}${url.pathname}${url.search}` });
          await route.fulfill({ response });
        } else {
          // Fonts and browser telemetry are not needed; unexpected network access fails the run.
          if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname))
            failures.push(`unhandled-network:${url.hostname}`);
          await route.abort();
        }
      });
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
      await page.goto(`${origin}/?mockPasskey&fixtureArm=${arm}`);
      await page
        .locator('#status')
        .filter({ hasText: /^Ready\./ })
        .waitFor();
      await observeCredentialAccess(page);
      return page;
    };
    const done = (name: string) => {
      cases.push({ arm, name });
      console.log(`PASS ${arm}: ${name}`);
    };
    const waitStatus = async (page: Page, expected: RegExp) => {
      try {
        await page.waitForFunction(
          () => !document.querySelector('#log .run[data-state="running"]'),
          undefined,
          { timeout: 20_000 },
        );
        assert.match(await page.locator('#status').innerText(), expected);
      } catch (error) {
        const codes = await page
          .evaluate(
            () =>
              (window as unknown as { __passportPurposeFailureCodes?: string[] })
                .__passportPurposeFailureCodes ?? [],
          )
          .catch(() => [] as string[]);
        credentialFailureCodes.push(...codes);
        console.error('Journey status:', await page.locator('#status').innerText());
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
      await page.locator(`#${action}`).click();
      await page.locator('#consent-dialog').waitFor({ state: 'visible' });
      await page.locator('#consent-cancel').click();
      await waitStatus(page, /declined before passkey/);
      assert.equal(calls.length, beforeCalls, `declining ${action} must not invoke a driver`);
      assert.ok(
        (await page.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1'))) ===
          beforeCredential,
        `declining ${action} must not use a credential`,
      );
      await page.locator(`#${action}`).click();
      await page.locator('#consent-dialog').waitFor({ state: 'visible' });
      if (action === 'create') await page.locator('#consent-retirement-ack').check();
      await page.locator('#consent-continue').click();
    };
    try {
      const owner = await newPage();
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
      await owner.locator('#create').click();
      assert.ok(await owner.locator('#consent-continue').isDisabled());
      await owner.locator('#consent-cancel').click();
      await waitStatus(owner, /declined before passkey/);
      assert.equal(calls.length, 0);
      assert.equal(
        await owner.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1')),
        null,
      );
      done('declined irreversible create has no credential or connector effect');

      await approve(owner, 'create');
      await waitStatus(owner, /is created/);
      done('acknowledged creation and purpose display');
      await owner.reload();
      await owner
        .locator('#status')
        .filter({ hasText: /^Ready\./ })
        .waitFor();
      await observeCredentialAccess(owner);
      await approve(owner, 'open');
      await waitStatus(owner, /is reopened/);
      await owner.locator('#open-address').fill(address);
      await approve(owner, 'openAt');
      await waitStatus(owner, /opened by address/);
      done('reload, reopen and known-address opening');

      for (const [action, status] of [
        ['refresh', /Account|ACC|refreshed/i],
        ['roster', /roster|device|entries/i],
        ['grantRoster', /grant/i],
      ] as const) {
        const before = await owner.locator('#ceremony-purpose').innerText();
        await owner.locator(`#${action}`).click();
        await waitStatus(owner, status);
        assert.equal(await owner.locator('#ceremony-purpose').innerText(), before);
      }
      done('public state and rosters need no ceremony');
      await approve(owner, 'holdings');
      await waitStatus(owner, /Verified 1 shielded/);
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
      await owner.locator('#fund').click();
      await waitStatus(owner, /account balance: 10/);
      const successfulFundingId = fundingIds.at(-1)!;
      await owner.evaluate(({ key, id }) => localStorage.setItem(key, id), {
        key: `passport-demo:fund:undeployed:${address}:${night}`,
        id: successfulFundingId,
      });
      await owner.locator('#fund').click();
      await waitStatus(owner, /account balance: 10/);
      assert.equal(state.night, 10, 'replayed funding ID must not credit twice');
      await owner.locator('#withdraw-amount').fill('1');
      await owner.locator('#withdraw-recipient').fill('invalid-recipient');
      const withdrawals = calls.filter((c) => c === 'withdraw').length;
      await approve(owner, 'withdraw');
      await waitStatus(owner, /failed\./);
      assert.equal(calls.filter((c) => c === 'withdraw').length, withdrawals);
      const wrongNetwork = MidnightBech32m.encode(
        'preview',
        new UnshieldedAddress(Buffer.alloc(32, 7)),
      ).asString();
      await owner.locator('#withdraw-recipient').fill(wrongNetwork);
      await approve(owner, 'withdraw');
      await waitStatus(owner, /failed\./);
      assert.equal(calls.filter((c) => c === 'withdraw').length, withdrawals);
      await owner.locator('#withdraw-recipient').fill(recipient);
      rejectNextDialog = true;
      await approve(owner, 'withdraw');
      await waitStatus(owner, /cancelled before signing/i);
      assert.equal(rejectNextDialog, false, 'the exact withdrawal review must have appeared');
      assert.equal(calls.filter((c) => c === 'withdraw').length, withdrawals);
      await approve(owner, 'withdraw');
      await waitStatus(owner, /Withdrawal confirmed/);
      assert.equal(state.night, 9);
      assert.equal(state.wallet, 1);
      await owner.locator('#walletRefresh').click();
      await waitStatus(owner, /snapshot refreshed/);
      done('fund ten, reject invalid recipient, withdraw one and refresh wallet');

      const joiner = await newPage();
      await joiner.locator('#open-address').fill(address);
      await approve(joiner, 'prepareJoiner');
      await waitStatus(joiner, /handoff|fingerprint|public keys/i);
      const handoff = await joiner.locator('#handoff-output').inputValue();
      await owner.locator('#handoff-input').fill('{}');
      const enrollments = calls.filter((c) => c === 'enroll').length;
      await approve(owner, 'enrollDevice');
      await waitStatus(owner, /failed\./);
      assert.equal(calls.filter((c) => c === 'enroll').length, enrollments);
      await owner.locator('#handoff-input').fill(handoff);
      staleOwnerReads = true;
      await approve(owner, 'enrollDevice');
      await waitStatus(owner, /failed\./);
      assert.equal(calls.filter((c) => c === 'enroll').length, enrollments);
      staleOwnerReads = false;
      await approve(owner, 'enrollDevice');
      await waitStatus(owner, /Joining device confirmed/);
      await approve(joiner, 'openAt');
      await waitStatus(joiner, /opened by address/);
      await owner.locator('#remove-commitment').fill(target);
      await approve(owner, 'removeDevice');
      await waitStatus(owner, /entry is absent/);
      assert.equal(state.entries.length, 1);
      done('prepare joiner, reject malformed handoff, enroll, open and remove entry');

      const holder = await newPage();
      await holder.locator('#open-address').fill(address);
      await approve(holder, 'prepareGrantee');
      await waitStatus(holder, /Public grantee key ready/);
      await owner
        .locator('#grant-grantee')
        .fill(await holder.locator('#grantee-output').inputValue());
      await owner.locator('#grant-recipient').fill(recipient);
      await owner.locator('#grant-per-call').fill('1');
      await owner.locator('#grant-cap').fill('2');
      await approve(owner, 'issueGrant');
      await waitStatus(owner, /Grant .*active|grant.*issued/i);
      await owner.locator('#export-grant-id').fill(grantId);
      await approve(owner, 'exportGrant');
      await waitStatus(owner, /Opening ready/);
      await holder
        .locator('#grant-opening-input')
        .fill(await owner.locator('#grant-opening-output').inputValue());
      await holder.locator('#grant-spend-amount').fill('1');
      await holder.locator('#grant-spent-prev').fill('0');
      const beforeDeclinedSpend = calls.filter((c) => c === 'spend').length;
      rejectNextDialog = true;
      await approve(holder, 'spendGrant');
      await waitStatus(holder, /failed\./);
      assert.equal(rejectNextDialog, false, 'the exact grant spend review must have appeared');
      assert.equal(calls.filter((c) => c === 'spend').length, beforeDeclinedSpend);
      await approve(holder, 'spendGrant');
      await waitStatus(holder, /Grant spend .*confirmed/);
      await owner.locator('#revoke-grant-id').fill(grantId);
      await approve(owner, 'revokeGrant');
      await waitStatus(owner, /is revoked/);
      const balance = state.night;
      await approve(holder, 'spendGrant');
      await waitStatus(holder, /failed\./);
      assert.equal(state.night, balance);
      await approve(owner, 'recoverGrants');
      await waitStatus(owner, /Published 0 pending grants/);
      done('prepare holder, issue/export/spend/revoke, refuse revoked spend and recover pending');

      const beforeInspection = calls.length;
      await owner.locator('#capability-operation').selectOption('withdraw-shielded');
      assert.match(
        await owner.locator('#capability-report').innerText(),
        /Exact-value selected shielded coin only/,
      );
      await owner.locator('#capability-operation').selectOption('issue-grant');
      await owner.locator('#capability-read-grant').check();
      assert.match(await owner.locator('#capability-report').innerText(), /rotate_enc_key_with_/);
      assert.equal(calls.length, beforeInspection);
      done('capability/proof-plan inspection invokes no connector or credentials');

      unknownFunding = true;
      await owner.locator('#fund').click();
      await waitStatus(owner, /failed\./);
      const original = fundingIds.at(-1)!;
      await owner.locator('#fund').click();
      await waitStatus(owner, /failed\./);
      assert.equal(fundingIds.at(-1), original);
      assert.equal(fundingIds.filter((id) => id === original).length, 2);
      unknownFunding = false;
      done('uncertain funding retains the original request ID across explicit retry');
      unknownWithdrawal = true;
      await approve(owner, 'withdraw');
      await waitStatus(owner, /failed\./);
      await owner.waitForTimeout(100);
      assert.equal(calls.filter((c) => c === 'withdraw-unknown').length, 1);
      unknownWithdrawal = false;
      done('uncertain withdrawal is not automatically replayed');
      serviceUnavailable = true;
      await owner.locator('#refresh').click();
      await waitStatus(owner, /refreshed|unavailable|failed/i);
      done('balance service outage is visible without signing');
      assert.equal(failures.length, 0, failures.join(', '));
      assert.equal(pageErrors.length, 0, pageErrors.join(', '));
      const observedPurposes = new Set<string>();
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
      for (const context of contexts) await context.close();
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
        credentialFailureCodes,
        ceremonyPurposesByArm,
        actual: [
          'Chromium DOM/actions',
          'mock WebAuthn credential API',
          'ceremony hooks',
          'handoff parsing',
          'capability/proof planner',
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
