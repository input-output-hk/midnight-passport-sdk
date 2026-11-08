import assert from 'node:assert/strict';
import type { JourneyHarness } from './types.js';

import { click, approve, readSessionState, observeCredentialAccess, fill, navClick } from './ui.js';

import type { checkSignedOutLandingHidesWorkspaceNavigationAnd } from './presentation.js';
import type { checkReadableSessionScopeDistinguishesDraftSettingsFrom } from './session-approval.js';
import type { checkAccountFormsPreserveTheirValuesAcrossTabs } from './value.js';
export async function checkDeclinedExactSessionAuthorizationAndRevocationReviews(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkReadableSessionScopeDistinguishesDraftSettingsFrom>>,
      'countCredentials'
    >,
) {
  const { waitStatus, state, calls, done } = h;
  const { owner, countCredentials } = input;
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
  h.flags.rejectNextDialog = true;
  await approve(owner, 'revokeSession');
  await waitStatus(owner, /Session grant revocation cancelled before signing/);
  assert.equal(await owner.locator('.operation-status').getAttribute('data-phase'), 'cancelled');
  assert.equal(calls.filter((c) => c === 'revoke').length, revokesBeforeSessionDecline);
  assert.equal(await countCredentials(), credentialsBeforeSessionDecline);
  done('scoped-sessions.declined-exact-session-authorization-and-revocation-reviews');
}

export async function checkLocalLockErasesAuthorityLocallyAndA(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { waitStatus, state, done } = h;
  const { owner } = input;
  await approve(owner, 'revokeSession');
  await waitStatus(owner, /Session grant revoked on chain/);
  assert.equal(state.grant?.active, false);
  done('scoped-sessions.local-lock-erases-authority-locally-and-a');
}

export async function checkRoutineCacheLockDisposesItsDerivedGrant(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { waitStatus, state, done } = h;
  const { owner } = input;
  await approve(owner, 'unlockRoutine');
  await waitStatus(owner, /Quick actions unlocked/);
  await approve(owner, 'startSession');
  await waitStatus(owner, /JubJub session active/);
  await click(owner, '#lock-routine');
  assert.equal(await readSessionState(owner), 'locked');
  assert.equal(state.grant?.active, true, 'local cache lock does not revoke the chain grant');
  await approve(owner, 'revokeSession');
  await waitStatus(owner, /Session grant revoked on chain/);
  done('scoped-sessions.routine-cache-lock-disposes-its-derived-grant');
}

export async function checkCancelledOrSuccessfulRoutineUnlockAndCache(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkReadableSessionScopeDistinguishesDraftSettingsFrom>>,
      'countCredentials'
    >,
) {
  const { waitStatus, state, done } = h;
  const { owner, countCredentials } = input;
  await approve(owner, 'startSession');
  await waitStatus(owner, /JubJub session active/);
  const independentScope = await owner.locator('#session-current-scope').innerText();
  const beforeDeclinedRoutine = await countCredentials();
  await approve(owner, 'unlockRoutine');
  await owner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
  await click(owner, '#ceremony-cancel');
  await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
  assert.equal(await countCredentials(), beforeDeclinedRoutine);
  assert.equal(await readSessionState(owner), 'active');
  await approve(owner, 'unlockRoutine');
  await waitStatus(owner, /Quick actions unlocked/);
  assert.equal(await readSessionState(owner), 'active');
  await click(owner, '#lock-routine');
  assert.equal(await readSessionState(owner), 'active');
  assert.equal(await owner.locator('#session-current-scope').innerText(), independentScope);
  assert.equal(state.grant?.active, true);
  done('scoped-sessions.cancelled-or-successful-routine-unlock-and-cache');
}

export async function checkPagehideReloadRetainsPublicGrantMetadataWithout(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { archiveObservations, arm, waitStatus, done } = h;
  const { owner } = input;
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
    .waitFor({ state: 'attached' });
  await observeCredentialAccess(owner);
  assert.match(await readSessionState(owner), /locked/);
  await approve(owner, 'open');
  await waitStatus(owner, /opened/);
  await approve(owner, 'revokeSession');
  await waitStatus(owner, /Session grant revoked on chain/);
  done('scoped-sessions.pagehide-reload-retains-public-grant-metadata-without');
}

export async function checkAbsoluteSessionExpiryDisposesTheSignerAnd(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<Awaited<ReturnType<typeof checkAccountFormsPreserveTheirValuesAcrossTabs>>, 'recipient'>,
) {
  const { waitStatus, done } = h;
  const { owner, recipient } = input;
  await fill(owner, '#withdraw-recipient', recipient);
  await fill(owner, '#withdraw-amount', '1');
  await approve(owner, 'startSession');
  await waitStatus(owner, /JubJub session active/);
  await owner.evaluate(() => {
    (
      window as typeof window & {
        __sessionClockOffset: number;
      }
    ).__sessionClockOffset = 16 * 60000;
  });
  await owner.waitForFunction(
    () =>
      (
        document.getElementById('session-state') ??
        (() => {
          throw new Error('Missing journey fixture value');
        })()
      ).dataset.status === 'expired',
  );
  await owner.evaluate(() => {
    (
      window as typeof window & {
        __sessionClockOffset: number;
      }
    ).__sessionClockOffset = 0;
  });
  await approve(owner, 'revokeSession');
  await waitStatus(owner, /Session grant revoked on chain/);
  done('scoped-sessions.absolute-session-expiry-disposes-the-signer-and');
}

export async function checkLostSessionAcknowledgementIsAnUnknownOutcome(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { waitStatus, done } = h;
  const { owner } = input;
  await approve(owner, 'startSession');
  await waitStatus(owner, /JubJub session active/);
  h.flags.unknownSession = true;
  await approve(owner, 'withdraw');
  await waitStatus(owner, /failed\./, /Synthetic session outcome unknown/);
  assert.equal(await owner.locator('.operation-status').getAttribute('data-phase'), 'unknown');
  assert.equal(await owner.locator('#progress').getAttribute('aria-valuenow'), null);
  assert.match(
    await owner.locator('#activity-toggle').innerText(),
    /Needs attention|Hide Activity/,
  );
  await navClick(owner, '#nav-audit');
  assert.match(await owner.locator('#activity-toggle').innerText(), /Needs attention/);
  assert.equal(await owner.locator('#operation-safety-notice').isVisible(), false);
  await owner.locator('#activity-toggle').click();
  assert.equal(await owner.locator('#operation-safety-notice').isVisible(), true);
  await readSessionState(owner);
  const unknownSessionIntent = await owner.locator('#session-state').getAttribute('data-intent-id');
  assert.ok(unknownSessionIntent);
  assert.ok(
    (await owner.locator('.activity-references').textContent())?.includes(unknownSessionIntent),
  );
  assert.ok(
    (await owner.locator('#operation-safety-notice').textContent())?.includes(unknownSessionIntent),
  );
  done('scoped-sessions.lost-session-acknowledgement-is-an-unknown-outcome');
}

export async function checkStaleTabCannotBypassOrEraseAn(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkReadableSessionScopeDistinguishesDraftSettingsFrom>>,
    'staleTab'
  >,
) {
  const { calls, waitStatus, done } = h;
  const { staleTab } = input;
  const sendsAfterUnknown = calls.filter((c) => c === 'spend' || c === 'withdraw').length;
  h.flags.unknownSession = false;
  const stalePrompts = await staleTab.evaluate(
    () =>
      (
        window as typeof window & {
          __passportPurposeObservations: unknown[];
        }
      ).__passportPurposeObservations.length,
  );
  await approve(staleTab, 'withdraw');
  await waitStatus(staleTab, /failed\./, /Reconcile the original session transaction/);
  await click(staleTab, '#endSession');
  await waitStatus(staleTab, /Local session locked/);
  assert.equal(calls.filter((c) => c === 'spend' || c === 'withdraw').length, sendsAfterUnknown);
  assert.equal(
    await staleTab.evaluate(
      () =>
        (
          window as typeof window & {
            __passportPurposeObservations: unknown[];
          }
        ).__passportPurposeObservations.length,
    ),
    stalePrompts,
  );
  done('scoped-sessions.stale-tab-cannot-bypass-or-erase-an');
  return { sendsAfterUnknown };
}

export async function checkLostSessionSpendAcknowledgementBlocksRetryAnd(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<Awaited<ReturnType<typeof checkStaleTabCannotBypassOrEraseAn>>, 'sendsAfterUnknown'> &
    Pick<Awaited<ReturnType<typeof checkAccountFormsPreserveTheirValuesAcrossTabs>>, 'recipient'>,
) {
  const { waitStatus, calls, archiveObservations, arm, done } = h;
  const { owner, sendsAfterUnknown, recipient } = input;
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
    .waitFor({ state: 'attached' });
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
  done('scoped-sessions.lost-session-spend-acknowledgement-blocks-retry-and');
}

export async function checkUncertainRevocationIsNeverReplayedAndRemains(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkAccountFormsPreserveTheirValuesAcrossTabs>>,
    'recipient'
  >,
) {
  const { newPage, waitStatus, calls, archiveObservations, arm, done } = h;
  const { recipient } = input;
  const revoker = await newPage();
  await approve(revoker, 'create');
  await waitStatus(revoker, /created/);
  await fill(revoker, '#withdraw-recipient', recipient);
  await approve(revoker, 'startSession');
  await waitStatus(revoker, /JubJub session active/);
  const revokeCalls = calls.filter((c) => c === 'revoke').length;
  h.flags.unknownRevocation = true;
  await approve(revoker, 'revokeSession');
  await waitStatus(revoker, /failed\./, /Synthetic fixture refusal/);
  h.flags.unknownRevocation = false;
  await approve(revoker, 'revokeSession');
  await waitStatus(revoker, /failed\./, /Reconcile/);
  await archiveObservations(revoker, arm);
  await revoker.reload();
  await revoker
    .locator('#status')
    .filter({ hasText: /^Ready\./ })
    .waitFor({ state: 'attached' });
  await observeCredentialAccess(revoker);
  await approve(revoker, 'open');
  await waitStatus(revoker, /opened/);
  await approve(revoker, 'revokeSession');
  await waitStatus(revoker, /failed\./, /Reconcile/);
  assert.equal(calls.filter((c) => c === 'revoke').length, revokeCalls + 1);
  done('scoped-sessions.uncertain-revocation-is-never-replayed-and-remains');
}
