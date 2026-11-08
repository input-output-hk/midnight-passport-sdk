import assert from 'node:assert/strict';
import type { JourneyHarness } from './types.js';

import { click, navClick, select, approve } from './ui.js';

export async function checkSignedOutLandingHidesWorkspaceNavigationAnd(h: JourneyHarness) {
  const { newPage, calls, done } = h;

  const owner = await newPage();
  assert.equal(await owner.locator('#main').getAttribute('data-landing'), 'true');
  assert.equal(await owner.locator('#workspace-overview').isVisible(), true);
  assert.equal(await owner.locator('.workspace-nav').isVisible(), false);
  assert.equal(await owner.locator('#navigation-toggle').isVisible(), false);
  assert.equal(await owner.locator('#landing-demo-tools > summary').isVisible(), true);
  assert.equal(await owner.locator('#nav-overview, #consent-dialog').count(), 0);
  assert.equal(await owner.getByRole('link', { name: 'Midnight Passport home' }).count(), 1);
  assert.equal(calls.length, 0);
  assert.equal(
    await owner.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1')),
    null,
  );
  done('presentation.signed-out-landing-hides-workspace-navigation-and');
  return { owner };
}

export async function checkSignedOutHomeReturnsFromDemoTools(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { calls, done } = h;
  const { owner } = input;
  await owner.locator('#landing-demo-tools > summary').click();
  await owner.locator('#landing-audit').click();
  assert.equal(await owner.locator('#workspace-audit').isVisible(), true);
  await navClick(owner, '#brand-home');
  assert.equal(await owner.locator('#main').getAttribute('data-landing'), 'true');
  assert.equal(calls.length, 0);
  assert.equal(
    await owner.evaluate(
      () =>
        (
          window as typeof window & {
            __passportPurposeObservations: unknown[];
          }
        ).__passportPurposeObservations.length,
    ),
    0,
  );
  done('presentation.signed-out-home-returns-from-demo-tools');
}

export async function checkOptionalReactStrictModeHostsUsePublicSnapshots(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { newPage, calls, done } = h;
  const { owner } = input;
  const react = await newPage(undefined, true);
  const beforeReactCalls = calls.length;
  assert.equal(await react.locator('#react-runtime').innerText(), 'React 19.3.1');
  assert.deepEqual(await react.locator('.theme-a h3').allTextContents(), [
    'Current operation',
    'Your journey',
  ]);
  assert.deepEqual(await react.locator('.theme-b h3').allTextContents(), [
    'Your journey',
    'Current operation',
  ]);
  await react.locator('#react-publish').click();
  await react.locator('#react-revision').filter({ hasText: 'Revision 1' }).waitFor();
  assert.equal(await react.locator('[data-phase="unknown"]').count(), 2);
  await react.locator('#react-toggle').click();
  assert.equal(await react.locator('.theme-a').count(), 0);
  await react.locator('#react-toggle').click();
  assert.match(await react.locator('.theme-a .intent').innerText(), /original-synthetic-intent/);
  assert.equal(await react.locator('#react-revision').innerText(), 'Revision 1');
  await react.locator('.theme-b [data-action="audit"]').click();
  await react.locator('#react-audit-output').filter({ hasText: 'synthetic-operation' }).waitFor();
  assert.equal(await react.locator('#react-revision').innerText(), 'Revision 1');
  await react.locator('#react-resolve').click();
  await react.locator('#react-revision').filter({ hasText: 'Revision 2' }).waitFor();
  assert.equal(await react.locator('[data-phase="succeeded"]').count(), 2);
  assert.equal(
    await react.evaluate(
      () =>
        (
          window as typeof window & {
            __reactCredentialCalls: number;
          }
        ).__reactCredentialCalls,
    ),
    0,
  );
  assert.equal(calls.length, beforeReactCalls);
  await react.close();
  await owner.bringToFront();
  done('presentation.optional-react-strictmode-hosts-use-public-snapshots');
}

export async function checkOptionalLaceWalletHasExplicitReviewSeparate(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { newPage, calls, done } = h;
  const { owner } = input;
  const external = await newPage();
  const externalCallsBefore = calls.length;
  const recipientBeforeExternal = await external.locator('#withdraw-recipient').inputValue();
  await click(external, '#lace-wallet-discover');
  assert.match(await external.locator('#lace-wallet-status').innerText(), /No compatible/);
  await external.evaluate(async () => {
    const path = '/e2e/fixtures/lace-provider.ts';
    const fixture = await import(/* @vite-ignore */ path);
    fixture.installLaceFixture();
  });
  const fixtureCall = async (method: string, value?: string) =>
    external.evaluate(
      async ({ method, value }) => {
        const path = '/e2e/fixtures/lace-provider.ts';
        const fixture = await import(/* @vite-ignore */ path);
        return fixture[method](value);
      },
      { method, value },
    );
  await click(external, '#lace-wallet-discover');
  assert.equal(await external.locator('#lace-wallet-provider option').count(), 3);
  assert.equal(await external.locator('#lace-wallet-connect').isDisabled(), true);
  assert.equal(await external.locator('#lace-wallet-controls img').count(), 0);
  await select(external, '#lace-wallet-provider', '10000000-0000-0000-0000-000000000001');
  await click(external, '#lace-wallet-connect');
  await external.keyboard.press('Tab');
  assert.equal(await external.evaluate(() => document.activeElement?.id), 'lace-wallet-approve');
  await external.keyboard.press('Shift+Tab');
  assert.equal(await external.evaluate(() => document.activeElement?.id), 'lace-wallet-cancel');
  await external.keyboard.press('Escape');
  assert.deepEqual(await fixtureCall('laceFixtureCalls'), []);
  await click(external, '#lace-wallet-connect');
  await external.locator('#lace-wallet-approve').click();
  await external
    .locator('#lace-wallet-status')
    .filter({ hasText: 'Connected for this page' })
    .waitFor();
  await click(external, '#wallet-tab-lace');
  assert.match(
    await external.locator('#lace-wallet-snapshot').innerText(),
    /NIGHT[\s\S]*5 smallest units/,
  );
  assert.equal(await external.locator('#withdraw-recipient').inputValue(), recipientBeforeExternal);
  assert.match((await external.locator('#account-empty').textContent()) ?? '', /No account/);
  await external.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await external.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'external-wallet long address must fit mobile',
  );
  await click(external, '#nav-settings');
  assert.ok(
    await external.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'provider advertisements and controls must fit mobile',
  );
  await external.setViewportSize({ width: 1280, height: 900 });
  await click(external, '#nav-wallet');
  await fixtureCall('setLaceFixtureMode', 'wrong-network');
  await click(external, '#lace-wallet-refresh');
  await click(external, '#nav-settings');
  await external.locator('#lace-wallet-status').filter({ hasText: 'NetworkMismatch' }).waitFor();
  assert.match(
    (await external.locator('#lace-wallet-snapshot').textContent()) ?? '',
    /Balance unavailable/,
  );
  await fixtureCall('setLaceFixtureMode', 'reject');
  await click(external, '#lace-wallet-connect');
  await external.locator('#lace-wallet-approve').click();
  await external.locator('#lace-wallet-status').filter({ hasText: 'PermissionRejected' }).waitFor();
  assert.doesNotMatch(await external.locator('#lace-wallet-status').innerText(), /private detail/);
  await fixtureCall('setLaceFixtureMode', 'delay');
  await click(external, '#lace-wallet-connect');
  await external.locator('#lace-wallet-approve').click();
  await external.locator('#lace-wallet-status').filter({ hasText: 'Waiting for' }).waitFor();
  await click(external, '#lace-wallet-forget');
  await fixtureCall('releaseLaceFixture');
  await external.waitForTimeout(30);
  assert.match(await external.locator('#lace-wallet-status').innerText(), /forgotten/);
  await fixtureCall('setLaceFixtureMode', 'ready');
  await click(external, '#lace-wallet-connect');
  const connectCountBeforeReplacement = (
    (await fixtureCall('laceFixtureCalls')) as string[]
  ).filter((c) => c === 'connect').length;
  await fixtureCall('replaceLaceFixture');
  await external.locator('#lace-wallet-approve').click();
  await external
    .locator('#lace-wallet-status')
    .filter({ hasText: 'ProviderUnavailable' })
    .waitFor();
  assert.equal(
    ((await fixtureCall('laceFixtureCalls')) as string[]).filter((c) => c === 'connect').length,
    connectCountBeforeReplacement,
  );
  assert.equal(
    await external.evaluate(() => localStorage.getItem('passport-dev:mock-passkey:v1')),
    null,
  );
  assert.equal(calls.length, externalCallsBefore, 'wallet reads must not call the ACC driver');
  await external.close();
  await owner.bringToFront();
  done('presentation.optional-lace-wallet-has-explicit-review-separate');
}

export async function checkHidingActivityBetweenApprovalAndBrowserAccess(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { newPage, calls, waitStatus, done } = h;
  const { owner } = input;
  const obscured = await newPage();
  await obscured.evaluate(() =>
    document.addEventListener(
      'passport:present-ceremony',
      () =>
        (
          document.getElementById('activity-toggle') ??
          (() => {
            throw new Error('Missing journey fixture value');
          })()
        ).click(),
      { once: true },
    ),
  );
  const callsBeforeObscured = calls.length;
  await approve(obscured, 'create');
  await obscured.locator('#ceremony-continue').click();
  await waitStatus(obscured, /UserCancelled/, /explanation is not visible/);
  assert.equal(
    await obscured.evaluate(
      () =>
        (
          window as typeof window & {
            __passportPurposeObservations: unknown[];
          }
        ).__passportPurposeObservations.length,
    ),
    0,
  );
  assert.equal(calls.length, callsBeforeObscured);
  await obscured.close();
  await owner.bringToFront();
  done('presentation.hiding-activity-between-approval-and-browser-access');
}

export async function checkTwoWhiteLabelActivityHostsRenderShared(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { calls, done } = h;
  const { owner } = input;
  const controlChecks = await owner.evaluate(async () => {
    const path = '/e2e/fixtures/activity-controls-check.ts';
    const module = (await import(/* @vite-ignore */ path)) as {
      checkActivityControls(): {
        hosts: number;
        markupEscaped: boolean;
        themesIndependent: boolean;
        remountReplays: number;
        originalIntentPreserved: boolean;
      };
    };
    return module.checkActivityControls();
  });
  assert.deepEqual(controlChecks, {
    hosts: 2,
    markupEscaped: true,
    themesIndependent: true,
    remountReplays: 0,
    originalIntentPreserved: true,
  });
  assert.equal(calls.length, 0);
  done('presentation.two-white-label-activity-hosts-render-shared');
}
