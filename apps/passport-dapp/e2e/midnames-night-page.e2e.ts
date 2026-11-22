// Synthetic page wiring and original-ID presentation; no chain, passkey or wallet payment.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const candidate = process.env.PASSPORT_NIGHT_PAGE_CANDIDATE === '1';
const binding = candidate ? 'acc-s3r1.1-zkir036' : 'acc-s3r1.1';
const manifest = candidate
  ? '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f'
  : '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
const account = '34'.repeat(32);
const registry = '12'.repeat(32);
const connector = `
  export const ARM = 'jubjub', SIGNING_MODE = 'jubjub', NETWORK_ID = 'undeployed';
  export const BINDING_ID = ${JSON.stringify(binding)}, RP_ID = 'localhost';
  export const ORIGIN = location.origin, SERVICE_URL = location.origin;
  export const ARTEFACT_URL = SERVICE_URL + '/v1/zk/' + BINDING_ID;
  export const MANIFEST_SHA256 = ${JSON.stringify(manifest)};
  export const exportDemoGrantOpening = async () => { throw Error('Outside page fixture'); };
  const account = {
    scheme: 'jubjub-schnorr', networkId: NETWORK_ID, bindingId: BINDING_ID,
    address: ${JSON.stringify(account)}, credentialId: new Uint8Array(32).fill(1),
    async state() {
      return { specVersion: 3, booted: true, authNonce: 0n, deviceEpoch: 0n, entryCount: 1 };
    },
  };
  export const connect = async () => ({
    async createAccount() { return account; },
    async openAccount() { return account; },
  });
  export function installShim() { window.midnight = { passport: { connect } }; }
`;
const naming = `
  export function configureMidnames() {
    return {
      provider: {
        id: ${JSON.stringify(`midnames:${registry}`)}, mode: 'external', namespace: 'night',
      },
      async resolve() { return undefined; },
    };
  }
`;

process.env.PASSPORT_MANIFEST_SHA256 = manifest;
process.env.PASSPORT_BINDING_ID = binding;
if (candidate) {
  process.env.PASSPORT_CANDIDATE_LOCAL = '1';
  assert.ok(process.env.PASSPORT_ARTEFACT_DIR, 'Candidate page test needs pinned local assets.');
}
process.env.VITE_MIDNAMES_NIGHT_SEND = '1';
process.env.VITE_MIDNAMES_REGISTRY_PROFILE = 'standalone-0.35';
process.env.VITE_MIDNAMES_INDEXER_URL = 'http://127.0.0.1:6300';
process.env.VITE_MIDNAMES_INDEXER_WS_URL = 'ws://127.0.0.1:6300';
const server = await createServer({
  root: process.cwd(),
  configFile: 'vite.config.ts',
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, hmr: false },
  plugins: [
    {
      name: 'named-night-page-fixtures',
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
  const openAccount = async () => {
    await page.goto(origin);
    await page
      .locator('#status')
      .filter({ hasText: /^Ready\./ })
      .waitFor({ state: 'attached' });
    await page.locator('#create').click();
    await page.locator('#account-tab-withdraw').click();
    await page.locator('#account-named-night').waitFor({ state: 'visible' });
    await page.locator('#sendNamedNight').waitFor({ state: 'visible' });
  };
  await openAccount();
  await page
    .locator('#named-night-status')
    .getByText(/No named NIGHT payment/)
    .waitFor();
  assert.equal(await page.locator('#sendNamedNight').isEnabled(), true);

  if (candidate) {
    const fencePage = await browser.newPage();
    try {
      await fencePage.goto(origin);
      const fenced = await fencePage.evaluate(
        async ({ accountAddress, registryAddress, bindingId, manifestSha256 }) => {
          const depositUrl = '/src/wallet/night-deposit.ts';
          const journalUrl = '/src/midnames/night-send-journal.ts';
          const fenceUrl = '/src/wallet/night-deposit-fence.ts';
          const { checkedDeviceNightDepositRequest } = (await import(
            depositUrl
          )) as typeof import('../src/wallet/night-deposit.js');
          const { openBrowserNightSendJournal } = (await import(
            journalUrl
          )) as typeof import('../src/midnames/night-send-journal.js');
          const { exactFencedNightDeposit } = (await import(
            fenceUrl
          )) as typeof import('../src/wallet/night-deposit-fence.js');
          const scope = {
            networkId: 'undeployed' as const,
            source: accountAddress,
            credentialId: '01'.repeat(32),
            bindingId,
            manifestSha256,
          };
          const bridge = '56'.repeat(32);
          const target = '78'.repeat(32);
          const withdrawal = { hash: 'ab'.repeat(32), identifiers: ['00' + 'cd'.repeat(32)] };
          const deposit = { hash: 'ef'.repeat(32), identifiers: ['01' + '12'.repeat(32)] };
          const output = {
            transactionHash: withdrawal.hash,
            intentHash: '34'.repeat(32),
            outputNo: 0,
            owner: bridge,
            type: '00'.repeat(32),
            value: 4n,
          };
          const parsed = checkedDeviceNightDepositRequest({
            scope,
            target,
            output,
            proven: Uint8Array.of(1),
          });
          const journal = await openBrowserNightSendJournal(indexedDB, scope);
          try {
            await journal.createIntent({
              requestId: '12345678-1234-1234-1234-123456789abc',
              networkId: 'undeployed',
              source: accountAddress,
              bridge,
              target,
              asset: 'NIGHT',
              amount: '4',
              name: 'alice.night',
              providerId: `midnames:${registryAddress}`,
              namespace: 'night',
              operations: ['withdraw_unshielded_with_jubjub', 'deposit_unshielded'],
            });
            await journal.fenceLeg('withdraw', withdrawal);
            await journal.fenceLeg('deposit', deposit);
            return {
              preserved:
                parsed.scope.bindingId === bindingId &&
                parsed.scope.manifestSha256 === manifestSha256,
              fenced: await exactFencedNightDeposit(
                parsed.scope,
                deposit,
                output,
                target,
                indexedDB,
              ),
            };
          } finally {
            journal.close();
          }
        },
        {
          accountAddress: account,
          registryAddress: registry,
          bindingId: binding,
          manifestSha256: manifest,
        },
      );
      assert.deepEqual(fenced, { preserved: true, fenced: true });
    } finally {
      await fencePage.close();
    }
  }

  await page.evaluate(
    async ({ accountAddress, registryAddress, candidate, binding, manifest }) => {
      const scope = ['undeployed', accountAddress];
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('mn-passport:night-send', 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const intent = {
        requestId: '12345678-1234-1234-1234-123456789abc',
        networkId: 'undeployed',
        source: accountAddress,
        bridge: '56'.repeat(32),
        target: '78'.repeat(32),
        asset: 'NIGHT',
        amount: '4',
        name: 'alice.night',
        providerId: `midnames:${registryAddress}`,
        namespace: 'night',
        operations: ['withdraw_unshielded_with_jubjub', 'deposit_unshielded'],
      };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('active', 'readwrite');
        tx.objectStore('active').put(
          {
            version: 1,
            credentialId: '01'.repeat(32),
            ...(candidate && { bindingId: binding, manifestSha256: manifest }),
            intent,
            ownerStartedAt: new Date().toISOString(),
          },
          JSON.stringify(scope),
        );
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    },
    { accountAddress: account, registryAddress: registry, candidate, binding, manifest },
  );

  await openAccount();
  await page
    .locator('#named-night-status')
    .getByText(/no saved transaction ID/)
    .waitFor();
  assert.equal(await page.locator('#sendNamedNight').isDisabled(), true);
  assert.match(
    await page.locator('#named-night-status').innerText(),
    /cannot be retried automatically/,
  );
  const screenshots = process.env.PASSPORT_NIGHT_PAGE_SCREENSHOT_DIR;
  if (screenshots) {
    await mkdir(screenshots, { recursive: true });
    await page
      .locator('#account-named-night')
      .screenshot({ path: join(screenshots, 'desktop.png') });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('#account-named-night').isVisible(), true);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  assert.ok(overflow <= 1, `Named NIGHT page overflows the mobile viewport by ${overflow}px.`);
  await page.locator('#named-night-status').scrollIntoViewIfNeeded();
  const statusBounds = await page.locator('#named-night-status').boundingBox();
  assert.ok(statusBounds && statusBounds.y >= 0 && statusBounds.y < 844);
  if (screenshots) {
    await page
      .locator('#account-named-night')
      .screenshot({ path: join(screenshots, 'mobile.png') });
    await page.locator('#named-night-status').screenshot({ path: join(screenshots, 'status.png') });
  }
  assert.deepEqual(errors, []);
  console.log(`Midnames named NIGHT ${binding} page and no-ID recovery guard: PASS`);
} finally {
  await browser?.close();
  await server.close();
}
