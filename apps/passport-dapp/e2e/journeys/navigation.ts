import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import type { JourneyHarness } from './types.js';

import { openNavigation, navClick } from './ui.js';
import { address } from './constants.js';

import type { checkSignedOutLandingHidesWorkspaceNavigationAnd } from './presentation.js';
export async function checkPersistentNavigationKeepsParentPositionsAndDocument(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { calls, done } = h;
  const { owner } = input;
  await openNavigation(owner);
  assert.deepEqual(await owner.locator('.workspace-nav-group > button').allTextContents(), [
    'Passport account',
    'Midnight wallet',
    'Audit',
    'Settings',
  ]);
  for (const label of ['Passport account', 'Midnight wallet', 'Audit', 'Settings']) {
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
      const nav =
        document.querySelector<HTMLElement>('.workspace-nav') ??
        (() => {
          throw new Error('Missing journey fixture value');
        })();
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
      current.every(
        (top, index) =>
          Math.abs(
            top -
              (originalMenuPositions[index] ??
                (() => {
                  throw new Error('Missing journey fixture value');
                })()),
          ) < 1,
      ),
      'navigation row positions must not change with the selected page',
    );
    assert.equal(
      await owner.locator('.workspace-center').evaluate((item) => item.getBoundingClientRect().top),
      contentTop,
    );
    assert.equal(await owner.evaluate(() => scrollY), 0, 'navigation must not scroll the document');
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
    assert.equal(await owner.locator('#workspace-audit [data-workspace-page]:visible').count(), 1);
    assert.equal(await owner.locator('.workspace-submenu [aria-current="page"]').count(), 1);
    assert.equal(await owner.evaluate(() => location.hash), `#audit/${id}`);
  }
  await navClick(owner, '#brand-home');
  assert.equal(calls.length, 0);
  done('presentation.persistent-navigation-keeps-parent-positions-and-document');
}

export async function checkCompactNavigationDrawerContainsFocusReturnsFocus(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { calls, done } = h;
  const { owner } = input;
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
  assert.equal(await owner.evaluate(() => document.activeElement?.id), 'settings-tab-developer');
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
    await owner.locator('.workspace-center').evaluate((item) => item.getBoundingClientRect().top),
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
  await navClick(owner, '#brand-home');
  assert.equal(calls.length, 0);
  done('presentation.compact-navigation-drawer-contains-focus-returns-focus');
}

export async function checkWalletAndAuditDeepLinksSelectPresentation(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { newPage, calls, done } = h;
  const { owner } = input;
  for (const [fragment, control] of [
    ['#wallet/lace', '#wallet-tab-lace'],
    ['#audit/requests', '#audit-tab-requests'],
    ['#wallet/unknown', '#wallet-tab-builtin'],
    ['#audit/unknown', '#audit-tab-events'],
  ]) {
    const linked = await newPage(undefined, false, fragment);
    assert.equal(
      await linked
        .locator(
          control ??
            (() => {
              throw new Error('Missing journey fixture value');
            })(),
        )
        .getAttribute('aria-current'),
      'page',
    );
    await linked.close();
  }
  await owner.bringToFront();
  assert.equal(calls.length, 0);
  done('presentation.wallet-and-audit-deep-links-select-presentation');
}

export async function checkLandingOffersBalancedSignUpAndLog(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { arm, calls, done } = h;
  const { owner } = input;
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
    (await owner.locator('.overview-choices button').allTextContents()).map((text) => text.trim()),
    ['Sign up', 'Log in'],
  );
  assert.ok(
    await owner.locator('#create').evaluate((button) => button.classList.contains('btn-primary')),
  );
  assert.ok(
    await owner
      .locator('#open')
      .evaluate(
        (button) =>
          button.classList.contains('btn-secondary') && !button.classList.contains('btn-primary'),
      ),
  );
  assert.equal(await owner.locator('.overview-welcome > .overview-note').count(), 0);
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
  await navClick(owner, '#brand-home');
  assert.equal(await owner.locator('#open-address').inputValue(), address);
  assert.equal(await owner.locator('#open-address').isVisible(), false);
  const choiceBounds = await owner.locator('.overview-choices button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const bounds = button.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, height: bounds.height, width: bounds.width };
    }),
  );
  const [signupBounds, loginBounds] = choiceBounds;
  assert.ok(signupBounds && loginBounds);
  assert.ok(loginBounds.y >= signupBounds.y + signupBounds.height);
  assert.ok(Math.abs(signupBounds.x - loginBounds.x) < 2);
  assert.ok(Math.abs(signupBounds.width - loginBounds.width) < 2);
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
  done('presentation.landing-offers-balanced-sign-up-and-log');
}
