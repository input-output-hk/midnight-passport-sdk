// Test-only driver: every credential request is approved through its visible button.
// No production code auto-approves, and no callback/dialog guard is replaced.
import type { Page } from 'playwright-core';

export async function settleWithCeremonyReviews(page: Page, timeout = 20_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.locator('#ceremony-dialog').isVisible())
      await page.locator('#ceremony-continue').click();
    if ((await page.locator('#log .run[data-state="running"]').count()) === 0) return;
    await page.waitForTimeout(25);
  }
  throw new Error('The operation did not settle after explicit test ceremony reviews.');
}
