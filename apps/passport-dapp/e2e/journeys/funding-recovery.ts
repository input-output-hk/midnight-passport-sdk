import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import type { JourneyHarness } from './types.js';
import { click, navClick, approve, select } from './ui.js';
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
  const original = h.fundingIds.at(-1),
    count = h.fundingIds.length;
  assert.ok(original);
  h.flags.unavailableFundingReads = 1;
  await refreshAvailability(page);
  await h.waitStatus(page, /refreshed/);
  await ready(page);
  assert.equal(
    await page.evaluate((storageKey) => localStorage.getItem(storageKey), key(custom)),
    original,
  );
  assert.equal(
    h.fundingIds.length,
    count,
    'inventory recovery never reconciles or replaces an unknown transfer',
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
