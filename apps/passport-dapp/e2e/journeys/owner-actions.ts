import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import type { JourneyHarness } from './types.js';

import { approve, click, fill, check } from './ui.js';
import { target } from './constants.js';

import type { checkPrepareJoinerRejectMalformedHandoffEnrollOpen } from './grants.js';
import type { checkAccountFormsPreserveTheirValuesAcrossTabs } from './value.js';
export async function checkFullOwnerEnrollmentIsExplicitDecliningCreates(h: JourneyHarness) {
  const { newPage, waitStatus, calls, arm, done } = h;

  const fullOwner = await newPage();
  await approve(fullOwner, 'create');
  await waitStatus(fullOwner, /created/);
  const ownerCredentials = () =>
    fullOwner.evaluate(
      () =>
        (
          window as typeof window & {
            __passportPurposeObservations: unknown[];
          }
        ).__passportPurposeObservations.length,
    );
  const initialEnrollments = calls.filter((c) => c === 'enroll-owner').length;
  if (arm === 'p256') {
    h.flags.rejectNextDialog = true;
    await approve(fullOwner, 'unlockOwner');
    await waitStatus(fullOwner, /failed\./, /Owner enrollment declined/);
    assert.equal(calls.filter((c) => c === 'enroll-owner').length, initialEnrollments);
    done('owner-safety.full-owner-enrollment-is-explicit-declining-creates');
  }
  return { fullOwner, initialEnrollments, ownerCredentials };
}

export async function checkAuthenticatedOwnerPublicKeyDisclosureFitsThe(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
    'fullOwner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
      'initialEnrollments'
    >,
) {
  const { waitStatus, calls, arm, done } = h;
  const { fullOwner, initialEnrollments } = input;
  await approve(fullOwner, 'unlockOwner');
  await waitStatus(fullOwner, /Account unlocked/);
  const publicOwner = await fullOwner.locator('#authenticated-owner-key').textContent();
  assert.match(
    publicOwner ??
      (() => {
        throw new Error('Missing journey fixture value');
      })(),
    /^[0-9a-f]{64}$/,
  );
  assert.equal(
    calls.filter((c) => c === 'enroll-owner').length,
    initialEnrollments + (arm === 'p256' ? 1 : 0),
  );
  await fullOwner.setViewportSize({ width: 390, height: 844 });
  await fullOwner.locator('#authenticated-owner-key').locator('..').locator('summary').click();
  assert.ok(await fullOwner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS)
    await fullOwner.screenshot({
      path: resolve(
        process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS,
        `${arm}-authenticated-owner-mobile.png`,
      ),
      fullPage: true,
    });
  await fullOwner.locator('#authenticated-owner-key').locator('..').locator('summary').click();
  await fullOwner.setViewportSize({ width: 1280, height: 900 });
  done('owner-safety.authenticated-owner-public-key-disclosure-fits-the');
  return { publicOwner };
}

export async function checkAuthenticatedOwnerHoldingsAndBuiltInWallet(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
    'fullOwner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
      'ownerCredentials'
    >,
) {
  const { waitStatus, done } = h;
  const { fullOwner, ownerCredentials } = input;
  assert.match(
    (await fullOwner.locator('#routine-status').textContent()) ??
      (() => {
        throw new Error('Missing journey fixture value');
      })(),
    /Critical owner actions require fresh passkey approval/,
  );
  const ownerDialogs: string[] = [];
  fullOwner.on('dialog', (dialog) => ownerDialogs.push(dialog.message()));
  const authenticatedCredentials = await ownerCredentials();
  const approveFreshOwnerCeremony = async () => {
    await fullOwner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
    assert.equal(
      await fullOwner.locator('#ceremony-purpose').getAttribute('data-purpose'),
      'derive-keys',
    );
    await click(fullOwner, '#ceremony-continue');
  };
  const ownerExactReviews: string[] = [];
  const criticalOwnerAction = async (action: string, expected: RegExp) => {
    const before = await ownerCredentials();
    await approve(
      fullOwner,
      action,
      action === 'withdraw'
        ? async () => {
            ownerExactReviews.push(
              (await fullOwner.locator('#ceremony-details').textContent()) ?? '',
            );
          }
        : undefined,
    );
    await waitStatus(fullOwner, expected);
    assert.equal(
      await ownerCredentials(),
      before + 1,
      `${action} requires exactly one fresh owner approval while retaining the JubJub signer`,
    );
  };
  await approve(fullOwner, 'holdings');
  await waitStatus(fullOwner, /Verified 1 shielded/);
  await approve(fullOwner, 'wallet');
  await waitStatus(fullOwner, /wallet connected through/);
  assert.equal(await ownerCredentials(), authenticatedCredentials);
  done('owner-safety.authenticated-owner-holdings-and-built-in-wallet');
  return {
    authenticatedCredentials,
    criticalOwnerAction,
    ownerDialogs,
    ownerExactReviews,
    approveFreshOwnerCeremony,
  };
}

export async function checkDecliningFreshCriticalApprovalWhileAnOwner(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
    'fullOwner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
      'ownerCredentials'
    > &
    Pick<
      Awaited<ReturnType<typeof checkAuthenticatedOwnerHoldingsAndBuiltInWallet>>,
      'authenticatedCredentials'
    >,
) {
  const { calls, waitStatus, done } = h;
  const { fullOwner, ownerCredentials, authenticatedCredentials } = input;
  const rotationsBeforeDeclinedFresh = calls.filter((call) => call === 'rotate').length;
  await approve(fullOwner, 'rotate');
  await fullOwner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
  assert.equal(
    await fullOwner.locator('#ceremony-purpose').getAttribute('data-purpose'),
    'derive-keys',
  );
  await click(fullOwner, '#ceremony-cancel');
  await waitStatus(fullOwner, /UserCancelled/, /passkey request was declined/);
  assert.equal(await ownerCredentials(), authenticatedCredentials);
  assert.equal(calls.filter((call) => call === 'rotate').length, rotationsBeforeDeclinedFresh);
  done('owner-safety.declining-fresh-critical-approval-while-an-owner');
}

export async function checkMatchingBoundedWithdrawalStaysPasskeyFreeEven(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkAuthenticatedOwnerHoldingsAndBuiltInWallet>>,
    'criticalOwnerAction'
  > &
    Pick<
      Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
      'fullOwner'
    > &
    Pick<
      Awaited<ReturnType<typeof checkPrepareJoinerRejectMalformedHandoffEnrollOpen>>,
      'handoff'
    > &
    Pick<
      Awaited<ReturnType<typeof checkAuthenticatedOwnerPublicKeyDisclosureFitsThe>>,
      'publicOwner'
    > &
    Pick<Awaited<ReturnType<typeof checkAccountFormsPreserveTheirValuesAcrossTabs>>, 'recipient'> &
    Pick<
      Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
      'ownerCredentials'
    >,
) {
  const { state, waitStatus, done } = h;
  const { criticalOwnerAction, fullOwner, handoff, publicOwner, recipient, ownerCredentials } =
    input;
  await criticalOwnerAction('rotate', /confirmed its new sealed/);
  await fill(fullOwner, '#handoff-input', handoff);
  await criticalOwnerAction('enrollDevice', /Joining device confirmed/);
  await fill(fullOwner, '#remove-commitment', target);
  await criticalOwnerAction('removeDevice', /selected entry is absent/i);
  await fill(
    fullOwner,
    '#grant-grantee',
    publicOwner ??
      (() => {
        throw new Error('Missing journey fixture value');
      })(),
  );
  await fill(fullOwner, '#grant-recipient', recipient);
  await fill(fullOwner, '#grant-per-call', '1');
  await fill(fullOwner, '#grant-cap', '2');
  await criticalOwnerAction('issueGrant', /Grant.*confirmed|Grant.*active|Grant.*issued/i);
  await fill(
    fullOwner,
    '#revoke-grant-id',
    (
      state.grant ??
      (() => {
        throw new Error('Missing journey fixture value');
      })()
    ).id,
  );
  await criticalOwnerAction('revokeGrant', /revoked/i);
  await fill(fullOwner, '#withdraw-recipient', recipient);
  await fill(fullOwner, '#withdraw-amount', '1');
  if (state.night < 2) {
    await click(fullOwner, '#fund');
    await waitStatus(fullOwner, /account balance:/);
  }
  await criticalOwnerAction('startSession', /JubJub session active/);
  await check(fullOwner, '#session-use');
  const beforeOwnerBoundedTransfer = await ownerCredentials();
  await approve(fullOwner, 'withdraw');
  await waitStatus(fullOwner, /Withdrawal confirmed/);
  assert.equal(
    await ownerCredentials(),
    beforeOwnerBoundedTransfer,
    'a matching bounded grant transfer does not trigger the cached-owner critical gate',
  );
  done('owner-safety.matching-bounded-withdrawal-stays-passkey-free-even');
}

export async function checkGrantIssueAndRevocationEachRequireOne(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkAuthenticatedOwnerHoldingsAndBuiltInWallet>>,
    'criticalOwnerAction'
  > &
    Pick<
      Awaited<ReturnType<typeof checkAuthenticatedOwnerHoldingsAndBuiltInWallet>>,
      'ownerDialogs'
    >,
) {
  const { done } = h;
  const { criticalOwnerAction, ownerDialogs } = input;
  await criticalOwnerAction('revokeSession', /Session grant revoked on chain/);
  assert.ok(
    ownerDialogs.some((text) =>
      text.includes('Grant issuer: authenticated JubJub owner after fresh passkey approval'),
    ),
  );
  assert.ok(
    ownerDialogs.some(
      (text) =>
        text.includes('Revoke session grant') &&
        text.includes('Authorization: authenticated JubJub owner after fresh passkey approval'),
    ),
  );
  done('owner-safety.grant-issue-and-revocation-each-require-one');
}

export async function checkCachedJubJubOwnerUsesFreshApprovalFor(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkAuthenticatedOwnerHoldingsAndBuiltInWallet>>,
    'criticalOwnerAction'
  > &
    Pick<
      Awaited<ReturnType<typeof checkAuthenticatedOwnerHoldingsAndBuiltInWallet>>,
      'ownerExactReviews'
    > &
    Pick<Awaited<ReturnType<typeof checkAccountFormsPreserveTheirValuesAcrossTabs>>, 'recipient'> &
    Pick<
      Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
      'ownerCredentials'
    > &
    Pick<
      Awaited<ReturnType<typeof checkAuthenticatedOwnerHoldingsAndBuiltInWallet>>,
      'authenticatedCredentials'
    >,
) {
  const { done } = h;
  const {
    criticalOwnerAction,
    ownerExactReviews,
    recipient,
    ownerCredentials,
    authenticatedCredentials,
  } = input;
  await criticalOwnerAction('withdraw', /Withdrawal confirmed/);
  assert.ok(
    ownerExactReviews.some(
      (text) =>
        text.includes('Authorization: JubJub owner after fresh passkey approval') &&
        text.includes('Amount: 1 smallest units') &&
        text.includes(recipient),
    ),
  );
  assert.ok(
    ownerExactReviews.some((text) =>
      text.includes('outside the selected session; owner approval is required'),
    ),
  );
  assert.equal(await ownerCredentials(), authenticatedCredentials + 8);
  done('owner-safety.cached-jubjub-owner-uses-fresh-approval-for');
}

export async function checkExpiredFullOwnerApprovalCannotFallBack(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
    'ownerCredentials'
  > &
    Pick<
      Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
      'fullOwner'
    >,
) {
  const { calls, waitStatus, done } = h;
  const { ownerCredentials, fullOwner } = input;
  const afterCriticalOperations = await ownerCredentials();
  const rotationsBeforeExpiry = calls.filter((c) => c === 'rotate').length;
  await click(fullOwner, '#rotate');
  await fullOwner.locator('#ceremony-dialog').waitFor({ state: 'visible' });
  await fullOwner.evaluate(() => {
    (
      window as typeof window & {
        __sessionClockOffset: number;
      }
    ).__sessionClockOffset = 31 * 60000;
  });
  await click(fullOwner, '#ceremony-continue');
  await waitStatus(fullOwner, /failed\./, /locked or expired/);
  await fullOwner.evaluate(() => {
    (
      window as typeof window & {
        __sessionClockOffset: number;
      }
    ).__sessionClockOffset = 0;
  });
  assert.equal(calls.filter((c) => c === 'rotate').length, rotationsBeforeExpiry);
  assert.equal(await ownerCredentials(), afterCriticalOperations);
  done('owner-safety.expired-full-owner-approval-cannot-fall-back');
  return { afterCriticalOperations };
}

export async function checkReauthenticationRestoresTheSameOwnerWithoutEnrollment(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
    'fullOwner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkAuthenticatedOwnerPublicKeyDisclosureFitsThe>>,
      'publicOwner'
    > &
    Pick<
      Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
      'ownerCredentials'
    > &
    Pick<
      Awaited<ReturnType<typeof checkExpiredFullOwnerApprovalCannotFallBack>>,
      'afterCriticalOperations'
    >,
) {
  const { calls, waitStatus, done } = h;
  const { fullOwner, publicOwner, ownerCredentials, afterCriticalOperations } = input;
  const enrollmentsAfterFirstUnlock = calls.filter((c) => c === 'enroll-owner').length;
  await approve(fullOwner, 'unlockOwner');
  await waitStatus(fullOwner, /Account unlocked/);
  assert.equal(await fullOwner.locator('#authenticated-owner-key').textContent(), publicOwner);
  assert.equal(calls.filter((c) => c === 'enroll-owner').length, enrollmentsAfterFirstUnlock);
  assert.equal(
    await ownerCredentials(),
    afterCriticalOperations + 1,
    'reauthentication needs only the pinned PRF unlock, not enrollment',
  );
  await click(fullOwner, '#lock-routine');
  await approve(fullOwner, 'rotate');
  await waitStatus(fullOwner, /confirmed its new sealed/);
  assert.ok((await ownerCredentials()) > afterCriticalOperations + 1);
  done('owner-safety.reauthentication-restores-the-same-owner-without-enrollment');
}
