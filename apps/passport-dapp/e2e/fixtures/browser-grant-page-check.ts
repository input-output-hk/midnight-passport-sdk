import assert from 'node:assert/strict';
import type { Locator, Page } from 'playwright-core';
import { toHex } from '@input-output-hk/mn-passport-account';
import type { PasskeyCredential } from '@input-output-hk/mn-passport-account/ports';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { PASSPORT_SERVICE_API_VERSION } from '@input-output-hk/mn-passport-protocol';

async function approvePasskey(page: Page, purpose: string, next?: Locator) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: purpose, exact: true }).waitFor();
  const proceed = dialog.getByRole('button', { name: 'Continue to passkey' });
  await proceed.click();
  if (!next) return;
  // Chrome may add signed GREASE fields. Each retry must have its own consent.
  for (let attempt = 2; attempt <= 5; attempt++) {
    const retry = dialog.getByRole('heading', {
      name: purpose + ' · retry ' + attempt,
      exact: true,
    });
    await retry.or(next).waitFor();
    if (await next.isVisible()) return;
    await proceed.click();
  }
  await next.waitFor();
}

export async function checkGrantPages(
  page: Page,
  issuer: string,
  holder: string,
  account: string,
  manifestSha256: string,
  registerOwner: () => Promise<PasskeyCredential>,
) {
  const serviceCalls: string[] = [];
  let owner: PasskeyCredential | undefined;
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (
      owner &&
      url.origin === issuer &&
      url.pathname === '/v1/accounts/undeployed/' + toHex(owner.credentialId)
    ) {
      serviceCalls.push('/v1/accounts/<owner>');
      return route.fulfill({
        json: {
          address: account,
          credentialId: toHex(owner.credentialId),
          scheme: 'p256-webauthn',
          status: 'active',
          publicKey: { x: owner.publicKey.x.toString(16), y: owner.publicKey.y.toString(16) },
          policy: {
            origin: toHex(owner.policy.origin),
            rp_id_hash: toHex(owner.policy.rp_id_hash),
          },
        },
      });
    }
    serviceCalls.push(url.pathname);
    if (url.origin === issuer && url.pathname.startsWith('/v1/browser-grant/'))
      return route.continue();
    if (url.pathname !== '/v1/config') return route.abort();
    await route.fulfill({
      json: {
        networkId: 'undeployed',
        bindingId: 'acc-s3r1.1',
        manifestSha256,
        zkBaseUrl: issuer + '/v1/zk/acc-s3r1.1',
        apiVersions: [PASSPORT_SERVICE_API_VERSION],
        indexerUri: issuer + '/graphql',
        indexerWsUri: 'wss://' + new URL(issuer).host + '/graphql',
        nodeUri: issuer + '/node',
        proofServerUri: issuer + '/proof',
        coinPublicKey: 'fixture',
        encryptionPublicKey: 'fixture',
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(holder + '/grant.html');
  await page.getByRole('heading', { name: 'Request withdrawal permission' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const address = MidnightBech32m.encode(
    'undeployed',
    new UnshieldedAddress(Buffer.alloc(32, 0x72)),
  ).asString();
  await page.getByLabel('Passport account address').fill(account);
  await page.getByLabel('Fixed recipient’s unshielded Midnight address').fill(address);
  const start = page.getByRole('button', { name: 'Create permission request' });
  const dialog = page.getByRole('dialog');
  await start.click();
  await dialog.getByRole('heading', { name: 'Create a holder passkey' }).waitFor();
  assert.equal(
    await dialog
      .getByRole('button', { name: 'Cancel' })
      .evaluate((node) => node === document.activeElement),
    true,
  );
  await page.keyboard.press('Escape');
  await page.getByText('Approval cancelled.').waitFor();
  assert.deepEqual(serviceCalls, []);

  await start.click();
  await approvePasskey(page, 'Create a holder passkey');
  await approvePasskey(
    page,
    'Verify the new holder passkey',
    dialog.getByRole('heading', { name: 'Sign this permission request', exact: true }),
  );
  await approvePasskey(
    page,
    'Sign this permission request',
    page.getByRole('heading', { name: 'Review withdrawal permission' }),
  );

  await page.getByRole('heading', { name: 'Review withdrawal permission' }).waitFor();
  assert.equal(page.url(), issuer + '/grant.html');
  assert.deepEqual(serviceCalls, []);
  const accountField = page.getByLabel('Passport account address');
  const review = page.getByRole('button', { name: 'Review request' });
  await accountField.fill('00'.repeat(32));
  await review.click();
  await page
    .getByText('This request does not match the selected account or configured holder.')
    .waitFor();
  await accountField.fill(account);
  await review.click();
  await page.getByRole('heading', { name: 'Requested permission' }).waitFor();
  assert.equal(await page.getByText('NIGHT', { exact: true }).isVisible(), true);
  assert.equal(await page.getByText('5 smallest units', { exact: true }).count(), 2);
  await page.getByRole('button', { name: 'Recover original request' }).click();
  await dialog.getByRole('heading', { name: /Identify your owner passkey/ }).waitFor();
  assert.equal(
    await dialog
      .getByText('Recovery checks the original transaction.', { exact: false })
      .isVisible(),
    true,
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByText('Approval cancelled.').waitFor();
  assert.deepEqual(serviceCalls, ['/v1/config']);

  await page.reload();
  await page.getByRole('heading', { name: 'Review withdrawal permission' }).waitFor();
  assert.equal(await accountField.inputValue(), account);
  await review.click();
  assert.equal(
    await page.getByRole('button', { name: 'Recover original request' }).isVisible(),
    true,
  );
  await page.goto(holder + '/grant.html#invalid');
  await page.getByRole('heading', { name: 'Pending request' }).waitFor();
  assert.equal(page.url(), holder + '/grant.html');
  await page.getByRole('button', { name: 'Return to issuer' }).click();
  await page.getByRole('heading', { name: 'Review withdrawal permission' }).waitFor();
  assert.equal(page.url(), issuer + '/grant.html');
  assert.deepEqual(serviceCalls, ['/v1/config']);

  owner = await registerOwner();
  await accountField.fill(account);
  await review.click();
  await page.getByRole('button', { name: 'Recover original request' }).click();
  await approvePasskey(
    page,
    'Identify your owner passkey and unlock the recovery journal',
    dialog.getByRole('heading', { name: 'Authenticate to the sponsor relay', exact: true }),
  );
  const noOriginal = page.getByText('No original request was found.');
  await approvePasskey(page, 'Authenticate to the sponsor relay', noOriginal);
  await noOriginal.waitFor();
  assert.deepEqual(serviceCalls, [
    '/v1/config',
    '/v1/config',
    '/v1/accounts/<owner>',
    '/v1/browser-grant/session/challenge',
    '/v1/browser-grant/session/verify',
    '/v1/browser-grant/read',
  ]);
}
