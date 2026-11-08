import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { JourneyHarness, JourneyEvidence } from './types.js';
import type { JourneyArm } from '../journey-arms.js';
import type { journeyTiming } from '../journey-timing.js';
import { interceptJourney } from './network.js';
import { journeyObservers, observeCredentialAccess } from './ui.js';
import { origin } from './constants.js';

async function initializePage(
  h: JourneyHarness,
  page: Page,
  reactExample: boolean,
  fragment: string,
) {
  page.on('pageerror', (error) => h.pageErrors.push(error.message));
  page.on('dialog', (dialog) => {
    if (h.flags.rejectNextDialog) {
      h.flags.rejectNextDialog = false;
      void dialog.dismiss();
    } else void dialog.accept();
  });
  if (reactExample) {
    await page.addInitScript({
      content: `window.__reactCredentialCalls=0;Object.defineProperty(navigator,'credentials',{configurable:true,value:{async create(){window.__reactCredentialCalls++;throw Error('Unexpected credential access');},async get(){window.__reactCredentialCalls++;throw Error('Unexpected credential access');}}});`,
    });
    await page.goto(`${origin}/examples/react-activity.html`);
    await page.locator('#react-revision').filter({ hasText: 'Revision 0' }).waitFor();
    return;
  }
  await page.goto(`${origin}/?mockPasskey&fixtureArm=${h.arm}${fragment}`);
  await page
    .locator('#status')
    .filter({ hasText: /^Ready\./ })
    .waitFor({ state: 'attached' })
    .catch(async (error: unknown) => {
      console.error(
        'Startup errors:',
        h.failures,
        h.pageErrors,
        await page.locator('#status').allTextContents(),
      );
      throw error;
    });
  await observeCredentialAccess(page);
}
export function createJourneyHarness(
  browser: Browser,
  base: string,
  arm: JourneyArm,
  evidence: JourneyEvidence,
  timing: ReturnType<typeof journeyTiming>,
  done: (id: string) => void,
): JourneyHarness {
  const h: JourneyHarness = {
    ...evidence,
    arm,
    done,
    state: {
      nonce: 0,
      epoch: 0,
      entries: ['10'.repeat(32)],
      night: 0,
      wallet: 0,
      txHash: '01'.repeat(32),
    },
    calls: [],
    fundingIds: [],
    fundedIds: new Map(),
    contexts: [],
    flags: {
      unknownFunding: false,
      unknownWithdrawal: false,
      unsettledGrantSpend: false,
      unknownSession: false,
      unknownRevocation: false,
      holdSessionSpend: undefined,
      heldOwnerAction: undefined,
      holdOwnerReceipt: undefined,
      receiptReadUnavailable: false,
      serviceUnavailable: false,
      staleOwnerReads: false,
      staleReadCount: 0,
      rejectNextDialog: false,
    },
    ...journeyObservers(evidence),
    async newPage(existing?: BrowserContext, reactExample = false, fragment = ''): Promise<Page> {
      const context = existing ?? (await browser.newContext({ serviceWorkers: 'block' }));
      if (!existing) {
        h.contexts.push(context);
        timing.created('context');
        await context.route('**/*', async (route) => {
          try {
            await interceptJourney(h, route, base);
          } catch (error) {
            if (!h.closingContexts.has(context))
              h.failures.push(
                `route-error:${error instanceof Error ? error.message.split('\n')[0] : 'unknown'}`,
              );
            await route.abort().catch(() => {});
          }
        });
        await context.addInitScript(() => {
          const nativeNow = Date.now;
          const clock = window as typeof window & { __sessionClockOffset?: number };
          Date.now = () => nativeNow() + (clock.__sessionClockOffset ?? 0);
        });
      }
      const page = await context.newPage();
      timing.created('page');
      await initializePage(h, page, reactExample, fragment);
      return page;
    },
  };
  return h;
}
