import presentation from './presentation-cases.mjs';
import account from './account-cases.mjs';
import authority from './authority-cases.mjs';
/** @typedef {'presentation'|'account-actions'|'scoped-sessions'|'owner-safety'} JourneyGroup */
export const journeyGroups = Object.freeze([
  'presentation',
  'account-actions',
  'scoped-sessions',
  'owner-safety',
]);
export const journeyCatalog = Object.freeze(
  [...presentation, ...account, ...authority].map((row) =>
    Object.freeze({ ...row, arms: Object.freeze(row.arms) }),
  ),
);
/** @param {string} arm @param {string} [group] */
export function expectedCases(arm, group) {
  return Object.freeze(
    journeyCatalog.filter(
      (row) => row.arms.includes(arm) && (group === undefined || row.group === group),
    ),
  );
}
/** @param {string|undefined} arm @param {string|undefined} group @returns {JourneyGroup|undefined} */
export function journeySelection(arm, group) {
  if (group === undefined) return undefined;
  if (!journeyGroups.includes(group) || !['p256', 'jubjub'].includes(arm ?? ''))
    throw Error('Journey group needs one valid explicit arm and group');
  return /** @type {JourneyGroup} */ (group);
}
export const expiryCases = Object.freeze({
  holdings: 'account-actions.holdings-review-expiry-refuses-without-silently-requesting',
  wallet: 'account-actions.wallet-review-expiry-refuses-without-silently-requesting',
});
export const receiptCases = Object.freeze({
  rotate: 'owner-safety.confirmed-owner-rotate-retains-its-original-receipt',
  removeDevice: 'owner-safety.confirmed-owner-removedevice-retains-its-original-receipt',
  revokeGrant: 'owner-safety.confirmed-owner-revokegrant-retains-its-original-receipt',
  'indexer-outage': 'owner-safety.confirmed-owner-indexer-outage-retains-its-original',
});

export const bootstrapPlans = Object.freeze({
  presentation: Object.freeze([]),
  'account-actions': Object.freeze(['signed-out-page']),
  'scoped-sessions': Object.freeze(['create', 'wallet', 'fund', 'session-draft']),
  'owner-safety': Object.freeze(['prepareJoiner', 'wallet']),
});

/** Credential access depends on which actual UI flows a cell exercises.
 * @param {string} arm @param {string} [group] */
export function expectedCredentialPurposes(arm, group) {
  if (!['p256', 'jubjub'].includes(arm) || (group !== undefined && !journeyGroups.includes(group)))
    throw Error('Unknown credential-purpose cell');
  if (group === 'presentation') return [];
  return [
    'create',
    'derive-keys',
    'identify-and-unlock',
    ...(arm === 'p256' ? ['sign'] : []),
    // The isolated JubJub session bootstrap adopts creation keys. Other groups
    // also exercise independent registration flows that still verify creation.
    ...(arm === 'jubjub' && group === 'scoped-sessions' ? [] : ['verify-created']),
  ];
}
