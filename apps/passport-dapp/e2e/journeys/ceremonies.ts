import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import type { JourneyHarness } from './types.js';

import { click, navClick, approve, assertAccountWorkspace } from './ui.js';
import { origin } from './constants.js';

import type { checkSignedOutLandingHidesWorkspaceNavigationAnd } from './presentation.js';
export async function checkDeclinedIrreversibleCreateHasNoCredentialOr(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { arm, waitStatus, calls, done } = h;
  const { owner } = input;
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
  await owner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
  await assert.rejects(owner.locator('#activity-toggle').click({ timeout: 200 }));
  await assert.rejects(owner.locator('#nav-settings').click({ timeout: 200 }));
  assert.ok(await owner.locator('#ceremony-continue').isDisabled());
  assert.equal(await owner.evaluate(() => document.activeElement?.id), 'ceremony-cancel');
  await click(owner, '#ceremony-cancel');
  await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
  assert.equal(await owner.locator('#main').getAttribute('data-landing'), 'true');
  assert.equal(await owner.locator('#workspace-account').isVisible(), false);
  assert.equal(calls.length, 0);
  assert.equal(
    await owner.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1')),
    null,
  );
  done('account-actions.declined-irreversible-create-has-no-credential-or');
}

export async function checkBlockingConsentPreventsBackgroundNavigationCancelledAttempt(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { done } = h;
  const { owner } = input;
  assert.equal(await owner.locator('.operation-status').getAttribute('data-phase'), 'cancelled');
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
  await navClick(owner, '#brand-home');
  await owner.locator('#activity-toggle').click();
  done('account-actions.blocking-consent-prevents-background-navigation-cancelled-attempt');
}

export async function checkMobileOperationToAuditNavigationClosesThe(
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
  await owner.locator('#activity-toggle').click();
  await owner.locator('#activity-sheet [data-control="operation-audit-link"]').click();
  await owner.locator('#activity-sheet').waitFor({ state: 'hidden' });
  assert.equal(await owner.locator('#workspace-audit').isVisible(), true);
  await owner.waitForFunction(() => document.activeElement?.id === 'workspace-audit-title');
  assert.equal(calls.length, 0);
  await owner.setViewportSize({ width: 1280, height: 900 });
  await navClick(owner, '#brand-home');
  await owner.locator('#activity-toggle').click();
  done('account-actions.mobile-operation-to-audit-navigation-closes-the');
}

export async function checkEscapeOnTheFirstCeremonyRefusesCredential(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { waitStatus, calls, done } = h;
  const { owner } = input;
  const credentialsUsed = () =>
    owner.evaluate(
      () =>
        (
          window as typeof window & {
            __passportPurposeObservations: unknown[];
          }
        ).__passportPurposeObservations.length,
    );
  await approve(owner, 'create');
  await owner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
  await owner.setViewportSize({ width: 390, height: 844 });
  await assert.rejects(owner.locator('#activity-toggle').click({ timeout: 200 }));
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(await credentialsUsed(), 0, 'showing the combined review must not use a passkey');
  assert.equal(
    await owner.locator('#consent-retirement-ack').evaluate((e) => e === document.activeElement),
    true,
  );
  await owner.keyboard.press('Escape');
  await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
  await owner.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await credentialsUsed(), 0);
  assert.equal(calls.length, 0);
  done('account-actions.escape-on-the-first-ceremony-refuses-credential');
  done('account-actions.mobile-combined-passkey-review-is-the-sole');
  return { credentialsUsed };
}

export async function checkOperationTerminationClosesPendingConsentOverlapAnd(
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
  const { waitStatus, calls, done } = h;
  const { owner, credentialsUsed } = input;
  await owner.addScriptTag({
    type: 'module',
    url: `${origin}/e2e/fixtures/consent-controls.ts`,
  });
  const controlsRefusal = () =>
    owner.evaluate(() =>
      (
        window as typeof window & {
          __consentControls: {
            refused(): Promise<string>;
          };
        }
      ).__consentControls.refused(),
    );
  assert.equal(await controlsRefusal(), 'UserCancelled');
  await approve(owner, 'create');
  await owner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
  const pendingId = await owner.locator('#ceremony-dialog').getAttribute('data-ceremony-id');
  assert.equal(await controlsRefusal(), 'UserCancelled', 'overlapping requests must refuse');
  assert.equal(await owner.locator('#ceremony-dialog').getAttribute('data-ceremony-id'), pendingId);
  await owner.evaluate(() =>
    (
      window as typeof window & {
        __consentControls: {
          finish(): void;
        };
      }
    ).__consentControls.finish(),
  );
  await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
  assert.equal(await credentialsUsed(), 0);
  assert.equal(calls.length, 0);
  assert.equal(await controlsRefusal(), 'UserCancelled');
  done('account-actions.operation-termination-closes-pending-consent-overlap-and');
}

export async function checkApprovedMobileAccessRevealsItsPurposeIn(
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
  const { waitStatus, calls, done } = h;
  const { owner, credentialsUsed } = input;
  await owner.setViewportSize({ width: 390, height: 844 });
  await approve(owner, 'create');
  await owner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
  await click(owner, '#ceremony-continue');
  if (h.arm === 'jubjub') {
    await waitStatus(owner, /is created/);
    assert.equal(await credentialsUsed(), 1);
    assert.match(await owner.locator('#routine-status').innerText(), /Unlocked until/);
    assert.equal(await owner.locator('#authenticated-owner-key').textContent(), 'Not unlocked');
    assert.equal(calls.filter((c) => c === 'create').length, 1);
    await owner.setViewportSize({ width: 1280, height: 900 });
    done('account-actions.approved-mobile-access-reveals-its-purpose-in');
    done('account-actions.jubjub-creation-shares-one-credential-and-routine-keys');
    return;
  }
  await owner
    .locator('#ceremony-details')
    .filter({ hasText: /Verify that your new passkey can sign/ })
    .waitFor();
  assert.equal(await credentialsUsed(), 1, 'only the expressly approved create was accessed');
  await click(owner, '#ceremony-cancel');
  await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
  assert.equal(await credentialsUsed(), 1, 'declining verification must not assert the passkey');
  assert.equal(calls.length, 0, 'declining the probe must not deploy');
  assert.equal(
    await owner.locator('#activity-sheet').evaluate((e) => (e as HTMLDialogElement).open),
    false,
  );
  await owner.setViewportSize({ width: 1280, height: 900 });
  done('account-actions.approved-mobile-access-reveals-its-purpose-in');
  done('account-actions.the-second-initial-prompt-requires-separate-approval');
}

export async function checkEachLaterSetupSignatureNeedsNewApproval(
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
  const { arm, waitStatus, calls, done } = h;
  const { owner, credentialsUsed } = input;
  if (arm === 'p256') {
    await approve(owner, 'create');
    for (const purpose of ['create', 'verify-created', 'sign']) {
      await owner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
      assert.equal(await owner.locator('#ceremony-purpose').getAttribute('data-purpose'), purpose);
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
    done('account-actions.each-later-setup-signature-needs-new-approval');
  }
}

export async function checkAcknowledgedCreationAndOneExplicitApprovalPer(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { waitStatus, done } = h;
  const { owner } = input;
  if (h.arm === 'p256') await approve(owner, 'create');
  await waitStatus(owner, /is created/);
  await assertAccountWorkspace(owner);
  done('account-actions.acknowledged-creation-and-one-explicit-approval-per');
}
