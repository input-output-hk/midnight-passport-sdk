// Isolated Ledger 9 qualification of the Passport page's complete claim path.
// The deployed ACC is supplied by the native runner; only its login connector
// is substituted. Quote, PRF owner proof, sponsor balance, send and recovery are live.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { createServer } from 'vite';
import { claimDispatchPath } from '../src/midnames/claim-dispatch.js';
import { claimReceipt } from '../src/midnames/claim-receipt.js';
import { reveal } from './journeys/ui.js';

assert.equal(process.env.PASSPORT_MIDNAMES_NATIVE, '1');
const output = resolve(process.argv[2] ?? '');
const input = JSON.parse(readFileSync(resolve(output, 'page-claim-input.json'), 'utf8')) as {
  registryAddress: string;
  accountAddress: string;
  name: string;
};
assert.match(input.registryAddress, /^[0-9a-f]{64}$/);
assert.match(input.accountAddress, /^[0-9a-f]{64}$/);
assert.match(input.name, /^[a-z0-9]+\.night$/);
const sponsorPort = process.env.PASSPORT_MIDNAMES_SPONSOR_PORT;
const ownerPort = process.env.PASSPORT_MIDNAMES_OWNER_PORT;
assert.match(sponsorPort ?? '', /^[1-9][0-9]{0,4}$/);
assert.match(ownerPort ?? '', /^[1-9][0-9]{0,4}$/);
assert.equal(process.env.MN_INDEXER_URL, 'http://127.0.0.1:18108/api/v4/graphql');
assert.equal(process.env.MN_INDEXER_WS_URL, 'ws://127.0.0.1:18108/api/v4/graphql/ws');
Object.assign(process.env, {
  PASSPORT_MANIFEST_SHA256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  PASSPORT_NETWORK_ID: 'undeployed',
  VITE_MIDNAMES_REGISTRY_PROFILE: 'standalone-0.35',
  VITE_MIDNAMES_REGISTRY_ADDRESS: input.registryAddress,
  VITE_MIDNAMES_NAMESPACE: 'night',
  VITE_MIDNAMES_NETWORK_ID: 'undeployed',
  VITE_MIDNAMES_INDEXER_URL: process.env.MN_INDEXER_URL,
  VITE_MIDNAMES_INDEXER_WS_URL: process.env.MN_INDEXER_WS_URL,
  VITE_MIDNAMES_CLAIM_PROTOCOL_VERSION: '2001100',
  VITE_MIDNAMES_CLAIM_SPONSOR: '1',
  VITE_MIDNAMES_CLAIM_PREPARATION: '1',
});

const connector = `
  export const ARM = 'p256', SIGNING_MODE = 'passkey', NETWORK_ID = 'undeployed';
  export const BINDING_ID = 'acc-s3r1.1', RP_ID = 'localhost';
  export const ORIGIN = location.origin, SERVICE_URL = location.origin;
  export const MANIFEST_SHA256 = ${JSON.stringify(process.env.PASSPORT_MANIFEST_SHA256)};
  export const ARTEFACT_URL = SERVICE_URL + '/v1/zk/' + BINDING_ID;
  export const exportDemoGrantOpening = async () => { throw Error('Outside claim fixture'); };
  const account = () => {
    const id = localStorage.getItem('native-naming-credential');
    if (!id || !/^[a-f0-9]+$/.test(id)) throw Error('No virtual naming credential');
    return {
      scheme: 'p256-webauthn', networkId: NETWORK_ID, bindingId: BINDING_ID,
      address: ${JSON.stringify(input.accountAddress)},
      credentialId: Uint8Array.from(id.match(/../g), (byte) => parseInt(byte, 16)),
      async state() {
        return { specVersion: 3, booted: true, authNonce: 0n, deviceEpoch: 0n, entryCount: 1 };
      },
    };
  };
  export const connect = async () => ({ createAccount: account, openAccount: account });
  export function installShim() { window.midnight = { passport: { connect } }; }
`;
const origin = 'http://localhost:5173';
const vite = await createServer({
  root: process.cwd(),
  cacheDir: resolve(output, 'page-vite-cache'),
  logLevel: 'error',
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    hmr: false,
    proxy: {
      '/owner-claim/': { target: `http://localhost:${ownerPort}`, changeOrigin: false },
      '/owner-artifact/': { target: `http://localhost:${ownerPort}`, changeOrigin: false },
      '/owner-proof/': { target: `http://localhost:${ownerPort}`, changeOrigin: false },
      '/v1/midnames/claim/': {
        target: `http://localhost:${sponsorPort}`,
        changeOrigin: false,
      },
    },
  },
  plugins: [
    {
      name: 'native-page-account-fixture',
      enforce: 'pre',
      load(id) {
        if (id.split('?')[0] === resolve('src/connector.ts')) return connector;
      },
    },
  ],
});

let quoteRequests = 0;
let proofRequests = 0;
let prepareRequests = 0;
let dispatchRequests = 0;
let indexerRequests = 0;
let browser: BrowserContext | undefined;
function observe(page: Page) {
  page.on('request', (request) => {
    const url = request.url();
    if (url.endsWith('/v1/midnames/claim/quote')) quoteRequests++;
    if (url.endsWith('/owner-proof/prove')) proofRequests++;
    if (url.endsWith('/v1/midnames/claim/prepare')) prepareRequests++;
    if (url.endsWith(claimDispatchPath)) dispatchRequests++;
    if (url === process.env.MN_INDEXER_URL) indexerRequests++;
  });
  page.on('pageerror', (error) => console.error('Passport page:', error.message));
}
async function open(page: Page, create = false) {
  observe(page);
  await page.goto(origin);
  await page
    .locator('#status')
    .filter({ hasText: /^Ready\./ })
    .waitFor({ state: 'attached' });
  await page.locator(create ? '#create' : '#open').click();
  await page.locator('#workspace-account').waitFor();
  await reveal(page, '#claim-recovery');
}
async function newBrowser() {
  return chromium.launchPersistentContext(resolve(output, 'page-chrome-profile'), {
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });
}

let original;
let lostResponse = false;
try {
  await vite.listen();
  assert.equal(new URL(vite.resolvedUrls?.local[0] ?? '').origin, origin);
  browser = await newBrowser();
  const page = await browser.newPage();
  const cdp = await browser.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      hasPrf: true,
    },
  });
  await page.goto(origin);
  // Playwright serializes this browser expression. Keep it as source text so
  // tsx cannot add a Node-side __name helper to a nested browser callback.
  await page.evaluate(`(async () => {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Isolated Passport naming' },
        user: {
          id: crypto.getRandomValues(new Uint8Array(32)),
          name: 'native-page',
          displayName: 'Native page',
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        extensions: { prf: {} },
      },
    });
    if (!(credential instanceof PublicKeyCredential))
      throw Error('Virtual naming credential was not created');
    let id = '';
    for (const byte of new Uint8Array(credential.rawId))
      id += byte.toString(16).padStart(2, '0');
    localStorage.setItem('native-naming-credential', id);
  })()`);
  await open(page, true);
  await page.locator('#claim-recovery-name').fill(input.name);
  await page.locator('#claim-review-quote').click();
  await page.locator('#claim-quote-summary').getByText(`Register ${input.name}`).waitFor();
  assert.equal(quoteRequests, 1);
  assert.equal(proofRequests, 0);
  await page.locator('#claim-prepare').click();
  await page
    .locator('#claim-recovery-status')
    .filter({ hasText: /No transaction has been sent|Original receipt saved/ })
    .waitFor({ timeout: 180_000 });
  original = claimReceipt(JSON.parse(await page.locator('#claim-recovery-receipt').inputValue()));
  assert.equal(original.name, input.name);
  assert.equal(original.accountAddress, input.accountAddress);
  assert.equal(quoteRequests, 1);
  assert.equal(proofRequests, 1);
  assert.equal(prepareRequests, 1);
  assert.equal(dispatchRequests, 0);

  await page.route('**' + claimDispatchPath, async (route) => {
    const response = await route.fetch({ maxRetries: 0, maxRedirects: 0 });
    assert.equal(response.status(), 202);
    lostResponse = true;
    await route.abort('failed');
  });
  const sent = page.waitForEvent('requestfailed', {
    predicate: (request) => request.url().endsWith(claimDispatchPath),
  });
  await page.locator('#claim-dispatch').click();
  await page
    .locator('#claim-recovery-status')
    .filter({ hasText: /^No transaction has been sent\. Review the payment terms/ })
    .waitFor();
  assert.equal(dispatchRequests, 0);
  await page.locator('#claim-dispatch').click();
  await sent;
  assert.equal(dispatchRequests, 1);
  await browser.close();
  browser = await newBrowser();
  const resumed = await browser.newPage();
  await open(resumed);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await resumed.locator('#claim-recovery-check').click();
    const status = (await resumed.locator('#claim-recovery-status').textContent()) ?? '';
    if (status.startsWith('Registered.')) break;
    assert.match(status, /pending|unavailable|Registered|Claim check/i);
    await delay(1500);
  }
  assert.match(await resumed.locator('#claim-recovery-status').innerText(), /^Registered\./);
  assert.ok(lostResponse && indexerRequests > 0);
  assert.equal(dispatchRequests, 1);
  writeFileSync(
    resolve(output, 'page-owned-claim.json'),
    JSON.stringify({
      original,
      quoteRequests,
      proofRequests,
      prepareRequests,
      dispatchRequests,
      indexerRequests,
      lostResponse,
      recoveredInSameProfile: true,
      connectorWasFixture: true,
    }) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
} finally {
  await browser?.close();
  await vite.close();
}
