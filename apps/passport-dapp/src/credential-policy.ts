import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type { ActionId } from './flows.js';

/** Host UX policy; an enrolled JubJub owner still has durable on-chain owner authority. */
export const CRITICAL_ACTIONS = new Set<ActionId>([
  'issueGrant',
  'exportGrant',
  'revokeGrant',
  'recoverGrants',
  'enrollDevice',
  'removeDevice',
  'rotate',
  'startSession',
  'revokeSession',
  'withdraw',
]);
export const CRITICAL_METHODS = new Set<keyof PassportAccount>([
  'issueGrant',
  'revokeGrant',
  'revokeAllGrants',
  'recoverPendingGrants',
  'addDevice',
  'removeDevice',
  'rotateViewingKey',
  'rotateEncryptionKey',
  'withdrawUnshielded',
  'withdrawShielded',
]);
export const routineAction = (action: string) => action === 'holdings' || action === 'wallet';

const methods: Partial<Record<ActionId, readonly (keyof PassportAccount)[]>> = {
  issueGrant: ['issueGrant'],
  revokeGrant: ['revokeGrant'],
  recoverGrants: ['recoverPendingGrants'],
  enrollDevice: ['addDevice'],
  removeDevice: ['removeDevice'],
  rotate: ['rotateViewingKey', 'rotateEncryptionKey'],
  startSession: ['issueGrant'],
  revokeSession: ['revokeGrant'],
  withdraw: ['withdrawUnshielded', 'withdrawShielded'],
};
export const permitsCriticalMethod = (action: ActionId, method: keyof PassportAccount) =>
  methods[action]?.includes(method) === true;
