import assert from 'node:assert/strict';
import type { JourneyHarness } from './types.js';
import { click, navClick, approve, select } from './ui.js';
import { address, night } from './constants.js';

export async function checkFundingInventory(h: JourneyHarness) {
  h.flags.emptyFunding = true;
  const empty = await h.newPage();
  try {
    await approve(empty, 'create');
    await h.waitStatus(empty, /is created\./);
    await navClick(empty, '#account-tab-deposit');
    assert.equal(await empty.locator('#fund').isDisabled(), true);
    assert.equal(await empty.locator('#fund-asset option').getAttribute('disabled'), '');
    assert.match(await empty.locator('#fund-desc').innerText(), /Deposits are unavailable/);
    await navClick(empty, '#account-tab-withdraw');
    assert.equal(await empty.locator('#withdraw-asset').isEnabled(), true);
    h.done('account-actions.empty-funding-inventory-disables-deposits-without-hiding-withdrawals');
  } finally {
    h.flags.emptyFunding = false;
    await h.archiveObservations(empty, h.arm);
    await empty.close();
  }
  h.flags.multipleFundingAssets = true;
  const stale = await h.newPage();
  const before = h.state.night;
  h.flags.rejectFundingPreflight = true;
  try {
    await approve(stale, 'create');
    await h.waitStatus(stale, /is created\./);
    await select(stale, '#fund-asset', 'cd'.repeat(32));
    await click(stale, '#refresh');
    await h.waitStatus(stale, /refreshed/);
    assert.equal(await stale.locator('#fund-asset').inputValue(), 'cd'.repeat(32));
    h.flags.customFundingUnavailable = true;
    await click(stale, '#refresh');
    await h.waitStatus(stale, /refreshed/);
    assert.equal(
      await stale.locator('#fund-asset').inputValue(),
      'cd'.repeat(32),
      'unavailable custom selection must never become NIGHT',
    );
    assert.equal(await stale.locator('#fund').isDisabled(), true);
    await select(stale, '#fund-asset', night);
    for (let attempt = 0; attempt < 2; attempt++) {
      await click(stale, '#fund');
      await h.waitStatus(stale, /No transfer was started/, /funding wallet/i);
      assert.equal(await stale.locator('.operation-status').getAttribute('data-phase'), 'failed');
      assert.equal(
        await stale.evaluate(
          (key) => localStorage.getItem(key),
          `passport-demo:fund:undeployed:${address}:${night}`,
        ),
        null,
      );
    }
    assert.notEqual(
      h.fundingIds.at(-1),
      h.fundingIds.at(-2),
      'only proved no-start allows an explicit new intent',
    );
    assert.equal(h.state.night, before);
    h.done('account-actions.proved-funding-refusal-is-failed-and-allows-only-explicit-new-intents');
  } finally {
    h.flags.rejectFundingPreflight = false;
    h.flags.multipleFundingAssets = false;
    h.flags.customFundingUnavailable = false;
    await h.archiveObservations(stale, h.arm);
    await stale.close();
  }
}
