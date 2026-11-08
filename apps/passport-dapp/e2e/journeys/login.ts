import assert from 'node:assert/strict';
import type { JourneyHarness } from './types.js';

import {
  navClick,
  assertAccountWorkspace,
  observeCredentialAccess,
  approve,
  click,
  select,
  fill,
  reveal,
} from './ui.js';
import { origin, address } from './constants.js';

import type { checkSignedOutLandingHidesWorkspaceNavigationAnd } from './presentation.js';
import type { checkEscapeOnTheFirstCeremonyRefusesCredential } from './ceremonies.js';
export async function checkAuthenticatedHomeReturnsToBalancesWithoutAn(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
      'credentialsUsed'
    >,
) {
  const { archiveObservations, arm, done } = h;
  const { owner, credentialsUsed } = input;
  await archiveObservations(owner, arm);
  const afterCreateCredentials = await credentialsUsed();
  await navClick(owner, '#account-tab-withdraw');
  await navClick(owner, '#brand-home');
  await assertAccountWorkspace(owner);
  assert.equal(await owner.locator('#nav-overview').count(), 0);
  assert.equal(await credentialsUsed(), afterCreateCredentials);
  done('account-actions.authenticated-home-returns-to-balances-without-an');
}

export async function checkStandaloneBuiltInWalletConnectsWithOne(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
      'credentialsUsed'
    >,
) {
  const { arm, waitStatus, done } = h;
  const { owner, credentialsUsed } = input;
  // A fresh document has no authenticated workspace; stored passkey hints do not open it.
  await owner.goto(`${origin}/?mockPasskey&fixtureArm=${arm}&freshEntry#overview`);
  await owner
    .locator('#status')
    .filter({ hasText: /^Ready\./ })
    .waitFor({ state: 'attached' });
  await observeCredentialAccess(owner);
  assert.equal(await owner.locator('#main').getAttribute('data-landing'), 'true');
  assert.equal(await owner.locator('#workspace-account').isVisible(), false);
  const beforeStandaloneWallet = await credentialsUsed();
  await approve(owner, 'wallet');
  await waitStatus(owner, /wallet connected through/);
  assert.equal(await credentialsUsed(), beforeStandaloneWallet + 1);
  assert.equal(await owner.locator('#authenticated-owner-key').textContent(), 'Not unlocked');
  done('account-actions.standalone-built-in-wallet-connects-with-one');
}

export async function checkCombinedLoginHasAnExplicitPurposeReview(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
    'credentialsUsed'
  > &
    Pick<Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>, 'owner'>,
) {
  const { waitStatus, done } = h;
  const { credentialsUsed, owner } = input;
  const beforeDeclinedLogin = await credentialsUsed();
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
    beforeDeclinedLogin,
    'declining combined login prevents both identification and PRF access',
  );
  done('account-actions.combined-login-has-an-explicit-purpose-review');
}

export async function checkChangingTheHiddenLifetimeAfterLoginConsent(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
    'credentialsUsed'
  > &
    Pick<Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>, 'owner'>,
) {
  const { calls, waitStatus, done } = h;
  const { credentialsUsed, owner } = input;
  const beforeLogin = await credentialsUsed();
  const beforeLoginOwnerEnrollment = calls.filter((action) => action === 'enroll-owner').length;
  await select(owner, '#routine-minutes', '15');
  await approve(owner, 'open', async () => {
    assert.match(
      (await owner.locator('#ceremony-details').textContent()) ??
        (() => {
          throw new Error('Missing journey fixture value');
        })(),
      /15 minutes/,
    );
    assert.equal(
      await credentialsUsed(),
      beforeLogin,
      'showing login consent starts no credential',
    );
    // Negative alias probe: a later change to the hidden form must not extend reviewed custody.
    await owner.evaluate(() => {
      (document.getElementById('routine-minutes') as HTMLSelectElement).value = '30';
    });
  });
  await waitStatus(owner, /is reopened/);
  await assertAccountWorkspace(owner);
  const remainingRoutineLease = await owner.evaluate(async () => {
    const path = '/src/routine-access.ts';
    const module = (await import(/* @vite-ignore */ path)) as {
      routineKeys: {
        snapshot(): {
          expiresAt?: number;
        };
      };
    };
    return (module.routineKeys.snapshot().expiresAt ?? 0) - Date.now();
  });
  assert.ok(remainingRoutineLease > 14 * 60000 && remainingRoutineLease <= 15 * 60000);
  done('account-actions.changing-the-hidden-lifetime-after-login-consent');
  return { beforeLogin, beforeLoginOwnerEnrollment };
}

export async function checkActiveAccountLoginUsesOneCombinedRequest(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
    'credentialsUsed'
  > &
    Pick<
      Awaited<ReturnType<typeof checkChangingTheHiddenLifetimeAfterLoginConsent>>,
      'beforeLogin'
    > &
    Pick<Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>, 'owner'> &
    Pick<
      Awaited<ReturnType<typeof checkChangingTheHiddenLifetimeAfterLoginConsent>>,
      'beforeLoginOwnerEnrollment'
    >,
) {
  const { calls, done } = h;
  const { credentialsUsed, beforeLogin, owner, beforeLoginOwnerEnrollment } = input;
  assert.equal(await credentialsUsed(), beforeLogin + 1, 'login uses one actual credential call');
  assert.match(
    (await owner.locator('#routine-status').textContent()) ??
      (() => {
        throw new Error('Missing journey fixture value');
      })(),
    /Unlocked until/,
  );
  assert.equal(await owner.locator('#authenticated-owner-key').textContent(), 'Not unlocked');
  assert.equal(
    calls.filter((action) => action === 'enroll-owner').length,
    beforeLoginOwnerEnrollment,
    'login never enrolls a companion owner',
  );
  assert.equal(
    await owner.locator('#ceremony-purpose').getAttribute('data-purpose'),
    'identify-and-unlock',
  );
  done('account-actions.active-account-login-uses-one-combined-request');
}

export async function checkAddressLoginUsesOneCombinedRequestAnd(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
      'credentialsUsed'
    >,
) {
  const { archiveObservations, arm, waitStatus, done } = h;
  const { owner, credentialsUsed } = input;
  await archiveObservations(owner, arm);
  await owner.goto(`${origin}/?mockPasskey&fixtureArm=${arm}&addressEntry#overview`);
  await owner
    .locator('#status')
    .filter({ hasText: /^Ready\./ })
    .waitFor({ state: 'attached' });
  await observeCredentialAccess(owner);
  await select(owner, '#routine-minutes', '15');
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
  assert.match(
    (await owner.locator('#routine-status').textContent()) ??
      (() => {
        throw new Error('Missing journey fixture value');
      })(),
    /Unlocked until/,
  );
  assert.equal(await owner.locator('#authenticated-owner-key').textContent(), 'Not unlocked');
  done('account-actions.address-login-uses-one-combined-request-and');
  done('account-actions.reload-stays-on-landing-successful-creation-login');
}

export async function checkLoginThenHoldingsAndBuiltInWallet(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
    'credentialsUsed'
  > &
    Pick<Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>, 'owner'>,
) {
  const { waitStatus, done } = h;
  const { credentialsUsed, owner } = input;
  const afterRoutineLogin = await credentialsUsed();
  await approve(owner, 'holdings');
  await waitStatus(owner, /Verified 1 shielded/);
  await approve(owner, 'wallet');
  await waitStatus(owner, /wallet connected through/);
  assert.equal(
    await credentialsUsed(),
    afterRoutineLogin,
    'login-derived routine access serves the first holdings read and wallet connection without another prompt',
  );
  assert.equal(await owner.locator('#authenticated-owner-key').textContent(), 'Not unlocked');
  done('account-actions.login-then-holdings-and-built-in-wallet');
}

export async function checkDecliningPRFUnlockPreventsCredentialAccessAnd(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
      'credentialsUsed'
    >,
) {
  const { calls, waitStatus, done } = h;
  const { owner, credentialsUsed } = input;
  await click(owner, '#lock-routine');
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
  done('account-actions.declining-prf-unlock-prevents-credential-access-and');
}

export async function checkPublicReadsRevealActivityWithoutACeremony(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
      'credentialsUsed'
    >,
) {
  const { waitStatus, done } = h;
  const { owner, credentialsUsed } = input;
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
  done('account-actions.public-reads-reveal-activity-without-a-ceremony');
}

export async function checkApprovedDesktopPasskeyAccessRevealsActivityBefore(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { waitStatus, done } = h;
  const { owner } = input;
  if (await owner.locator('#activity-panel').isVisible())
    await owner.locator('#activity-toggle').click();
  assert.equal(await owner.locator('#activity-panel').isVisible(), false);
  await approve(owner, 'holdings');
  await waitStatus(owner, /Verified 1 shielded/);
  assert.equal(await owner.locator('#activity-panel').isVisible(), true);
  done('account-actions.approved-desktop-passkey-access-reveals-activity-before');
  done('account-actions.chain-labelled-holdings-ui-through-synthetic-driver');
}

export async function checkRotationReviewAndResult(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { waitStatus, done } = h;
  const { owner } = input;
  await approve(owner, 'rotate');
  await waitStatus(owner, /confirmed its new sealed/);
  done('account-actions.rotation-review-and-result');
}

export async function checkNIGHTAndWalletActionsStayReadyWhile(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { waitStatus, done } = h;
  const { owner } = input;
  await owner.evaluate(() => {
    const fixture = window as typeof window & {
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
  assert.match((await owner.locator('#wallet-facts').textContent()) ?? '', /Syncing independently/);
  await owner.evaluate(() => {
    const fixture = window as typeof window & {
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
  done('account-actions.night-and-wallet-actions-stay-ready-while');
}
