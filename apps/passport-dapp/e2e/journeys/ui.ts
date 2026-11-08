import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { settleWithCeremonyReviews } from '../approve-ceremonies.ts';
import { origin } from './constants.js';
import type { JourneyEvidence } from './types.js';
// Use actual navigation, including the mobile drawer; never reveal content by mutating hidden state.
export async function openNavigation(page: Page): Promise<void> {
  if ((await page.locator('#main').getAttribute('data-landing')) === 'true') {
    const tools = page.locator('#landing-demo-tools');
    if (!(await tools.evaluate((element) => (element as HTMLDetailsElement).open)))
      await tools.locator('summary').click();
    await page.locator('#landing-settings').click();
  }
  await page.waitForFunction(() => {
    const nav = document.querySelector('.workspace-nav');
    return matchMedia('(max-width: 900px)').matches
      ? nav?.parentElement?.id === 'navigation-sheet'
      : nav?.parentElement?.id === 'main';
  });
  if (await page.locator('#navigation-toggle').isVisible()) {
    if (
      !(await page
        .locator('#navigation-sheet')
        .evaluate((item) => (item as HTMLDialogElement).open))
    )
      await page.locator('#navigation-toggle').click();
    await page.locator('#navigation-sheet').waitFor({ state: 'visible' });
  }
}
export async function navClick(page: Page, selector: string): Promise<void> {
  if (selector === '#brand-home') {
    await page.locator(selector).click();
    return;
  }
  await openNavigation(page);
  await page.locator(selector).click();
}
export async function assertAccountWorkspace(page: Page): Promise<void> {
  assert.equal(await page.locator('#workspace-account').isVisible(), true);
  assert.equal(await page.locator('#account-page-balances').isVisible(), true);
  assert.equal(await page.locator('#account-tab-balances').getAttribute('aria-current'), 'page');
  assert.equal(await page.evaluate(() => location.hash), '#account/balances');
  assert.notEqual(await page.locator('#main').getAttribute('data-landing'), 'true');
}
export async function reveal(page: Page, selector: string): Promise<void> {
  const location = await page.locator(selector).evaluate((element) => ({
    inNavigation: !!element.closest('.workspace-nav'),
    view: element.closest<HTMLElement>('[data-workspace]')?.dataset.workspace,
    control: element.closest('[data-workspace-page]')?.getAttribute('aria-labelledby'),
    details: [...(element.closest('[data-workspace]')?.querySelectorAll('details') ?? [])]
      .filter((details) => details.contains(element))
      .map((details) => details.id),
  }));
  if (location.inNavigation) {
    await openNavigation(page);
    return;
  }
  if (location.view === 'overview') {
    await navClick(page, '#brand-home');
  } else if (
    location.control &&
    (await page.locator(`#${location.control}`).getAttribute('aria-current')) !== 'page'
  )
    await navClick(page, `#${location.control}`);
  else if (
    location.view &&
    (await page.locator(`#nav-${location.view}`).getAttribute('aria-current')) !== 'page'
  )
    await navClick(page, `#nav-${location.view}`);
  for (const id of location.details) {
    if (
      id &&
      !(await page.locator(`#${id}`).evaluate((element) => (element as HTMLDetailsElement).open))
    )
      await page.locator(`#${id} > summary`).click();
  }
}
export async function readSessionState(page: Page): Promise<string> {
  await reveal(page, '#session-state');
  return (await page.locator('#session-state').getAttribute('data-status')) ?? '';
}
export async function click(page: Page, selector: string): Promise<void> {
  await reveal(page, selector);
  await page.locator(selector).click();
}
export async function fill(page: Page, selector: string, value: string): Promise<void> {
  await reveal(page, selector);
  await page.locator(selector).fill(value);
}
export async function check(page: Page, selector: string): Promise<void> {
  await reveal(page, selector);
  await page.locator(selector).check();
}
export async function select(page: Page, selector: string, value: string): Promise<void> {
  await reveal(page, selector);
  await page.locator(selector).selectOption(value);
}

export async function observeCredentialAccess(page: Page): Promise<void> {
  await page.addScriptTag({ type: 'module', url: `${origin}/e2e/fixtures/credential-observer.ts` });
}
export const approve = async (page: Page, action: string, beforeContinue?: () => Promise<void>) => {
  await page.bringToFront();
  await click(page, `#${action}`);
  if (action === 'create' || beforeContinue) {
    await page.locator('#ceremony-dialog').waitFor({ state: 'visible' });
    if (action === 'create') await check(page, '#consent-retirement-ack');
    await beforeContinue?.();
  }
};

export function journeyObservers(evidence: JourneyEvidence) {
  const { archivedPurposes, failures, pageErrors, credentialFailureCodes } = evidence;
  async function archiveObservations(page: Page, arm: string) {
    const saved = await page.evaluate(() => {
      const w = window as typeof window & {
        __passportPurposeObservations?: { purpose: string }[];
        __passportPurposeFailureCodes?: string[];
      };
      return {
        purposes: (w.__passportPurposeObservations ?? []).map((o) => o.purpose),
        failures: w.__passportPurposeFailureCodes ?? [],
      };
    });
    assert.deepEqual(saved.failures, [], 'reload must not hide any credential observer failure');
    (archivedPurposes[arm] ??= []).push(...saved.purposes);
  }
  const waitStatus = async (page: Page, expected: RegExp, expectedError?: RegExp) => {
    try {
      await settleWithCeremonyReviews(page);
      const codes = await page.evaluate(
        () =>
          (window as typeof window & { __passportPurposeFailureCodes?: string[] })
            .__passportPurposeFailureCodes ?? [],
      );
      assert.deepEqual(
        codes,
        [],
        'unexpected credential observer failure, even in a negative scenario',
      );
      assert.match(
        await page
          .locator('#status')
          .textContent()
          .then((text) => text ?? ''),
        expected,
      );
      if (expectedError)
        assert.match(
          (
            await page.locator('#log .run').first().locator('.error-message').allTextContents()
          ).join('\n'),
          expectedError,
        );
    } catch (error) {
      const codes = await page
        .evaluate(
          () =>
            (window as typeof window & { __passportPurposeFailureCodes?: string[] })
              .__passportPurposeFailureCodes ?? [],
        )
        .catch(() => [] as string[]);
      credentialFailureCodes.push(...codes);
      console.error(
        'Journey status:',
        await page
          .locator('#status')
          .textContent()
          .then((text) => text ?? ''),
      );
      console.error('Fixture/browser errors:', failures, pageErrors);
      throw error;
    }
  };

  return { archiveObservations, waitStatus };
}
