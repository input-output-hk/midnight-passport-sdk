import assert from 'node:assert/strict';
import type { JourneyHarness } from './types.js';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { fill, approve, click, select, check } from './ui.js';
import { address, target, grantId } from './constants.js';

import type { checkSignedOutLandingHidesWorkspaceNavigationAnd } from './presentation.js';
import type { checkAccountFormsPreserveTheirValuesAcrossTabs } from './value.js';
import type { checkEscapeOnTheFirstCeremonyRefusesCredential } from './ceremonies.js';
export async function checkPrepareJoinerRejectMalformedHandoffEnrollOpen(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { newPage, waitStatus, calls, state, done } = h;
  const { owner } = input;
  const joiner = await newPage();
  await fill(joiner, '#open-address', address);
  await approve(joiner, 'prepareJoiner');
  await waitStatus(joiner, /handoff|fingerprint|public keys/i);
  const handoff = await joiner.locator('#handoff-output').inputValue();
  await fill(owner, '#handoff-input', '{}');
  const enrollments = calls.filter((c) => c === 'enroll').length;
  await approve(owner, 'enrollDevice');
  await waitStatus(owner, /failed\./, /handoff does not match|joining-device JSON/i);
  assert.equal(calls.filter((c) => c === 'enroll').length, enrollments);
  await fill(owner, '#handoff-input', handoff);
  h.flags.staleOwnerReads = true;
  await approve(owner, 'enrollDevice');
  await waitStatus(owner, /failed\./, /ACC roster changed while preparing enrollment/);
  assert.equal(calls.filter((c) => c === 'enroll').length, enrollments);
  h.flags.staleOwnerReads = false;
  await approve(owner, 'enrollDevice');
  await waitStatus(owner, /Joining device confirmed/);
  await approve(joiner, 'openAt');
  await waitStatus(joiner, /opened by address/);
  await fill(owner, '#remove-commitment', target);
  await approve(owner, 'removeDevice');
  await waitStatus(owner, /entry is absent/);
  assert.equal(state.entries.length, 1);
  done('account-actions.prepare-joiner-reject-malformed-handoff-enroll-open');
  return { handoff };
}

export async function checkGrantReviewAndSubmissionRetainTheAdmitted(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<Awaited<ReturnType<typeof checkAccountFormsPreserveTheirValuesAcrossTabs>>, 'recipient'> &
    Pick<
      Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
      'credentialsUsed'
    >,
) {
  const { newPage, waitStatus, calls, state, done } = h;
  const { owner, recipient, credentialsUsed } = input;
  const holder = await newPage();
  await fill(holder, '#open-address', address);
  await approve(holder, 'prepareGrantee');
  await waitStatus(holder, /Public grantee key ready/);
  await fill(owner, '#grant-grantee', await holder.locator('#grantee-output').inputValue());
  await fill(owner, '#grant-recipient', recipient);
  await fill(owner, '#grant-per-call', '1');
  await fill(owner, '#grant-cap', '2');
  const issuesBeforeDecline = calls.filter((c) => c === 'issue').length;
  const credentialsBeforeGrantDecline = await credentialsUsed();
  h.flags.rejectNextDialog = true;
  await approve(owner, 'issueGrant');
  await waitStatus(owner, /Grant issue cancelled before signing/);
  assert.equal(await owner.locator('.operation-status').getAttribute('data-phase'), 'cancelled');
  assert.equal(await owner.locator('#progress').getAttribute('aria-valuenow'), null);
  assert.equal(calls.filter((c) => c === 'issue').length, issuesBeforeDecline);
  assert.equal(await credentialsUsed(), credentialsBeforeGrantDecline);
  const changedRecipient = MidnightBech32m.encode(
    'undeployed',
    new UnshieldedAddress(Buffer.alloc(32, 83)),
  ).asString();
  let issueReview = '';
  const captureIssueReview = (dialog: import('playwright-core').Dialog) => {
    issueReview = dialog.message();
  };
  owner.on('dialog', captureIssueReview);
  // Change the form while the public roster read is pending, after admission.
  // This lives only in the owned test page; production code receives no test hooks.
  await owner.evaluate(`(() => {
        const original = window.fetch;
        window.fetch = async (...args) => {
          const response = await original(...args);
          const body = args[1]?.body;
          if (args[0] === '/__demo-fixture' && typeof body === 'string' &&
              JSON.parse(body).action === 'state') {
            window.fetch = original;
            document.getElementById('grant-recipient').value = ${JSON.stringify(changedRecipient)};
          }
          return response;
        };
      })()`);
  await approve(owner, 'issueGrant');
  await waitStatus(owner, /Grant .*active|grant.*issued/i);
  owner.off('dialog', captureIssueReview);
  assert.ok(issueReview.includes(recipient), 'review retains the originally admitted address');
  assert.ok(!issueReview.includes(changedRecipient), 'a changed form is not the approved intent');
  assert.equal(await owner.locator('#grant-recipient').inputValue(), changedRecipient);
  assert.equal(
    (
      state.grant?.scope.recipient as
        | {
            value?: string;
          }
        | undefined
    )?.value,
    MidnightBech32m.parse(recipient).decode(UnshieldedAddress, 'undeployed').hexString,
  );
  done('account-actions.grant-review-and-submission-retain-the-admitted');
  return { holder };
}

export async function checkIndependentGranteeSpendIdentifiesAndDerivesIts(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
      'credentialsUsed'
    > &
    Pick<Awaited<ReturnType<typeof checkGrantReviewAndSubmissionRetainTheAdmitted>>, 'holder'>,
) {
  const { waitStatus, calls, done } = h;
  const { owner, credentialsUsed, holder } = input;
  await fill(owner, '#export-grant-id', grantId);
  const beforeDeclinedExport = await credentialsUsed();
  await approve(owner, 'exportGrant', async () => {
    assert.ok((await owner.locator('#ceremony-details').textContent())?.includes(grantId));
    await click(owner, '#ceremony-cancel');
  });
  await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
  assert.equal(await credentialsUsed(), beforeDeclinedExport);
  assert.equal(await owner.locator('#grant-opening-output').inputValue(), '');
  assert.equal(await owner.locator('.operation-status').getAttribute('data-phase'), 'cancelled');
  await approve(owner, 'exportGrant');
  await waitStatus(owner, /Opening ready/);
  await fill(
    holder,
    '#grant-opening-input',
    await owner.locator('#grant-opening-output').inputValue(),
  );
  await fill(holder, '#grant-spend-amount', '1');
  await fill(holder, '#grant-spent-prev', '0');
  const beforeDeclinedSpend = calls.filter((c) => c === 'spend').length;
  h.flags.rejectNextDialog = true;
  await approve(holder, 'spendGrant');
  await waitStatus(holder, /failed\./, /Spend declined/);
  assert.equal(h.flags.rejectNextDialog, false, 'the exact grant spend review must have appeared');
  assert.equal(calls.filter((c) => c === 'spend').length, beforeDeclinedSpend);
  const holderCredentials = () =>
    holder.evaluate(
      () =>
        (
          window as typeof window & {
            __passportPurposeObservations: unknown[];
          }
        ).__passportPurposeObservations.length,
    );
  const beforeHolderSpend = await holderCredentials();
  await approve(holder, 'spendGrant');
  await waitStatus(holder, /Grant spend .*confirmed/);
  assert.equal(await holderCredentials(), beforeHolderSpend + 1);
  done('account-actions.independent-grantee-spend-identifies-and-derives-its');
}

export async function checkSubmittedGrantSpendWithUnsettledRosterPreserves(
  h: JourneyHarness,
  input: Pick<Awaited<ReturnType<typeof checkGrantReviewAndSubmissionRetainTheAdmitted>>, 'holder'>,
) {
  const { waitStatus, state, done } = h;
  const { holder } = input;
  await fill(holder, '#grant-spent-prev', '1');
  h.flags.unsettledGrantSpend = true;
  await approve(holder, 'spendGrant');
  await waitStatus(holder, /failed\./, /submitted/);
  h.flags.unsettledGrantSpend = false;
  assert.equal(await holder.locator('.operation-status').getAttribute('data-phase'), 'unknown');
  assert.match(await holder.locator('.operation-status').innerText(), new RegExp(state.txHash));
  await click(holder, '#nav-audit');
  assert.match(
    await holder.locator('#log .run').first().locator('.run-meta').innerText(),
    /Outcome unknown/,
  );
  done('account-actions.submitted-grant-spend-with-unsettled-roster-preserves');
}

export async function checkDecliningExactIssueExportAndRevokeReviews(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { calls, waitStatus, state, done } = h;
  const { owner } = input;
  await fill(owner, '#revoke-grant-id', grantId);
  const revocationsBeforeDecline = calls.filter((c) => c === 'revoke').length;
  h.flags.rejectNextDialog = true;
  await approve(owner, 'revokeGrant');
  await waitStatus(owner, /Grant revocation cancelled before signing/);
  assert.equal(await owner.locator('.operation-status').getAttribute('data-phase'), 'cancelled');
  assert.equal(calls.filter((c) => c === 'revoke').length, revocationsBeforeDecline);
  assert.equal(state.grant?.active, true);
  done('account-actions.declining-exact-issue-export-and-revoke-reviews');
}

export async function checkPrepareHolderIssueExportSpendRevokeRefuse(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<Awaited<ReturnType<typeof checkGrantReviewAndSubmissionRetainTheAdmitted>>, 'holder'>,
) {
  const { waitStatus, state, done } = h;
  const { owner, holder } = input;
  await approve(owner, 'revokeGrant');
  await waitStatus(owner, /is revoked/);
  const balance = state.night;
  await approve(holder, 'spendGrant');
  await waitStatus(holder, /failed\./, /Synthetic grant refused/);
  assert.equal(state.night, balance);
  await approve(owner, 'recoverGrants');
  await waitStatus(owner, /Published 0 pending grants/);
  done('account-actions.prepare-holder-issue-export-spend-revoke-refuse');
}

export async function checkMockNameLookupAbsenceAndInvalidInput(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { calls, done } = h;
  const { owner } = input;
  const beforeInspection = calls.length;
  const recipientBeforeLookup = await owner.locator('#withdraw-recipient').inputValue();
  await click(owner, '#name-service-resolve');
  await owner.locator('#name-service-status').filter({ hasText: 'Mock record found' }).waitFor();
  assert.match(await owner.locator('#name-service-result').innerText(), /"mode": "mock"/);
  assert.match(
    await owner.locator('#name-service-result').innerText(),
    /"networkId": "undeployed"/,
  );
  await fill(owner, '#name-service-name', 'missing.passport.test');
  await click(owner, '#name-service-resolve');
  await owner.locator('#name-service-status').filter({ hasText: 'Name not found' }).waitFor();
  assert.equal(await owner.locator('#name-service-result').innerText(), '');
  await fill(owner, '#name-service-name', 'alice\u202e.passport.test');
  await click(owner, '#name-service-resolve');
  await owner.locator('#name-service-status').filter({ hasText: 'InvalidQuery' }).waitFor();
  assert.equal(await owner.locator('#withdraw-recipient').inputValue(), recipientBeforeLookup);
  assert.equal(calls.length, beforeInspection);
  done('account-actions.mock-name-lookup-absence-and-invalid-input');
  return { beforeInspection };
}

export async function checkCapabilityProofPlanInspectionInvokesNoConnector(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<Awaited<ReturnType<typeof checkMockNameLookupAbsenceAndInvalidInput>>, 'beforeInspection'>,
) {
  const { calls, done } = h;
  const { owner, beforeInspection } = input;
  await select(owner, '#capability-operation', 'withdraw-shielded');
  assert.match(
    await owner.locator('#capability-report').innerText(),
    /Exact-value selected shielded coin only/,
  );
  await select(owner, '#capability-operation', 'issue-grant');
  await check(owner, '#capability-read-grant');
  assert.match(await owner.locator('#capability-report').innerText(), /rotate_enc_key_with_/);
  assert.equal(calls.length, beforeInspection);
  done('account-actions.capability-proof-plan-inspection-invokes-no-connector');
}
