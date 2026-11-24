import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import type { JourneyHarness } from './types.js';
import { click, navClick, approve, select, observeCredentialAccess } from './ui.js';
import { address, night } from './constants.js';

const custom = 'cd'.repeat(32);
const key = (color: string) => `passport-demo:fund:undeployed:${address}:${color}`;
async function ready(page: Page) {
  await page.waitForFunction(() => {
    const button = document.querySelector<HTMLButtonElement>('#fund');
    return (
      button &&
      !button.disabled &&
      document.querySelector('#funding-read-status')?.textContent === ''
    );
  });
}
const credentials = (page: Page) =>
  page.evaluate(
    () =>
      (window as typeof window & { __passportPurposeObservations?: unknown[] })
        .__passportPurposeObservations?.length ?? 0,
  );

async function dismissActivity(page: Page) {
  if (await page.locator('#activity-close').isVisible())
    await page.locator('#activity-close').click();
}
async function refreshAvailability(page: Page) {
  await dismissActivity(page);
  await click(page, '#refresh-funding');
}

async function repeatedDeposits(h: JourneyHarness, page: Page, color: string) {
  await select(page, '#fund-asset', color);
  const prior = color === night ? h.state.night : (h.state.tokens?.[color] ?? 0);
  const other = h.state.night;
  const count = h.fundingIds.length,
    prompts = await credentials(page);
  for (let i = 0; i < 2; i++) {
    let resume = () => {};
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    h.flags.holdFundingRead = () => gate;
    h.flags.unavailableAfterDeposit = 1;
    try {
      await click(page, '#fund');
      await h.waitStatus(page, /Passport account balance:/);
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLSelectElement>('#fund-asset')?.selectedOptions[0]?.disabled,
      );
      assert.equal(await page.locator('#fund').isDisabled(), true);
      assert.equal(await page.locator('#refresh-funding').isEnabled(), true);
      assert.equal(await page.locator('#fund-asset').inputValue(), color);
      assert.equal(h.fundingIds.length, count + i + 1, 'catch-up must never resend the deposit');
      assert.equal(
        await page.evaluate((storageKey) => localStorage.getItem(storageKey), key(color)),
        null,
      );
      resume();
      await ready(page);
      assert.equal(await page.locator('#fund-asset').inputValue(), color);
    } finally {
      resume();
      delete h.flags.holdFundingRead;
    }
  }
  assert.notEqual(
    h.fundingIds.at(-1),
    h.fundingIds.at(-2),
    'confirmed deposits are distinct explicit intents',
  );
  assert.equal(color === night ? h.state.night : h.state.tokens?.[color], prior + 20);
  if (color !== night) assert.equal(h.state.night, other, 'custom deposits must not credit NIGHT');
  assert.equal(await credentials(page), prompts, 'funding and catch-up need no passkey');
  h.done(
    color === night
      ? 'account-actions.consecutive-night-deposits-recover-after-wallet-catch-up'
      : 'account-actions.consecutive-custom-deposits-preserve-asset-and-separate-balances',
  );
}

async function exhaustedRecovery(h: JourneyHarness, page: Page) {
  const count = h.fundingIds.length,
    prompts = await credentials(page);
  h.flags.unavailableFundingReads = 10;
  await refreshAvailability(page);
  await h.waitStatus(page, /refreshed/);
  assert.equal(h.flags.unavailableFundingReads, 7, 'only three bounded GET observations');
  assert.equal(await page.locator('#fund').isDisabled(), true);
  assert.match(await page.locator('#funding-read-status').innerText(), /Refresh to check again/);
  assert.equal(await page.locator('#refresh-funding').isEnabled(), true);
  h.flags.unavailableFundingReads = 0;
  await refreshAvailability(page);
  await h.waitStatus(page, /refreshed/);
  await ready(page);
  assert.equal(await page.locator('#fund-asset').inputValue(), custom);
  assert.equal(h.fundingIds.length, count);
  assert.equal(await credentials(page), prompts);
  h.done('account-actions.exhausted-availability-checks-recover-in-place-without-a-transfer');
}

async function failedRead(h: JourneyHarness, page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const count = h.fundingIds.length,
    prompts = await credentials(page);
  h.flags.fundingReadFailure = true;
  await refreshAvailability(page);
  await h.waitStatus(page, /balances unavailable/);
  assert.equal(await page.locator('#fund').isDisabled(), true);
  assert.equal(await page.locator('#fund-asset').inputValue(), custom);
  h.flags.fundingReadFailure = false;
  h.flags.customFundingUnavailable = true;
  await refreshAvailability(page);
  await h.waitStatus(page, /refreshed/);
  assert.equal(await page.locator('#fund-asset').inputValue(), custom);
  assert.equal(await page.locator('#fund').isDisabled(), true);
  assert.equal(await page.locator(`#fund-asset option[value="${night}"]`).isEnabled(), true);
  assert.match(
    await page.locator(`#fund-asset option[value="${custom}"]`).innerText(),
    /insufficient/,
  );
  h.flags.customFundingUnavailable = false;
  await refreshAvailability(page);
  await h.waitStatus(page, /refreshed/);
  await ready(page);
  assert.equal(h.fundingIds.length, count);
  assert.equal(await credentials(page), prompts);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  h.done(
    'account-actions.funding-read-outage-recovers-without-switching-an-insufficient-selection',
  );
}

async function unknownIntent(h: JourneyHarness, page: Page) {
  await dismissActivity(page);
  h.flags.unknownFunding = true;
  await click(page, '#fund');
  await h.waitStatus(page, /failed\./, /outcome unknown/);
  const customOriginal = h.fundingIds.at(-1);
  assert.ok(customOriginal);
  await dismissActivity(page);
  await select(page, '#fund-asset', night);
  await click(page, '#fund');
  await h.waitStatus(page, /failed\./, /outcome unknown/);
  const nightOriginal = h.fundingIds.at(-1),
    count = h.fundingIds.length;
  assert.ok(nightOriginal && nightOriginal !== customOriginal);
  h.flags.unavailableFundingReads = 1;
  await refreshAvailability(page);
  await h.waitStatus(page, /refreshed/);
  await ready(page);
  assert.equal(
    await page.evaluate((storageKey) => localStorage.getItem(storageKey), key(custom)),
    customOriginal,
  );
  assert.equal(
    await page.evaluate((storageKey) => localStorage.getItem(storageKey), key(night)),
    nightOriginal,
  );
  assert.equal(await page.locator(`#fund-asset option[value="${custom}"]`).isEnabled(), true);
  assert.equal(await page.locator(`#fund-asset option[value="${night}"]`).isEnabled(), true);
  await select(page, '#fund-asset', custom);
  assert.match(await page.locator('#fund').innerText(), /Continue funding/);
  await select(page, '#fund-asset', night);
  assert.match(await page.locator('#fund').innerText(), /Continue funding/);
  assert.equal(
    h.fundingIds.length,
    count,
    'switching saved originals never reconciles or replaces an unknown transfer',
  );
  h.done('account-actions.availability-recovery-preserves-the-original-unknown-funding-intent');
}

export async function checkFundingRecovery(h: JourneyHarness) {
  const priorOutage = h.flags.serviceUnavailable;
  h.flags.serviceUnavailable = false;
  h.flags.multipleFundingAssets = true;
  const page = await h.newPage();
  try {
    await approve(page, 'create');
    await h.waitStatus(page, /is created\./);
    await navClick(page, '#account-tab-deposit');
    await ready(page);
    await repeatedDeposits(h, page, night);
    await repeatedDeposits(h, page, custom);
    h.flags.unavailableAfterDeposit = 0;
    await exhaustedRecovery(h, page);
    await failedRead(h, page);
    await unknownIntent(h, page);
  } finally {
    h.flags.serviceUnavailable = priorOutage;
    h.flags.multipleFundingAssets = false;
    h.flags.unavailableAfterDeposit = 0;
    h.flags.unavailableFundingReads = 0;
    h.flags.fundingReadFailure = false;
    h.flags.customFundingUnavailable = false;
    h.flags.unknownFunding = false;
    delete h.flags.holdFundingRead;
    await h.archiveObservations(page, h.arm);
    await page.close();
  }
}

/** A reserved request can outlive the page while proof is still pending. */
export async function checkPendingProofResumesAfterReloadWithoutAnotherPost(h: JourneyHarness) {
  const priorOutage = h.flags.serviceUnavailable;
  h.flags.serviceUnavailable = false;
  const page = await h.newPage();
  const previousBalance = h.state.night;
  const postsBefore = h.fundingIds.length;
  try {
    await approve(page, 'create');
    await h.waitStatus(page, /is created\./);
    await navClick(page, '#account-tab-deposit');
    await ready(page);
    h.flags.asyncFunding = true;
    h.flags.holdFundingProof = true;
    h.flags.pendingFundingStatusReads = 0;
    await click(page, '#fund');
    await page
      .locator('#status')
      .filter({ hasText: /ACC proof started/ })
      .waitFor();
    const original = h.fundingIds.at(-1);
    assert.ok(original && h.heldFunding.has(original));
    assert.equal(h.fundingIds.length, postsBefore + 1);
    assert.equal(h.state.night, previousBalance, 'a pending proof cannot credit the ACC');
    assert.equal(
      await page.evaluate((storageKey) => localStorage.getItem(storageKey), key(night)),
      original,
    );

    await h.archiveObservations(page, h.arm);
    await page.reload();
    await page
      .locator('#status')
      .filter({ hasText: /^Ready\./ })
      .waitFor({ state: 'attached' });
    await observeCredentialAccess(page);
    await approve(page, 'open');
    await h.waitStatus(page, /opened/);
    await navClick(page, '#account-tab-deposit');
    await ready(page);
    assert.match(await page.locator('#fund').innerText(), /Continue funding/);
    const promptsBeforeContinue = await credentials(page);
    h.flags.holdFundingProof = false;
    await click(page, '#fund');
    await h.waitStatus(page, new RegExp(`account balance: ${previousBalance + 10}`));
    assert.equal(h.fundingIds.length, postsBefore + 1, 'reload must not create a second POST');
    assert.equal(h.state.night, previousBalance + 10);
    assert.equal(h.fundedIds.get(original), previousBalance + 10);
    assert.equal(
      await page.evaluate((storageKey) => localStorage.getItem(storageKey), key(night)),
      null,
    );
    assert.equal(
      await credentials(page),
      promptsBeforeContinue,
      'funding continuation needs no passkey',
    );
    h.done('account-actions.pending-proof-resumes-after-reload-without-another-post');

    await ready(page);
    h.flags.holdFundingProof = true;
    h.flags.dropFundingAck = true;
    await click(page, '#fund');
    await h.waitStatus(page, /failed\./, /Funding confirmation is unavailable/);
    const lostAckOriginal = h.fundingIds.at(-1);
    assert.ok(lostAckOriginal && lostAckOriginal !== original);
    assert.ok(h.heldFunding.has(lostAckOriginal), 'the sponsor reserved the original');
    assert.equal(h.fundingIds.length, postsBefore + 2);
    assert.equal(h.state.night, previousBalance + 10, 'lost ACK cannot imply a credit');
    assert.equal(
      await page.evaluate((storageKey) => localStorage.getItem(storageKey), key(night)),
      lostAckOriginal,
    );
    await page.reload();
    await page
      .locator('#status')
      .filter({ hasText: /^Ready\./ })
      .waitFor({ state: 'attached' });
    await observeCredentialAccess(page);
    await approve(page, 'open');
    await h.waitStatus(page, /opened/);
    await navClick(page, '#account-tab-deposit');
    await ready(page);
    assert.match(await page.locator('#fund').innerText(), /Continue funding/);
    const promptsBeforeLostAckContinue = await credentials(page);
    h.flags.dropFundingAck = false;
    h.flags.holdFundingProof = false;
    await click(page, '#fund');
    await h.waitStatus(page, new RegExp(`account balance: ${previousBalance + 20}`));
    assert.equal(h.fundingIds.length, postsBefore + 2, 'lost ACK must not cause a second POST');
    assert.equal(h.state.night, previousBalance + 20);
    assert.equal(h.fundedIds.get(lostAckOriginal), previousBalance + 20);
    assert.equal(await credentials(page), promptsBeforeLostAckContinue);
    h.done('account-actions.lost-funding-ack-resumes-after-reload-without-another-post');
  } finally {
    h.flags.asyncFunding = false;
    h.flags.holdFundingProof = false;
    h.flags.dropFundingAck = false;
    h.flags.pendingFundingStatusReads = 0;
    h.flags.serviceUnavailable = priorOutage;
    await h.archiveObservations(page, h.arm);
    await page.close();
  }
}
