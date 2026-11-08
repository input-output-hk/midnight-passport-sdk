import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import type { JourneyHarness } from './types.js';
import { bootstrapPlans, type JourneyGroup } from './catalog.mjs';
import { address } from './constants.js';
import { approve, click, fill, select } from './ui.js';
export interface BootstrapEvidence {
  actions: string[];
  elapsedMs: number;
}
export function bootstrapPlan(group: JourneyGroup): readonly string[] {
  return bootstrapPlans[group];
}
async function walletRecipient(h: JourneyHarness, page: Page) {
  await approve(page, 'wallet');
  await h.waitStatus(page, /wallet connected through/);
  const recipient = await page
    .locator('#wallet-facts .fact')
    .filter({ hasText: 'Unshielded address' })
    .locator('.value')
    .getAttribute('title');
  assert.ok(recipient);
  return recipient;
}
export async function signedOutBootstrap(h: JourneyHarness) {
  const owner = await h.newPage();
  await owner.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await owner.locator('#main').getAttribute('data-landing'), 'true');
  assert.equal(await owner.locator('#ceremony-dialog').isVisible(), false);
  assert.equal(await owner.locator('#activity-panel').isVisible(), false);
  assert.equal(
    await owner.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1')),
    null,
  );
  assert.equal(h.calls.length, 0);
  return { owner };
}
export async function sessionBootstrap(h: JourneyHarness) {
  const { owner } = await signedOutBootstrap(h);
  await approve(owner, 'create');
  await h.waitStatus(owner, /created/);
  const recipient = await walletRecipient(h, owner);
  await click(owner, '#fund');
  await h.waitStatus(owner, /account balance: 10/);
  await fill(owner, '#withdraw-recipient', recipient);
  await fill(owner, '#withdraw-amount', '1');
  await select(owner, '#session-minutes', '15');
  assert.equal(h.state.grant, undefined);
  assert.equal(h.state.ownerPublicKey, undefined);
  return { owner, recipient };
}
export async function ownerBootstrap(h: JourneyHarness) {
  const joiner = await h.newPage();
  await fill(joiner, '#open-address', address);
  await approve(joiner, 'prepareJoiner');
  await h.waitStatus(joiner, /handoff|fingerprint|public keys/i);
  const handoff = await joiner.locator('#handoff-output').inputValue();
  assert.ok(handoff);
  const recipient = await walletRecipient(h, joiner);
  return { recipient, handoff };
}
