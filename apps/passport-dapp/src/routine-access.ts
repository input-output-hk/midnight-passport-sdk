import { passkeyPrf } from '@input-output-hk/mn-passport-adapter-webauthn';
import type { BrowserLoginKeys } from '@input-output-hk/mn-passport-adapter-browser';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type { JubjubDeviceCircuits } from '@input-output-hk/mn-passport-keys';
import { beforeDemoCeremony } from './consent.js';
import { createRoutineKeys, type RoutineAccount } from './routine-keys.js';
import {
  CRITICAL_ACTIONS,
  CRITICAL_METHODS,
  routineAction,
  permitsCriticalMethod,
} from './credential-policy.js';
import { verifyCriticalOwner } from './critical-approval.js';

const pure = async () =>
  (await import('./acc-module.js')).accModule.pureCircuits as JubjubDeviceCircuits;
const unlock = (account: RoutineAccount, rpId: string) => {
  if (!account.credentialId) throw new Error('Open a passkey-backed account first.');
  return passkeyPrf({
    credentialId: account.credentialId,
    rpId,
    beforeCeremony: beforeDemoCeremony,
  });
};
export const routineKeys = createRoutineKeys({ unlock, pure });
export const OWNER_ACTIONS = [
  'holdings',
  'wallet',
  'roster',
  'grantRoster',
  'issueGrant',
  'exportGrant',
  'revokeGrant',
  'recoverGrants',
  'enrollDevice',
  'removeDevice',
  'rotate',
  'withdraw',
  'startSession',
  'revokeSession',
];
let reviewed:
  | {
      account: RoutineAccount;
      action: string;
      check: () => void;
      owner: ReturnType<typeof routineKeys.ownerSession>;
      fresh?: Promise<void>;
    }
  | undefined;

/** UI actions are serialized; a review pins its lease and cannot silently choose another route. */
export function beginRoutineReview(account: RoutineAccount | undefined, action: string) {
  const owner = account && routineKeys.ownerSession(account);
  const lease =
    account &&
    (routineAction(action) || (owner && OWNER_ACTIONS.includes(action))) &&
    routineKeys.lease(account);
  reviewed = account && lease ? { account, action, check: lease, owner } : undefined;
  return !!reviewed;
}
export function checkRoutineReview() {
  reviewed?.check();
}
export function finishRoutineReview() {
  reviewed = undefined;
}

/** A locked private read explicitly reauthenticates once, then warms the same routine lease. */
export async function ensureRoutineReview(
  account: RoutineAccount | undefined,
  action: string,
  alreadyReviewed: boolean,
  minutes: number,
  rpId: string,
  origin: string,
) {
  if (!account || !routineAction(action) || alreadyReviewed) return;
  await routineKeys.unlock(account, minutes, rpId, origin);
  if (!beginRoutineReview(account, action))
    throw new Error('Routine reauthentication did not complete.');
  checkRoutineReview();
}

/** Only cached owner actions need this extra gate; primary signers already request fresh access. */
export async function approveCriticalOwner(exportOpening = false) {
  const review = reviewed;
  if (!review?.owner || !CRITICAL_ACTIONS.has(review.action as import('./flows.js').ActionId))
    throw new Error('Start a reviewed critical owner operation before requesting fresh approval.');
  if (exportOpening && !['exportGrant', 'startSession'].includes(review.action))
    throw new Error('This review does not authorize exporting a grant opening.');
  const check = () => {
    if (reviewed !== review || routineKeys.ownerSession(review.account) !== review.owner)
      throw new Error('The reviewed owner operation has ended or changed.');
    review.check();
  };
  check();
  review.fresh ??= verifyCriticalOwner({
    account: review.account,
    owner: review.owner,
    check,
    pure,
    unlock: () => unlock(review.account, 'localhost'),
  });
  await review.fresh;
  check();
}
export async function beforeAuthenticatedOperation(method: keyof PassportAccount) {
  if (!CRITICAL_METHODS.has(method)) return;
  if (
    !reviewed?.owner ||
    !permitsCriticalMethod(reviewed.action as import('./flows.js').ActionId, method)
  )
    throw new Error('Start a reviewed owner operation before requesting critical authority.');
  await approveCriticalOwner();
}

let login:
  | {
      accept: ReturnType<typeof routineKeys.prepareLogin>;
      minutes: number;
    }
  | undefined;
/** Consent to login includes a bounded routine lease, never owner enrollment or a wallet connection. */
export async function withRoutineLogin<T>(minutes: number, work: () => Promise<T>): Promise<T> {
  if (login) throw new Error('Another login is active.');
  const attempt = { accept: routineKeys.prepareLogin(), minutes };
  login = attempt;
  try {
    return await work();
  } catch (error) {
    routineKeys.lock();
    throw error;
  } finally {
    if (login === attempt) login = undefined;
  }
}
export async function acceptRoutineLogin(
  account: PassportAccount,
  keys: BrowserLoginKeys,
  rpId: string,
  origin: string,
) {
  const attempt = login;
  if (!attempt) return;
  await attempt.accept(account, keys.deriveWalletSeed(), attempt.minutes, rpId, origin);
  if (login !== attempt) {
    routineKeys.lock();
    throw new Error('Login ended before routine key adoption.');
  }
}
