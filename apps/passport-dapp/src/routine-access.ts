import { passkeyPrf } from '@input-output-hk/mn-passport-adapter-webauthn';
import type { JubjubDeviceCircuits } from '@input-output-hk/mn-passport-keys';
import { beforeDemoCeremony } from './consent.js';
import { createRoutineKeys, type RoutineAccount } from './routine-keys.js';

export const routineKeys = createRoutineKeys({
  unlock: (account, rpId) =>
    passkeyPrf({ credentialId: account.credentialId!, rpId, beforeCeremony: beforeDemoCeremony }),
  pure: async () =>
    (await import('./acc-module.js')).accModule.pureCircuits as JubjubDeviceCircuits,
});

// UI actions are serialized. Bind a passkey-free review to its exact lease until
// the operation finishes; expiry must refuse, never silently choose a new key path.
let reviewedLease: (() => void) | undefined;
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
export function beginRoutineReview(account: RoutineAccount | undefined, action: string) {
  reviewedLease =
    account &&
    (['holdings', 'wallet'].includes(action) ||
      (routineKeys.ownerSession(account) && OWNER_ACTIONS.includes(action)))
      ? routineKeys.lease(account)
      : undefined;
  return !!reviewedLease;
}
export function checkRoutineReview() {
  reviewedLease?.();
}
export function finishRoutineReview() {
  reviewedLease = undefined;
}
