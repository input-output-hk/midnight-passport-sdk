import assert from 'node:assert/strict';
import type { JourneyHarness } from './types.js';

import { approve, fill, navClick, reveal, observeCredentialAccess, click } from './ui.js';
import { target } from './constants.js';
import { receiptCases } from './catalog.mjs';
import type {
  checkFullOwnerEnrollmentIsExplicitDecliningCreates,
  checkAuthenticatedOwnerHoldingsAndBuiltInWallet,
} from './owner-actions.js';
import type { checkPrepareJoinerRejectMalformedHandoffEnrollOpen } from './grants.js';
import type { checkAccountFormsPreserveTheirValuesAcrossTabs } from './value.js';
export async function checkConfirmedOwnerScenarioRetainsItsOriginalReceipt(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
    'fullOwner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkPrepareJoinerRejectMalformedHandoffEnrollOpen>>,
      'handoff'
    > &
    Pick<
      Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
      'ownerCredentials'
    > &
    Pick<
      Awaited<ReturnType<typeof checkAuthenticatedOwnerHoldingsAndBuiltInWallet>>,
      'approveFreshOwnerCeremony'
    >,
) {
  const { waitStatus, state, calls, done } = h;
  const { fullOwner, handoff, ownerCredentials, approveFreshOwnerCeremony } = input;
  for (const scenario of ['rotate', 'removeDevice', 'revokeGrant', 'indexer-outage'] as const) {
    await approve(fullOwner, 'unlockOwner');
    await waitStatus(fullOwner, /Account unlocked/);
    if (scenario === 'removeDevice') {
      await fill(fullOwner, '#handoff-input', handoff);
      await approve(fullOwner, 'enrollDevice');
      await waitStatus(fullOwner, /Joining device confirmed/);
      await fill(fullOwner, '#remove-commitment', target);
    }
    if (scenario === 'revokeGrant') {
      await approve(fullOwner, 'issueGrant');
      await waitStatus(fullOwner, /Grant.*active/i);
      await fill(
        fullOwner,
        '#revoke-grant-id',
        (
          state.grant ??
          (() => {
            throw new Error('Missing journey fixture value');
          })()
        ).id,
      );
    }
    let releaseReceipt: () => void = () => {
      throw Error('Uninitialized fixture gate');
    };
    let observeReceipt: () => void = () => {
      throw Error('Uninitialized fixture gate');
    };
    const heldReceipt = new Promise<void>((resolve) => {
      releaseReceipt = resolve;
    });
    const receiptObserved = new Promise<void>((resolve) => {
      observeReceipt = resolve;
    });
    const action = scenario === 'indexer-outage' ? 'rotate' : scenario;
    h.flags.heldOwnerAction =
      action === 'removeDevice' ? 'remove' : action === 'revokeGrant' ? 'revoke' : action;
    h.flags.holdOwnerReceipt = () => {
      observeReceipt();
      return heldReceipt;
    };
    const originalCalls = calls.filter((call) => call === h.flags.heldOwnerAction).length;
    const credentialsBefore = await ownerCredentials();
    await approve(fullOwner, action);
    await approveFreshOwnerCeremony();
    await receiptObserved;
    const originalHash = state.txHash;
    await fullOwner.evaluate(() => {
      (
        window as typeof window & {
          __sessionClockOffset: number;
        }
      ).__sessionClockOffset = 31 * 60000;
    });
    await fullOwner
      .locator('#routine-status')
      .filter({ hasText: /expired/ })
      .waitFor({ state: 'attached' });
    h.flags.receiptReadUnavailable = scenario === 'indexer-outage';
    releaseReceipt();
    await waitStatus(
      fullOwner,
      scenario === 'rotate'
        ? /confirmed its new sealed/
        : scenario === 'removeDevice'
          ? /selected entry is absent/
          : scenario === 'revokeGrant'
            ? /revoked on chain/
            : /Transaction receipt retained/,
    );
    h.flags.receiptReadUnavailable = false;
    assert.equal(
      calls.filter((call) => call === h.flags.heldOwnerAction).length,
      originalCalls + 1,
    );
    assert.equal(await ownerCredentials(), credentialsBefore + 1);
    h.flags.heldOwnerAction = undefined;
    h.flags.holdOwnerReceipt = undefined;
    await fullOwner.evaluate(() => {
      (
        window as typeof window & {
          __sessionClockOffset: number;
        }
      ).__sessionClockOffset = 0;
    });
    await navClick(fullOwner, '#nav-audit');
    await reveal(fullOwner, '#evidence');
    await fullOwner
      .locator('#evidence')
      .filter({ hasText: originalHash })
      .waitFor({ state: 'visible' });
    assert.match(
      (await fullOwner.locator('#evidence').textContent()) ??
        (() => {
          throw new Error('Missing journey fixture value');
        })(),
      /accountOperationReceipt/,
    );
    done(receiptCases[scenario]);
  }
}

export async function checkIntermediateKeySwitchSubmissionSurvivesALater(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
    'fullOwner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
      'ownerCredentials'
    > &
    Pick<
      Awaited<ReturnType<typeof checkAuthenticatedOwnerHoldingsAndBuiltInWallet>>,
      'approveFreshOwnerCeremony'
    >,
) {
  const { waitStatus, calls, state, archiveObservations, arm, done } = h;
  const { fullOwner, ownerCredentials, approveFreshOwnerCeremony } = input;
  await approve(fullOwner, 'unlockOwner');
  await waitStatus(fullOwner, /Account unlocked/);
  await fullOwner.evaluate(() => {
    (
      window as typeof window & {
        __partialOwnerRotation: boolean;
      }
    ).__partialOwnerRotation = true;
  });
  let releasePartial: () => void = () => {
    throw Error('Uninitialized fixture gate');
  };
  let observePartial: () => void = () => {
    throw Error('Uninitialized fixture gate');
  };
  const partialWait = new Promise<void>((resolve) => {
    releasePartial = resolve;
  });
  const partialObserved = new Promise<void>((resolve) => {
    observePartial = resolve;
  });
  h.flags.heldOwnerAction = 'rotation-tail';
  h.flags.holdOwnerReceipt = () => {
    observePartial();
    return partialWait;
  };
  const rotatesBeforePartial = calls.filter((call) => call === 'rotate').length;
  const credentialsBeforePartial = await ownerCredentials();
  await approve(fullOwner, 'rotate');
  await approveFreshOwnerCeremony();
  await partialObserved;
  const partialHash = state.txHash;
  assert.ok(
    await fullOwner.evaluate(
      (hash) =>
        Object.keys(localStorage).some(
          (key) => key.startsWith('passport-demo:transaction-receipt:v1:') && key.endsWith(hash),
        ),
      partialHash,
    ),
  );
  await fullOwner.evaluate(() => {
    (
      window as typeof window & {
        __sessionClockOffset: number;
      }
    ).__sessionClockOffset = 31 * 60000;
  });
  await fullOwner
    .locator('#routine-status')
    .filter({ hasText: /expired/ })
    .waitFor({ state: 'attached' });
  releasePartial();
  await waitStatus(fullOwner, /failed\./, /locked|expired/);
  assert.equal(await ownerCredentials(), credentialsBeforePartial + 1);
  assert.equal(calls.filter((call) => call === 'rotate').length, rotatesBeforePartial + 1);
  h.flags.heldOwnerAction = undefined;
  h.flags.holdOwnerReceipt = undefined;
  await archiveObservations(fullOwner, arm);
  await fullOwner.reload();
  await fullOwner
    .locator('#status')
    .filter({ hasText: /^Ready/ })
    .waitFor({ state: 'attached' });
  await observeCredentialAccess(fullOwner);
  await navClick(fullOwner, '#nav-audit');
  await reveal(fullOwner, '#trace');
  await fullOwner.locator('#trace').filter({ hasText: partialHash }).waitFor({ state: 'visible' });
  assert.match(
    (await fullOwner.locator('#trace').textContent()) ??
      (() => {
        throw new Error('Missing journey fixture value');
      })(),
    /account.transaction.retained/,
  );
  assert.equal(calls.filter((call) => call === 'rotate').length, rotatesBeforePartial + 1);
  done('owner-safety.intermediate-key-switch-submission-survives-a-later');
}

export async function checkPrivateHoldingsArrivingAfterOwnerLockAre(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
    'fullOwner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
      'ownerCredentials'
    >,
) {
  const { waitStatus, done } = h;
  const { fullOwner, ownerCredentials } = input;
  await approve(fullOwner, 'open');
  await waitStatus(fullOwner, /opened/);
  await approve(fullOwner, 'unlockOwner');
  await waitStatus(fullOwner, /Account unlocked/);
  const beforePrivateDisplay = await fullOwner.locator('#holdings-facts').textContent();
  await fullOwner.evaluate(() => {
    (
      window as typeof window & {
        __ownerReadValue: number;
      }
    ).__ownerReadValue = 99;
  });
  let releaseRead: () => void = () => {
    throw Error('Uninitialized fixture gate');
  };
  let observeRead: () => void = () => {
    throw Error('Uninitialized fixture gate');
  };
  const privateReadWait = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const privateReadObserved = new Promise<void>((resolve) => {
    observeRead = resolve;
  });
  h.flags.heldOwnerAction = 'holdings';
  h.flags.holdOwnerReceipt = () => {
    observeRead();
    return privateReadWait;
  };
  const credentialsBeforeRead = await ownerCredentials();
  await approve(fullOwner, 'holdings');
  await privateReadObserved;
  await fullOwner.evaluate(() => {
    (
      window as typeof window & {
        __sessionClockOffset: number;
      }
    ).__sessionClockOffset = 31 * 60000;
  });
  await fullOwner
    .locator('#routine-status')
    .filter({ hasText: /expired/ })
    .waitFor({ state: 'attached' });
  releaseRead();
  await waitStatus(fullOwner, /failed\./, /locked or expired/);
  assert.equal(await fullOwner.locator('#holdings-facts').textContent(), beforePrivateDisplay);
  assert.equal(await ownerCredentials(), credentialsBeforeRead);
  h.flags.heldOwnerAction = undefined;
  h.flags.holdOwnerReceipt = undefined;
  done('owner-safety.private-holdings-arriving-after-owner-lock-are');
}

export async function checkReceiptQuotaRefusesNewOwnerWorkBut(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
    'fullOwner'
  > &
    Pick<Awaited<ReturnType<typeof checkAccountFormsPreserveTheirValuesAcrossTabs>>, 'recipient'> &
    Pick<
      Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
      'ownerCredentials'
    >,
) {
  const { waitStatus, calls, done } = h;
  const { fullOwner, recipient, ownerCredentials } = input;
  await fullOwner.evaluate(() => {
    (
      window as typeof window & {
        __sessionClockOffset: number;
      }
    ).__sessionClockOffset = 0;
  });
  await approve(fullOwner, 'unlockOwner');
  await waitStatus(fullOwner, /Account unlocked/);
  await fill(fullOwner, '#withdraw-recipient', recipient);
  await fill(fullOwner, '#withdraw-amount', '1');
  await approve(fullOwner, 'startSession');
  await waitStatus(fullOwner, /JubJub session active/);
  await approve(fullOwner, 'wallet');
  await waitStatus(fullOwner, /wallet connected through/);
  const beforeStorageFaultCredentials = await ownerCredentials();
  const beforeStorageFaultRotations = calls.filter((call) => call === 'rotate').length;
  await fullOwner.evaluate(() => {
    const set = Storage.prototype.setItem;
    (
      window as typeof window & {
        __restoreReceiptSet: () => void;
      }
    ).__restoreReceiptSet = () => {
      Storage.prototype.setItem = set;
    };
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('passport-demo:transaction-receipt:v1:'))
        throw Error('Synthetic receipt quota');
      return set.call(this, key, value);
    };
  });
  await click(fullOwner, '#rotate');
  await waitStatus(fullOwner, /failed\./, /Synthetic receipt quota/);
  await click(fullOwner, '#walletRefresh');
  await waitStatus(fullOwner, /snapshot refreshed/);
  await click(fullOwner, '#endSession');
  await waitStatus(fullOwner, /Local session locked/);
  assert.equal(await ownerCredentials(), beforeStorageFaultCredentials);
  assert.equal(calls.filter((call) => call === 'rotate').length, beforeStorageFaultRotations);
  await fullOwner.evaluate(() => {
    (
      window as typeof window & {
        __restoreReceiptSet: () => void;
      }
    ).__restoreReceiptSet();
  });
  done('owner-safety.receipt-quota-refuses-new-owner-work-but');
}

export async function checkReceiptPersistenceFailureLocksBothLocalKey(
  h: JourneyHarness,
  input: Pick<
    Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
    'fullOwner'
  > &
    Pick<
      Awaited<ReturnType<typeof checkAuthenticatedOwnerHoldingsAndBuiltInWallet>>,
      'approveFreshOwnerCeremony'
    > &
    Pick<
      Awaited<ReturnType<typeof checkFullOwnerEnrollmentIsExplicitDecliningCreates>>,
      'ownerCredentials'
    >,
) {
  const { waitStatus, state, done } = h;
  const { fullOwner, approveFreshOwnerCeremony, ownerCredentials } = input;
  await approve(fullOwner, 'unlockOwner');
  await waitStatus(fullOwner, /Account unlocked/);
  await approve(fullOwner, 'revokeSession');
  await waitStatus(fullOwner, /Session grant revoked on chain/);
  await approve(fullOwner, 'startSession');
  await waitStatus(fullOwner, /JubJub session active/);
  let releaseStorageFault: () => void = () => {
      throw Error('Uninitialized fixture gate');
    },
    observeStorageFault!: () => void;
  const storageFaultWait = new Promise<void>((resolve) => {
    releaseStorageFault = resolve;
  });
  const storageFaultObserved = new Promise<void>((resolve) => {
    observeStorageFault = resolve;
  });
  h.flags.heldOwnerAction = 'rotate';
  h.flags.holdOwnerReceipt = () => {
    observeStorageFault();
    return storageFaultWait;
  };
  await approve(fullOwner, 'rotate');
  await approveFreshOwnerCeremony();
  await storageFaultObserved;
  const storageFaultHash = state.txHash;
  await fullOwner.evaluate(() => {
    const get = Storage.prototype.getItem;
    (
      window as typeof window & {
        __restoreReceiptGet: () => void;
      }
    ).__restoreReceiptGet = () => {
      Storage.prototype.getItem = get;
    };
    Storage.prototype.getItem = function (key) {
      if (
        key.startsWith('passport-demo:transaction-receipt:v1:') ||
        key.startsWith('passport-demo:session:v1:')
      )
        throw Error('Synthetic unreadable storage');
      return get.call(this, key);
    };
  });
  releaseStorageFault();
  await waitStatus(fullOwner, /Transaction receipt storage failed.*Copy Audit/);
  assert.match(
    (await fullOwner.locator('#routine-status').textContent()) ??
      (() => {
        throw new Error('Missing journey fixture value');
      })(),
    /locked/,
  );
  await fullOwner.evaluate(() => {
    (
      window as typeof window & {
        __restoreReceiptGet: () => void;
      }
    ).__restoreReceiptGet();
  });
  h.flags.heldOwnerAction = undefined;
  h.flags.holdOwnerReceipt = undefined;
  await navClick(fullOwner, '#nav-audit');
  await reveal(fullOwner, '#trace');
  await fullOwner
    .locator('#trace')
    .filter({ hasText: storageFaultHash })
    .waitFor({ state: 'visible' });
  const credentialsAfterStorageFailure = await ownerCredentials();
  await click(fullOwner, '#rotate');
  await waitStatus(fullOwner, /Transaction receipt storage failed.*Copy Audit/);
  assert.equal(await ownerCredentials(), credentialsAfterStorageFailure);
  done('owner-safety.receipt-persistence-failure-locks-both-local-key');
}
