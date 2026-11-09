import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type { JubjubDeviceCircuits } from '@input-output-hk/mn-passport-keys';
import type { createRoutineKeys, RoutineAccount } from './routine-keys.js';
import {
  CRITICAL_ACTIONS,
  CRITICAL_METHODS,
  routineAction,
  permitsCriticalMethod,
} from './credential-policy.js';
import { verifyCriticalOwner } from './critical-approval.js';

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

/** One reviewed action owns its credential scope and lease; there is no signer fallback. */
export function createRoutineReviews(ports: {
  keys: Pick<
    ReturnType<typeof createRoutineKeys>,
    'ownerSession' | 'lease' | 'credentialScope' | 'unlock'
  >;
  pure(): Promise<JubjubDeviceCircuits>;
  unlock(
    account: RoutineAccount,
    rpId: string,
  ): Promise<{ root: Uint8Array; authoriser: Uint8Array }>;
}) {
  const routineKeys = ports.keys;
  let reviewed:
    | {
        account: RoutineAccount;
        action: string;
        check: () => void;
        owner: ReturnType<typeof routineKeys.ownerSession>;
        scope: NonNullable<ReturnType<typeof routineKeys.credentialScope>>;
        fresh?: Promise<void>;
      }
    | undefined;

  /** UI actions are serialized; a review pins its lease and cannot silently choose another route. */
  function beginRoutineReview(account: RoutineAccount | undefined, action: string) {
    const owner = account && routineKeys.ownerSession(account);
    const lease =
      account &&
      (routineAction(action) || (owner && OWNER_ACTIONS.includes(action))) &&
      routineKeys.lease(account);
    const scope = account && routineKeys.credentialScope(account);
    reviewed =
      account && lease && scope ? { account, action, check: lease, owner, scope } : undefined;
    return !!reviewed;
  }
  function checkRoutineReview() {
    reviewed?.check();
  }
  function finishRoutineReview() {
    reviewed = undefined;
  }

  /** A locked private read explicitly reauthenticates once, then warms the same routine lease. */
  async function ensureRoutineReview(
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
  async function approveCriticalOwner(exportOpening = false) {
    const review = reviewed;
    if (!review?.owner || !CRITICAL_ACTIONS.has(review.action as import('./flows.js').ActionId))
      throw new Error(
        'Start a reviewed critical owner operation before requesting fresh approval.',
      );
    if (exportOpening && !['exportGrant', 'startSession'].includes(review.action))
      throw new Error('This review does not authorize exporting a grant opening.');
    const check = () => {
      if (
        reviewed !== review ||
        routineKeys.ownerSession(review.account) !== review.owner ||
        routineKeys.credentialScope(review.account) !== review.scope
      )
        throw new Error('The reviewed owner operation has ended or changed.');
      review.check();
    };
    check();
    review.fresh ??= verifyCriticalOwner({
      account: review.account,
      owner: review.owner,
      check,
      pure: ports.pure,
      unlock: () => ports.unlock(review.account, review.scope.rpId),
    });
    await review.fresh;
    check();
  }
  async function beforeAuthenticatedOperation(method: keyof PassportAccount) {
    if (!CRITICAL_METHODS.has(method)) return;
    if (
      !reviewed?.owner ||
      !permitsCriticalMethod(reviewed.action as import('./flows.js').ActionId, method)
    )
      throw new Error('Start a reviewed owner operation before requesting critical authority.');
    await approveCriticalOwner();
  }

  return {
    beginRoutineReview,
    checkRoutineReview,
    finishRoutineReview,
    ensureRoutineReview,
    approveCriticalOwner,
    beforeAuthenticatedOperation,
  };
}
