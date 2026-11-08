import assert from 'node:assert/strict';
import type { JourneyHarness } from './types.js';

import { navClick, click } from './ui.js';
import { address, manifest } from './constants.js';

import type { checkSignedOutLandingHidesWorkspaceNavigationAnd } from './presentation.js';
export async function checkSettingsSubmenusPreservePublicDraftsDeepLink(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { calls, newPage, done } = h;
  const { owner } = input;
  assert.deepEqual(
    await owner
      .locator('#activity-content .operation-status > h2, #activity-content .journey > h2')
      .allTextContents(),
    ['Current operation', 'Your journey'],
  );
  assert.equal(await owner.locator('#capability-operation').isVisible(), false);
  assert.equal(await owner.locator('#session-minutes').isVisible(), false);
  for (const view of ['account', 'wallet', 'audit', 'settings']) {
    await navClick(owner, `#nav-${view}`);
    assert.equal(await owner.locator(`#workspace-${view}`).isVisible(), true);
    assert.equal(await owner.locator('.workspace-view:visible').count(), 1);
  }
  await navClick(owner, '#brand-home');
  assert.equal(await owner.locator('#workspace-overview').isVisible(), true);
  assert.equal(await owner.locator('.workspace-view:visible').count(), 1);
  assert.equal(await owner.locator('#nav-overview').count(), 0);
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
  done('presentation.settings-submenus-preserve-public-drafts-deep-link');
}

export async function checkFourWorkspacesAndAHomeLinkSeparate(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { done } = h;
  const { owner } = input;
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
  await navClick(owner, '#brand-home');
  done('presentation.four-workspaces-and-a-home-link-separate');
}

export async function checkConsistentAccountPageLinksSupportArrowKeyboard(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { calls, done } = h;
  const { owner } = input;
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
  assert.equal(await owner.locator('#account-tab-balances').getAttribute('aria-current'), 'page');
  assert.equal(await owner.locator('#account-tab-deposit').getAttribute('aria-current'), null);
  await owner.keyboard.press('Enter');
  assert.equal(await owner.locator('#account-tab-deposit').getAttribute('aria-current'), 'page');
  assert.equal(await owner.evaluate(() => document.activeElement?.id), 'account-tab-deposit');
  await owner.keyboard.press('End');
  await owner.keyboard.press('Enter');
  assert.equal(await owner.locator('#account-page-withdraw').isVisible(), true);
  assert.equal(await owner.locator('#account-page-balances').isVisible(), false);
  assert.equal(await owner.locator('#account-page-deposit').isVisible(), false);
  assert.equal(await owner.locator('#withdraw').isEnabled(), false);
  await owner.keyboard.press('Home');
  await owner.keyboard.press('Enter');
  assert.equal(await owner.locator('#account-tab-balances').getAttribute('aria-current'), 'page');
  await owner.keyboard.press('ArrowUp');
  await owner.keyboard.press('Enter');
  assert.equal(await owner.locator('#account-tab-withdraw').getAttribute('aria-current'), 'page');
  await owner.setViewportSize({ width: 390, height: 844 });
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await owner.setViewportSize({ width: 1280, height: 900 });
  assert.equal(calls.length, 0);
  assert.equal(
    await owner.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1')),
    null,
  );
  done('presentation.consistent-account-page-links-support-arrow-keyboard');
}

export async function checkAccountOperationDeepLinksRestorePresentationOnly(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { newPage, calls, done } = h;
  const { owner } = input;
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
  done('presentation.account-operation-deep-links-restore-presentation-only');
}

export async function checkActivityOwnsProgressResultsAndExplanationsWithout(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { done } = h;
  const { owner } = input;
  await navClick(owner, '#brand-home');
  assert.equal(await owner.locator('.workspace-center #progress').count(), 0);
  assert.equal(await owner.locator('.workspace-center #status').count(), 0);
  assert.equal(await owner.locator('.workspace-center #ceremony-purpose').count(), 0);
  assert.equal(await owner.locator('#activity-content #progress').count(), 1);
  assert.equal(await owner.locator('#activity-content #ceremony-purpose').count(), 1);
  assert.equal(await owner.locator('#activity-content #operation-safety-notice').count(), 1);
  done('presentation.activity-owns-progress-results-and-explanations-without');
}

export async function checkMobileActivitySheetContainsFocusAndEscape(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { calls, done } = h;
  const { owner } = input;
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
  done('presentation.mobile-activity-sheet-contains-focus-and-escape');
}
