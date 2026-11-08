import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import type { JourneyHarness } from './types.js';

import { fill, approve, reveal, click, navClick, readSessionState } from './ui.js';

import type { checkSignedOutLandingHidesWorkspaceNavigationAnd } from './presentation.js';
import type { checkAccountFormsPreserveTheirValuesAcrossTabs } from './value.js';
export async function checkReadableSessionScopeDistinguishesDraftSettingsFrom(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<Awaited<ReturnType<typeof checkAccountFormsPreserveTheirValuesAcrossTabs>>, 'recipient'>,
) {
  const { newPage, waitStatus, arm, state, calls, done } = h;
  const { owner, recipient } = input;
  h.flags.serviceUnavailable = false;
  await owner.bringToFront();
  await fill(owner, '#withdraw-recipient', recipient);
  await fill(owner, '#withdraw-amount', '1');
  await fill(owner, '#session-cap', '2');
  await fill(owner, '#session-per-call', '1');
  const staleTab = await newPage(owner.context());
  await approve(staleTab, 'open');
  await waitStatus(staleTab, /opened/);
  await fill(staleTab, '#withdraw-recipient', recipient);
  await fill(staleTab, '#withdraw-amount', '1');
  const countCredentials = () =>
    owner.evaluate(
      () =>
        (
          window as typeof window & {
            __passportPurposeObservations: unknown[];
          }
        ).__passportPurposeObservations.length,
    );
  h.flags.rejectNextDialog = true;
  await approve(owner, 'startSession');
  await waitStatus(owner, /authorization declined before passkey/);
  assert.equal(await owner.locator('.operation-status').getAttribute('data-phase'), 'cancelled');
  await owner.bringToFront();
  await approve(owner, 'unlockRoutine');
  await waitStatus(owner, /Quick actions unlocked/);
  const beforeAuthorize = await countCredentials();
  await approve(owner, 'startSession');
  await waitStatus(owner, /JubJub session active/);
  assert.equal(
    (await countCredentials()) - beforeAuthorize,
    arm === 'p256' ? 3 : 2,
    'the grant child reuses PRF material; owner issue and its journal unlock remain fresh',
  );
  assert.ok(
    (await countCredentials()) > beforeAuthorize,
    'session issue must freshly access the owner passkey',
  );
  assert.equal(state.grant?.scope.expiresAt !== null, true);
  assert.ok(Number(state.grant?.scope.expiresAt) > Date.now() / 1000);
  await reveal(owner, '#session-state');
  assert.match(await owner.locator('#session-state').innerText(), /Ready for quick transfers/);
  assert.match(await owner.locator('#session-current-scope').innerText(), /NIGHT/);
  assert.equal(await owner.locator('#session-state').getAttribute('data-status'), 'active');
  const recordedScope = await owner.locator('#session-current-scope').innerText();
  await click(owner, '#session-edit-target');
  assert.equal(await owner.locator('#account-tab-withdraw').getAttribute('aria-current'), 'page');
  assert.equal(await owner.evaluate(() => document.activeElement?.id), 'withdraw-recipient');
  const credentialsBeforeInspection = await countCredentials();
  const callsBeforeInspection = calls.length;
  await fill(owner, '#withdraw-recipient', recipient + 'draft');
  await reveal(owner, '#session-target-summary');
  assert.match(await owner.locator('#session-target-summary').innerText(), /NIGHT/);
  assert.ok(
    !(await owner.locator('#session-target-summary').innerText()).includes('00'.repeat(32)),
  );
  assert.equal(
    await owner.locator('#session-current-scope').innerText(),
    recordedScope,
    'editing a draft target must not relabel the existing permission',
  );
  await owner.locator('#session-record > summary').click();
  assert.ok((await owner.locator('#session-identifiers').innerText()).includes(recipient));
  assert.ok((await owner.locator('#session-identifiers').innerText()).includes('00'.repeat(32)));
  await owner.locator('#session-record > summary').click();
  await fill(owner, '#withdraw-recipient', recipient);
  await reveal(owner, '#session-minutes');
  await owner.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'session labels, limits and exact values must fit mobile',
  );
  if (process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS && arm === 'p256') {
    const folder = process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS;
    await mkdir(folder, { recursive: true });
    // Capture the actual panel, not an extremely long, expanded Settings page.
    await owner.emulateMedia({ colorScheme: 'dark' });
    await owner
      .locator('#settings-sessions')
      .screenshot({ path: resolve(folder, 'sessions-mobile.png') });
    await owner.setViewportSize({ width: 1440, height: 1000 });
    await owner
      .locator('#settings-sessions')
      .screenshot({ path: resolve(folder, 'sessions-desktop.png') });
    await owner.emulateMedia({ colorScheme: 'light' });
    await owner
      .locator('#settings-sessions')
      .screenshot({ path: resolve(folder, 'sessions-light.png') });
    await owner.emulateMedia({ colorScheme: 'dark' });
  }
  await owner.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await countCredentials(), credentialsBeforeInspection);
  assert.equal(calls.length, callsBeforeInspection);
  done('scoped-sessions.readable-session-scope-distinguishes-draft-settings-from');
  return { countCredentials, staleTab };
}

export async function checkConsentedPRFChildSessionSignsWithoutAnother(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkReadableSessionScopeDistinguishesDraftSettingsFrom>>,
    'countCredentials'
  > &
    Pick<Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>, 'owner'>,
) {
  const { calls, waitStatus, state, done } = h;
  const { countCredentials, owner } = input;
  const beforeSessionSpend = await countCredentials();
  const ownerSendsBefore = calls.filter((c) => c === 'withdraw').length;
  if (await owner.locator('#activity-panel').isVisible())
    await owner.locator('#activity-toggle').click();
  await owner.setViewportSize({ width: 390, height: 844 });
  await approve(owner, 'withdraw');
  await waitStatus(owner, /Withdrawal confirmed/);
  assert.equal(
    await countCredentials(),
    beforeSessionSpend,
    'matching session withdrawal uses no credential API',
  );
  assert.equal(
    calls.filter((c) => c === 'withdraw').length,
    ownerSendsBefore,
    'session uses holder circuit, not owner path',
  );
  assert.equal(state.grant?.spent, 1);
  assert.equal(
    await owner.locator('#activity-sheet').evaluate((e) => (e as HTMLDialogElement).open),
    true,
  );
  assert.match(await owner.locator('#activity-sheet .operation-status').innerText(), /Completed/);
  await owner.locator('#activity-close').click();
  await owner.setViewportSize({ width: 1280, height: 900 });
  done('scoped-sessions.consented-prf-child-session-signs-without-another');
}

export async function checkCriticalOwnerRotationCannotReuseTheCached(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkReadableSessionScopeDistinguishesDraftSettingsFrom>>,
    'countCredentials'
  > &
    Pick<Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>, 'owner'>,
) {
  const { waitStatus, done } = h;
  const { countCredentials, owner } = input;
  const beforeCritical = await countCredentials();
  await approve(owner, 'rotate');
  await waitStatus(owner, /confirmed its new sealed viewing secret/);
  assert.ok(
    (await countCredentials()) > beforeCritical,
    'critical rotation requires a fresh passkey despite an active session',
  );
  done('scoped-sessions.critical-owner-rotation-cannot-reuse-the-cached');
}

export async function checkRealBrowserWebLocksRefuseASecond(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkReadableSessionScopeDistinguishesDraftSettingsFrom>>,
      'staleTab'
    >,
) {
  const { calls, waitStatus, done } = h;
  const { owner, staleTab } = input;
  let releaseHeldSpend: () => void = () => {
    throw Error('Uninitialized fixture gate');
  };
  let observeHeldSpend: () => void = () => {
    throw Error('Uninitialized fixture gate');
  };
  const heldSpend = new Promise<void>((r) => {
    releaseHeldSpend = r;
  });
  const spendObserved = new Promise<void>((r) => {
    observeHeldSpend = r;
  });
  h.flags.holdSessionSpend = () => {
    observeHeldSpend();
    return heldSpend;
  };
  await approve(owner, 'withdraw');
  await spendObserved;
  const sendsBeforeConcurrent = calls.filter((c) => c === 'withdraw' || c === 'spend').length;
  await staleTab.bringToFront();
  await click(staleTab, '#withdraw');
  await waitStatus(staleTab, /failed\./, /Another Passport tab is handling an operation/);
  assert.equal(
    calls.filter((c) => c === 'withdraw' || c === 'spend').length,
    sendsBeforeConcurrent,
  );
  await owner.bringToFront();
  done('scoped-sessions.real-browser-web-locks-refuse-a-second');
  return { sendsBeforeConcurrent, releaseHeldSpend };
}

export async function checkWorkspaceAccountTabNavigationDuringAPending(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkRealBrowserWebLocksRefuseASecond>>,
      'sendsBeforeConcurrent'
    >,
) {
  const { calls, done } = h;
  const { owner, sendsBeforeConcurrent } = input;
  for (const view of ['audit', 'wallet', 'settings', 'account'])
    await navClick(owner, `#nav-${view}`);
  for (const tab of ['balances', 'deposit', 'withdraw'])
    await navClick(owner, `#account-tab-${tab}`);
  assert.equal(await owner.locator('#withdraw').isEnabled(), false);
  assert.equal(
    calls.filter((c) => c === 'withdraw' || c === 'spend').length,
    sendsBeforeConcurrent,
  );
  assert.equal(await owner.locator('.operation-status').getAttribute('data-phase'), 'running');
  done('scoped-sessions.workspace-account-tab-navigation-during-a-pending');
}

export async function checkImmediateLockDuringSettlementRetainsAConfirmed(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<Awaited<ReturnType<typeof checkRealBrowserWebLocksRefuseASecond>>, 'releaseHeldSpend'>,
) {
  const { waitStatus, done } = h;
  const { owner, releaseHeldSpend } = input;
  assert.ok(
    await owner.locator('#endSession').isEnabled(),
    'explicit lock is available while an operation is running',
  );
  await click(owner, '#endSession');
  assert.match(await readSessionState(owner), /blocked/);
  releaseHeldSpend();
  await waitStatus(owner, /Withdrawal confirmed/);
  h.flags.holdSessionSpend = undefined;
  assert.match(await readSessionState(owner), /locked/);
  assert.match(await owner.locator('#session-current-scope').innerText(), /2 \/ 2 smallest units/);
  done('scoped-sessions.immediate-lock-during-settlement-retains-a-confirmed');
}
