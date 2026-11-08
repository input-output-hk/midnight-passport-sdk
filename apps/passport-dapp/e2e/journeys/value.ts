import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import type { JourneyHarness } from './types.js';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { fill, navClick, click, approve, reveal } from './ui.js';
import { address, night } from './constants.js';
import { expiryCases } from './catalog.mjs';
import type { checkSignedOutLandingHidesWorkspaceNavigationAnd } from './presentation.js';
import type { checkEscapeOnTheFirstCeremonyRefusesCredential } from './ceremonies.js';
export async function checkAccountFormsPreserveTheirValuesAcrossTabs(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { calls, done } = h;
  const { owner } = input;
  const recipient = await owner
    .locator('#wallet-facts .fact')
    .filter({ hasText: 'Unshielded address' })
    .locator('.value')
    .getAttribute('title');
  assert.ok(recipient);
  const beforeAccountNavigation = calls.length;
  await fill(owner, '#withdraw-recipient', recipient);
  await fill(owner, '#withdraw-amount', '3');
  for (const tab of ['deposit', 'balances', 'withdraw'])
    await navClick(owner, `#account-tab-${tab}`);
  assert.equal(await owner.locator('#withdraw-amount').inputValue(), '3');
  assert.equal(await owner.locator('#withdraw-recipient').inputValue(), recipient);
  assert.equal(await owner.locator('#withdraw').isVisible(), true);
  assert.equal(await owner.locator('#fund').isVisible(), false);
  assert.ok(
    (await owner.locator('#account-action-context .value').first().getAttribute('title')) ===
      address,
  );
  await navClick(owner, '#nav-wallet');
  await navClick(owner, '#nav-account');
  assert.equal(await owner.locator('#account-tab-withdraw').getAttribute('aria-current'), 'page');
  assert.equal(await owner.locator('#withdraw-amount').inputValue(), '3');
  await navClick(owner, '#account-tab-balances');
  assert.equal(
    await owner
      .locator('#account-state-details')
      .evaluate((node) => (node as HTMLDetailsElement).open),
    false,
  );
  assert.equal(await owner.locator('#account-state-facts').isVisible(), false);
  await owner.locator('#account-state-details > summary').click();
  assert.match(await owner.locator('#account-state-facts').innerText(), /Auth nonce/);
  await owner.locator('#account-state-details > summary').click();
  assert.equal(calls.length, beforeAccountNavigation);
  done('account-actions.account-forms-preserve-their-values-across-tabs');
  return { recipient };
}

export async function checkEarlyFailureBeforeAnyCredentialCeremonyReveals(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
      'credentialsUsed'
    >,
) {
  const { arm, waitStatus, fundingIds, state, calls, done } = h;
  const { owner, credentialsUsed } = input;
  if (process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS && arm === 'p256') {
    const folder = process.env.PASSPORT_DEMO_JOURNEY_SCREENSHOTS;
    await mkdir(folder, { recursive: true });
    for (const theme of ['dark', 'light'] as const) {
      await owner.emulateMedia({ colorScheme: theme });
      for (const tab of ['balances', 'deposit', 'withdraw']) {
        await navClick(owner, `#account-tab-${tab}`);
        await owner.locator('#workspace-account').screenshot({
          path: resolve(folder, `account-${tab}-${theme}.png`),
          style: '.mock-banner { position: static !important; }',
        });
      }
    }
    await owner.setViewportSize({ width: 390, height: 844 });
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await owner.locator('#workspace-account').screenshot({
      path: resolve(folder, 'account-withdraw-mobile.png'),
      style: '.mock-banner { position: static !important; }',
    });
    await owner.setViewportSize({ width: 1280, height: 900 });
  }
  await fill(owner, '#withdraw-amount', '1');
  await click(owner, '#fund');
  await waitStatus(owner, /account balance: 10/);
  const successfulFundingId =
    fundingIds.at(-1) ??
    (() => {
      throw new Error('Missing journey fixture value');
    })();
  await owner.evaluate(({ key, id }) => localStorage.setItem(key, id), {
    key: `passport-demo:fund:undeployed:${address}:${night}`,
    id: successfulFundingId,
  });
  await click(owner, '#fund');
  await waitStatus(owner, /account balance: 10/);
  assert.equal(state.night, 10, 'replayed funding ID must not credit twice');
  await fill(owner, '#withdraw-amount', '1');
  await fill(owner, '#withdraw-recipient', 'invalid-recipient');
  const withdrawals = calls.filter((c) => c === 'withdraw').length;
  const beforeInvalidRecipient = await credentialsUsed();
  await owner.setViewportSize({ width: 390, height: 844 });
  await approve(owner, 'withdraw');
  await waitStatus(owner, /failed\./, /Enter a valid unshielded Midnight address for undeployed/);
  assert.equal(calls.filter((c) => c === 'withdraw').length, withdrawals);
  assert.equal(await credentialsUsed(), beforeInvalidRecipient);
  assert.equal(
    await owner.locator('#activity-sheet').evaluate((e) => (e as HTMLDialogElement).open),
    true,
  );
  await owner.locator('#activity-close').click();
  await owner.setViewportSize({ width: 1280, height: 900 });
  done('account-actions.early-failure-before-any-credential-ceremony-reveals');
  return { withdrawals };
}

export async function checkBackgroundTelemetryCannotRelabelAFinishedAttempt(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { calls, done } = h;
  const { owner } = input;
  const phaseBeforeBackground = await owner.locator('.operation-status').getAttribute('data-phase');
  const refsBeforeBackground = await owner.locator('.activity-references').textContent();
  const callsBeforeBackground = calls.length;
  await owner.evaluate(async () => {
    const path = '/src/operation-trace.ts';
    const module = (await import(/* @vite-ignore */ path)) as {
      traceOperation(kind: string, details: Record<string, unknown>): void;
    };
    module.traceOperation('session.state', {
      phase: 'blocked',
      intentId: 'background-not-this-operation',
    });
  });
  assert.equal(
    await owner.locator('.operation-status').getAttribute('data-phase'),
    phaseBeforeBackground,
  );
  assert.equal(await owner.locator('.activity-references').textContent(), refsBeforeBackground);
  assert.equal(calls.length, callsBeforeBackground);
  done('account-actions.background-telemetry-cannot-relabel-a-finished-attempt');
}

export async function checkFundTenRejectInvalidRecipientWithdrawOne(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkEarlyFailureBeforeAnyCredentialCeremonyReveals>>,
      'withdrawals'
    > &
    Pick<Awaited<ReturnType<typeof checkAccountFormsPreserveTheirValuesAcrossTabs>>, 'recipient'> &
    Pick<
      Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
      'credentialsUsed'
    >,
) {
  const { waitStatus, calls, state, done } = h;
  const { owner, withdrawals, recipient, credentialsUsed } = input;
  const wrongNetwork = MidnightBech32m.encode(
    'preview',
    new UnshieldedAddress(Buffer.alloc(32, 7)),
  ).asString();
  await fill(owner, '#withdraw-recipient', wrongNetwork);
  await approve(owner, 'withdraw');
  await waitStatus(owner, /failed\./, /Enter a valid unshielded Midnight address for undeployed/);
  assert.equal(calls.filter((c) => c === 'withdraw').length, withdrawals);
  await fill(owner, '#withdraw-recipient', recipient);
  const beforeDeclinedOwnerTransfer = await credentialsUsed();
  await approve(owner, 'withdraw', async () => {
    const details = await owner.locator('#ceremony-details').textContent();
    assert.ok(details?.includes(recipient));
    assert.ok(details?.includes('Amount: 1 smallest units'));
    await click(owner, '#ceremony-cancel');
  });
  await waitStatus(owner, /UserCancelled/, /passkey request was declined/);
  assert.equal(await credentialsUsed(), beforeDeclinedOwnerTransfer);
  assert.equal(calls.filter((c) => c === 'withdraw').length, withdrawals);
  await approve(owner, 'withdraw');
  await waitStatus(owner, /Withdrawal confirmed/);
  assert.equal(state.night, 9);
  assert.equal(state.wallet, 1);
  await click(owner, '#walletRefresh');
  await waitStatus(owner, /snapshot refreshed/);
  done('account-actions.fund-ten-reject-invalid-recipient-withdraw-one');
}

export async function checkOnePostLockRoutineReauthenticationWarmsThe(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
    'credentialsUsed'
  > &
    Pick<Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>, 'owner'>,
) {
  const { waitStatus, done } = h;
  const { credentialsUsed, owner } = input;
  const beforeRoutineUnlock = await credentialsUsed();
  await approve(owner, 'unlockRoutine');
  await waitStatus(owner, /Quick actions unlocked/);
  assert.equal(await credentialsUsed(), beforeRoutineUnlock + 1);
  const afterRoutineUnlock = await credentialsUsed();
  await approve(owner, 'holdings');
  await waitStatus(owner, /Verified 1 shielded/);
  await approve(owner, 'holdings');
  await waitStatus(owner, /Verified 1 shielded/);
  await approve(owner, 'wallet');
  await waitStatus(owner, /wallet connected through/);
  assert.equal(
    await credentialsUsed(),
    afterRoutineUnlock,
    'unlocked reads and wallet connection must not access the credential API',
  );
  await approve(owner, 'rotate');
  await waitStatus(owner, /confirmed its new sealed/);
  assert.ok(
    (await credentialsUsed()) > afterRoutineUnlock,
    'critical owner changes retain fresh passkey use',
  );
  await click(owner, '#lock-routine');
  assert.match(await owner.locator('#routine-status').innerText(), /locked/);
  const afterRoutineLock = await credentialsUsed();
  await approve(owner, 'holdings');
  await waitStatus(owner, /Verified 1 shielded/);
  assert.equal(
    await credentialsUsed(),
    afterRoutineLock + 1,
    'locked routine access reauthenticates once',
  );
  const afterRoutineReauthentication = await credentialsUsed();
  await approve(owner, 'holdings');
  await waitStatus(owner, /Verified 1 shielded/);
  await approve(owner, 'wallet');
  await waitStatus(owner, /wallet connected through/);
  assert.equal(await credentialsUsed(), afterRoutineReauthentication);
  done('account-actions.one-post-lock-routine-reauthentication-warms-the');
  done('account-actions.one-prf-unlock-serves-repeated-readings-and');
}

export async function checkActionReviewExpiryRefusesWithoutSilentlyRequesting(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
      'credentialsUsed'
    >,
) {
  const { waitStatus, done } = h;
  const { owner, credentialsUsed } = input;
  for (const action of ['holdings', 'wallet'] as const) {
    await approve(owner, 'unlockRoutine');
    await waitStatus(owner, /Quick actions unlocked/);
    const beforeExpiry = await credentialsUsed();
    // A standalone JS expression avoids tsx's inferred-name helpers crossing
    // Playwright's function serialization boundary into the browser realm.
    await owner.evaluate(String.raw`(() => {
          const manager = navigator.locks;
          const original = manager.request.bind(manager);
          const descriptor = Object.getOwnPropertyDescriptor(manager, 'request');
          const restore = () => {
            if (descriptor) Object.defineProperty(manager, 'request', descriptor);
            else Reflect.deleteProperty(manager, 'request');
            delete window.__restoreReviewLocks;
          };
          window.__restoreReviewLocks = restore;
          Object.defineProperty(manager, 'request', {
            configurable: true,
            value: (name, options, callback) =>
              original(name, options, (lock) => {
                // Execute synchronously through lease capture, before its await resumes.
                const pending = callback(lock);
                if (lock && name.startsWith('passport-demo:operation:v1:')) {
                  window.__sessionClockOffset = 31 * 60_000;
                  restore();
                }
                return pending;
              }),
          });
        })()`);
    try {
      await click(owner, `#${action}`);
      await waitStatus(owner, /failed\./, /locked or expired/);
    } finally {
      await owner.evaluate(() => {
        const fixture = window as typeof window & {
          __sessionClockOffset: number;
          __restoreReviewLocks?: () => void;
        };
        fixture.__restoreReviewLocks?.();
        fixture.__sessionClockOffset = 0;
      });
    }
    assert.equal(
      await credentialsUsed(),
      beforeExpiry,
      'expired review cannot fall back to a passkey',
    );
    assert.equal(await owner.locator('#ceremony-dialog').isVisible(), false);
    done(expiryCases[action]);
  }
}

export async function checkLockWhileThePreviousWalletStopsDiscards(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkEscapeOnTheFirstCeremonyRefusesCredential>>,
      'credentialsUsed'
    >,
) {
  const { waitStatus, done } = h;
  const { owner, credentialsUsed } = input;
  await approve(owner, 'unlockRoutine');
  await waitStatus(owner, /Quick actions unlocked/);
  const beforeWalletRace = await credentialsUsed();
  const walletStarts = await owner.evaluate(() => {
    const w = window as typeof window & {
      __demoWalletStarts?: number;
      __demoHoldWalletStop?: () => Promise<void>;
      __demoWalletStopping?: boolean;
      __demoReleaseWalletStop?: () => void;
    };
    w.__demoHoldWalletStop = () =>
      new Promise<void>((resolve) => {
        w.__demoWalletStopping = true;
        w.__demoReleaseWalletStop = resolve;
      });
    return w.__demoWalletStarts;
  });
  await approve(owner, 'wallet');
  await owner.waitForFunction(
    () =>
      (
        window as typeof window & {
          __demoWalletStopping?: boolean;
        }
      ).__demoWalletStopping,
  );
  await owner.evaluate(() => {
    const w = window as typeof window & {
      __demoHoldWalletStop?: () => Promise<void>;
      __demoReleaseWalletStop?: () => void;
    };
    window.dispatchEvent(new Event('pagehide'));
    delete w.__demoHoldWalletStop;
    (
      w.__demoReleaseWalletStop ??
      (() => {
        throw new Error('Missing journey fixture value');
      })()
    )();
  });
  await waitStatus(owner, /failed\./, /locked or expired/);
  assert.equal(
    await owner.evaluate(
      () =>
        (
          window as typeof window & {
            __demoWalletStarts?: number;
          }
        ).__demoWalletStarts,
    ),
    walletStarts,
  );
  assert.equal(await credentialsUsed(), beforeWalletRace);
  done('account-actions.lock-while-the-previous-wallet-stops-discards');
}

export async function checkPageExitDisposesQuickActionKeysWithout(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { waitStatus, done } = h;
  const { owner } = input;
  await approve(owner, 'unlockRoutine');
  await waitStatus(owner, /Quick actions unlocked/);
  await owner.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await reveal(owner, '#routine-status');
  assert.match(await owner.locator('#routine-status').innerText(), /locked/);
  done('account-actions.page-exit-disposes-quick-action-keys-without');
}

export async function checkCompletedOperationResultsStayInCollapsibleActivity(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { done } = h;
  const { owner } = input;
  await click(owner, '#nav-wallet');
  if (await owner.locator('#activity-panel').isVisible())
    await owner.locator('#activity-toggle').click();
  assert.equal(await owner.locator('#progress').isVisible(), false);
  assert.equal(await owner.locator('#status').isVisible(), false);
  assert.match(await owner.locator('#activity-toggle').innerText(), /Completed/);
  await owner.locator('#activity-toggle').click();
  assert.equal(await owner.locator('#progress').isVisible(), true);
  done('account-actions.completed-operation-results-stay-in-collapsible-activity');
}

export async function checkDedicatedAuditRendersAndCopiesPublicExchanges(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkSignedOutLandingHidesWorkspaceNavigationAnd>>,
    'owner'
  >,
) {
  const { calls, waitStatus, done } = h;
  const { owner } = input;
  const beforeAudit = calls.length;
  await navClick(owner, '#nav-audit');
  await reveal(owner, '#trace');
  await owner
    .locator('#trace')
    .filter({ hasText: /http.request|funding.intent/ })
    .waitFor();
  assert.match(await owner.locator('#trace').innerText(), /http.request|funding.intent/);
  await owner.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async writeText(text: string) {
          (
            window as typeof window & {
              __copiedPublicAudit: string;
            }
          ).__copiedPublicAudit = text;
        },
      },
    });
  });
  await click(owner, '#copy');
  await waitStatus(owner, /Full operation log copied/);
  const copied = await owner.evaluate(() => {
    const text = (
      window as typeof window & {
        __copiedPublicAudit: string;
      }
    ).__copiedPublicAudit;
    const result = JSON.parse(text) as {
      account: {
        address: string;
      };
      runs: {
        result: string;
        outcome: string;
      }[];
      trace: unknown[];
    };
    const forbidden =
      /"(?:privateKey|prfOutput|seed|authenticatorData|clientDataJSON|bearerToken)"\s*:/i.test(
        text,
      );
    return {
      account: result.account.address,
      runs: result.runs.length,
      trace: result.trace.length,
      forbidden,
      // Credential-review decline retains the raw failed attempt and semantic cancellation.
      hasCancellation: result.runs.some((run) => run.outcome === 'cancelled'),
      hasDeclinedAttempt: result.runs.some(
        (run) => run.result === 'failed' && run.outcome === 'cancelled',
      ),
    };
  });
  assert.equal(copied.account, address);
  assert.ok(copied.runs > 0 && copied.trace > 0);
  assert.equal(copied.forbidden, false);
  assert.equal(copied.hasCancellation, true);
  assert.equal(copied.hasDeclinedAttempt, true);
  assert.equal(calls.length, beforeAudit);
  done('account-actions.dedicated-audit-renders-and-copies-public-exchanges');
}
