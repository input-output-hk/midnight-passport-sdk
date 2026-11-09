import { passkeyPrf } from '@input-output-hk/mn-passport-adapter-webauthn';
import type { BrowserLoginKeys } from '@input-output-hk/mn-passport-adapter-browser';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type { JubjubDeviceCircuits } from '@input-output-hk/mn-passport-keys';
import { beforeDemoCeremony } from './consent.js';
import { createRoutineKeys, type RoutineAccount } from './routine-keys.js';
import { createRoutineReviews } from './routine-review.js';
export { OWNER_ACTIONS } from './routine-review.js';

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
export const {
  beginRoutineReview,
  checkRoutineReview,
  finishRoutineReview,
  ensureRoutineReview,
  approveCriticalOwner,
  beforeAuthenticatedOperation,
} = createRoutineReviews({ keys: routineKeys, pure, unlock });

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
