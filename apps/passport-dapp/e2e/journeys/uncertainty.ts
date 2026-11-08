import assert from 'node:assert/strict';
import type { JourneyHarness } from './types.js';

import { click, navClick, approve, reveal } from './ui.js';

import type { checkSignedOutLandingHidesWorkspaceNavigationAnd } from './presentation.js';
export async function checkUnknownDepositIDsSurviveNavigationWithNo(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { waitStatus, fundingIds, done } = h;
  const { owner } = input;
  h.flags.unknownFunding = true;
  await click(owner, '#fund');
  await waitStatus(owner, /failed\./, /Synthetic funding outcome unknown/);
  const original =
    fundingIds.at(-1) ??
    (() => {
      throw new Error('Missing journey fixture value');
    })();
  assert.equal(await owner.locator('.operation-status').getAttribute('data-phase'), 'unknown');
  assert.equal(await owner.locator('#progress').getAttribute('aria-valuenow'), null);
  assert.match(await owner.locator('#progress-label').innerText(), /not confirmed/);
  assert.match(
    (await owner.locator('#log .run').first().locator('.run-meta').textContent()) ?? '',
    /Outcome unknown/,
  );
  assert.match(
    (await owner.locator('.activity-references').textContent()) ?? '',
    new RegExp(original),
  );
  const beforeUnknownNavigation = fundingIds.length;
  for (const view of ['audit', 'settings', 'account']) await navClick(owner, `#nav-${view}`);
  assert.equal(
    fundingIds.length,
    beforeUnknownNavigation,
    'navigation never retries an unknown deposit',
  );
  assert.match(
    (await owner.locator('.activity-references').textContent()) ?? '',
    new RegExp(original),
  );
  done('account-actions.unknown-deposit-ids-survive-navigation-with-no');
  return { original };
}

export async function checkUncertainFundingRetainsTheOriginalRequestID(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<Awaited<ReturnType<typeof checkUnknownDepositIDsSurviveNavigationWithNo>>, 'original'>,
) {
  const { waitStatus, fundingIds, done } = h;
  const { owner, original } = input;
  await click(owner, '#fund');
  await waitStatus(owner, /failed\./, /Synthetic funding outcome unknown/);
  assert.equal(fundingIds.at(-1), original);
  assert.equal(fundingIds.filter((id) => id === original).length, 2);
  h.flags.unknownFunding = false;
  done('account-actions.uncertain-funding-retains-the-original-request-id');
}

export async function checkUncertainWithdrawalIsNotAutomaticallyReplayed(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { waitStatus, calls, done } = h;
  const { owner } = input;
  h.flags.unknownWithdrawal = true;
  await approve(owner, 'withdraw');
  await waitStatus(owner, /failed\./, /Synthetic fixture refusal/);
  await owner.waitForTimeout(100);
  assert.equal(calls.filter((c) => c === 'withdraw-unknown').length, 1);
  h.flags.unknownWithdrawal = false;
  done('account-actions.uncertain-withdrawal-is-not-automatically-replayed');
}

export async function checkBalanceServiceOutageLabelsPriorSnapshotsWithout(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { waitStatus, done } = h;
  const { owner } = input;
  h.flags.serviceUnavailable = true;
  await click(owner, '#refresh');
  await waitStatus(owner, /refreshed|unavailable|failed/i);
  await reveal(owner, '#account-facts');
  assert.match(await owner.locator('#account-facts').innerText(), /Latest refresh unavailable/);
  done('account-actions.balance-service-outage-labels-prior-snapshots-without');
}
