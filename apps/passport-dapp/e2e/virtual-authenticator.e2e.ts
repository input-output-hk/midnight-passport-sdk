// Exercise the real browser WebAuthn path with Chrome's CDP virtual authenticator.
// Start the pinned local demo first. The deploy-heavy flow is opt-in:
//   pnpm --filter passport-dapp virtual-authenticator
//   PASSPORT_VIRTUAL_E2E_FULL=1 pnpm --filter passport-dapp virtual-authenticator
import assert from 'node:assert/strict';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

const baseUrl = process.env.PASSPORT_DEMO_URL ?? 'http://localhost:5173/';
if (new URL(baseUrl).hostname !== 'localhost')
  throw new Error('the virtual authenticator requires the localhost passkey RP ID');
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  ...(process.env.CHROME_BIN && { executablePath: process.env.CHROME_BIN }),
});

async function waitForStatus(page: Page, success: RegExp, timeout: number) {
  await Promise.race([
    page.locator('#status').filter({ hasText: success }).waitFor({ timeout }),
    page
      .locator('#status')
      .filter({ hasText: /failed\./ })
      .waitFor({ timeout })
      .then(async () => {
        throw new Error(
          `${await page.locator('#status').innerText()}\n${await page.locator('#log').innerText()}`,
        );
      }),
    page
      .locator('#status')
      .filter({ hasText: /^Ready\./ })
      .waitFor({ timeout })
      .then(() => {
        throw new Error(
          'The demo page reloaded during an account operation. Restart the test with a stable Vite build.',
        );
      }),
  ]);
}

async function withAuthenticator(
  hasPrf: boolean,
  use: (
    page: Page,
    context: BrowserContext,
    events: { added: number; asserted: number },
  ) => Promise<void>,
) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    if (process.env.PASSPORT_VIRTUAL_DEBUG === '1') {
      page.on('console', (message) => {
        if (message.text().startsWith('WEBAUTHN_ASSERTION ') || message.type() === 'error')
          console.log('browser console:', message.text());
      });
      page.on('pageerror', (error) => console.log('browser error:', error.message));
      await page.addInitScript({
        content: `(() => {
          const prototype = Object.getPrototypeOf(navigator.credentials);
          const original = prototype.get;
          Object.defineProperty(prototype, 'get', {
            value: async function (options) {
              const result = await original.call(this, options);
              if (result && result.response && result.response.clientDataJSON)
                console.log('WEBAUTHN_ASSERTION ' +
                  new TextDecoder().decode(result.response.clientDataJSON));
              return result;
            },
          });
        })();`,
      });
    }
    const cdp = await context.newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const events = { added: 0, asserted: 0 };
    cdp.on('WebAuthn.credentialAdded', () => events.added++);
    cdp.on('WebAuthn.credentialAsserted', () => events.asserted++);
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        hasPrf,
      },
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (process.env.PASSPORT_VIRTUAL_DEBUG === '1') console.log('navigated', hasPrf);
    await page.locator('#status').filter({ hasText: /Ready/ }).waitFor({ timeout: 30_000 });
    if (process.env.PASSPORT_VIRTUAL_DEBUG === '1') console.log('page ready', hasPrf);
    await use(page, context, events);
  } finally {
    await context.close();
  }
}

try {
  await withAuthenticator(false, async (page, _context, events) => {
    await page.getByRole('button', { name: 'Create account' }).click();
    await page
      .locator('#status')
      .filter({ hasText: /UnsupportedAuthenticator/ })
      .waitFor({
        timeout: 30_000,
      });
    assert.equal(events.added, 1, 'the passkey was created before PRF refusal');
    assert.equal(events.asserted, 0, 'PRF refusal happened before an enrollment assertion');
    assert.doesNotMatch(await page.locator('#log').innerText(), /deploying|deployed/i);
    console.log('virtual authenticator: no-PRF refused before deploy');
  });

  await withAuthenticator(true, async (page, _context, events) => {
    // Browser cancellation is a rejected WebAuthn promise. Inject exactly that browser result;
    // no virtual credential is created and no chain request may start.
    await page.evaluate(`(() => {
      const prototype = Object.getPrototypeOf(navigator.credentials);
      Object.defineProperty(prototype, 'create', {
        value: async () => { throw new DOMException('User cancelled', 'NotAllowedError'); },
        configurable: true,
      });
    })()`);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page
      .locator('#status')
      .filter({ hasText: /UserCancelled/ })
      .waitFor({ timeout: 30_000 });
    assert.equal(events.added, 0);
    assert.equal(events.asserted, 0);
    assert.doesNotMatch(await page.locator('#log').innerText(), /deploying|deployed/i);
    console.log('virtual authenticator: cancelled creation refused before deploy');
  });

  if (process.env.PASSPORT_VIRTUAL_E2E_FULL === '1') {
    await withAuthenticator(true, async (page, _context, events) => {
      console.log('virtual authenticator: starting full create');
      await page.getByRole('button', { name: 'Create account' }).click();
      console.log(
        'virtual authenticator: clicked create',
        await page.locator('#status').innerText(),
      );
      await waitForStatus(page, /is created/, 900_000);
      assert.equal(events.added, 1, 'create stores one virtual credential');
      assert.ok(
        events.asserted >= 4,
        'the probe, activation and sealed publications used real assertions',
      );
      const afterCreateAssertions = events.asserted;
      const creationLog = await page.locator('#log').innerText();
      assert.match(creationLog, /Create and verify the passkey/);
      assert.match(creationLog, /Prepare account keys/);
      assert.match(creationLog, /Deploy the account/);
      assert.match(creationLog, /Activate the first device/);
      const accountAddress = await page
        .locator('#account-facts dd span.value')
        .first()
        .getAttribute('title');
      assert.match(accountAddress ?? '', /^[0-9a-f]{64}$/);

      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Rotate sealed viewing key' }).click();
      await waitForStatus(page, /confirmed its new sealed viewing secret/, 240_000);
      assert.ok(events.asserted > afterCreateAssertions, 'rotation required owner assertions');
      const afterFirstRotationAssertions = events.asserted;

      await page.reload();
      await page.getByRole('button', { name: 'Open with passkey' }).click();
      await waitForStatus(page, /is reopened/, 120_000);
      assert.ok(events.asserted > afterFirstRotationAssertions, 'reopen used WebAuthn');

      // Create a second *real virtual* credential. A narrowly controlled browser wrapper asks
      // Chrome to use it for the pinned wallet ceremony; the SDK must reject its different ID.
      const otherCredentialId = await page.evaluate(`(async () => {
        const challenge = new Uint8Array(32).fill(19);
        const credential = await navigator.credentials.create({ publicKey: {
          rp: { id: 'localhost', name: 'Other Passport device' },
          user: { id: new Uint8Array(32).fill(20), name: 'other', displayName: 'other' },
          challenge, pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
          authenticatorSelection: { userVerification: 'required', residentKey: 'required' },
          extensions: { prf: { eval: { first: challenge, second: new Uint8Array(32).fill(21) } } },
        }});
        return Array.from(new Uint8Array(credential.rawId));
      })()`);
      assert.equal(events.added, 2);
      await page.evaluate(`(() => {
        const prototype = Object.getPrototypeOf(navigator.credentials);
        window.__passportOriginalGet = prototype.get;
        Object.defineProperty(prototype, 'get', {
          configurable: true,
          value: function (options) {
            return window.__passportOriginalGet.call(this, {
              ...options,
              publicKey: {
                ...options.publicKey,
                allowCredentials: [{ type: 'public-key', id: new Uint8Array(${JSON.stringify(otherCredentialId)}) }],
              },
            });
          },
        });
      })()`);
      await page.getByRole('button', { name: 'Connect built-in wallet' }).click();
      await page
        .locator('#status')
        .filter({ hasText: /AccountNotFound/ })
        .waitFor({ timeout: 30_000 });
      assert.match(
        await page.locator('#log').innerText(),
        /not the passkey this account was created with/i,
      );
      await page.evaluate(`(() => {
        const prototype = Object.getPrototypeOf(navigator.credentials);
        Object.defineProperty(prototype, 'get', { configurable: true, value: window.__passportOriginalGet });
        delete window.__passportOriginalGet;
      })()`);
      const beforeWalletAssertions = events.asserted;
      await page.getByRole('button', { name: 'Connect built-in wallet' }).click();
      await page.locator('#wallet-facts').waitFor({ state: 'visible', timeout: 120_000 });
      assert.equal(
        events.asserted,
        beforeWalletAssertions + 1,
        'the pinned wallet uses one PRF assertion',
      );
      const afterWalletAssertions = events.asserted;
      page.once('dialog', (dialog) => dialog.accept());
      await page.getByRole('button', { name: 'Rotate sealed viewing key' }).click();
      await waitForStatus(page, /confirmed its new sealed viewing secret/, 240_000);
      assert.ok(
        events.asserted > afterWalletAssertions,
        'second rotation required owner assertions',
      );
      console.log(
        `virtual authenticator: create, rotate, reload, open, wrong-passkey refusal, wallet, rotate passed; ${events.asserted} assertions; ACC ${accountAddress}`,
      );
    });
  }
} finally {
  await browser.close();
}
