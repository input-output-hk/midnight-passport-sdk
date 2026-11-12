import type { ActionId } from './flows.js';
export const ACTIONS: readonly ActionId[] = [
  'unlockRoutine',
  'unlockOwner',
  'startSession',
  'endSession',
  'revokeSession',
  'recoverSessionWithdrawal',
  'create',
  'open',
  'openAt',
  'refresh',
  'holdings',
  'roster',
  'grantRoster',
  'prepareGrantee',
  'issueGrant',
  'exportGrant',
  'spendGrant',
  'revokeGrant',
  'recoverGrants',
  'prepareJoiner',
  'enrollDevice',
  'removeDevice',
  'rotate',
  'wallet',
  'walletRefresh',
  'fund',
  'withdraw',
];
export const byId = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`index.html has no element with id "${id}"`);
  return element as T;
};
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export const clockTime = (t: number) =>
  new Date(t).toLocaleTimeString('en-GB', { hour12: false, timeStyle: 'medium' });
export const shorten = (value: string, head = 8, tail = 6): string =>
  value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
export function createUiDom() {
  const buttons = Object.fromEntries(ACTIONS.map((a) => [a, byId<HTMLButtonElement>(a)])) as Record<
    ActionId,
    HTMLButtonElement
  >;
  const copyButton = byId<HTMLButtonElement>('copy');
  const handoffInput = byId<HTMLTextAreaElement>('handoff-input');
  const removalInput = byId<HTMLInputElement>('remove-commitment');
  const handoffOutput = byId<HTMLTextAreaElement>('handoff-output');
  const statusEl = byId('status');
  const announceEl = byId('announce');
  const progressEl = byId('progress');
  const progressLabel = byId('progress-label');
  const elapsedEl = byId('elapsed');
  const logEl = byId('log');
  const logEmpty = byId('log-empty');
  const evidenceEl = byId('evidence');
  const traceEl = byId('trace');
  const evidenceDetails = evidenceEl.closest('details');
  const traceDetails = traceEl.closest('details');
  const fundingSelect = byId<HTMLSelectElement>('fund-asset');
  const withdrawalSelect = byId<HTMLSelectElement>('withdraw-asset');
  const withdrawalAmount = byId<HTMLInputElement>('withdraw-amount');
  const withdrawalRecipient = byId<HTMLInputElement>('withdraw-recipient');
  const grantGrantee = byId<HTMLInputElement>('grant-grantee');
  const grantAsset = byId<HTMLSelectElement>('grant-asset');
  const grantRecipient = byId<HTMLInputElement>('grant-recipient');
  const grantPerCall = byId<HTMLInputElement>('grant-per-call');
  const grantCap = byId<HTMLInputElement>('grant-cap');
  const revokeGrantId = byId<HTMLInputElement>('revoke-grant-id');
  const exportGrantId = byId<HTMLInputElement>('export-grant-id');
  const grantOpeningInput = byId<HTMLTextAreaElement>('grant-opening-input');
  const grantSpendAmount = byId<HTMLInputElement>('grant-spend-amount');
  const grantSpentPrev = byId<HTMLInputElement>('grant-spent-prev');
  const knownAddress = byId<HTMLInputElement>('open-address');
  return {
    buttons,
    copyButton,
    handoffInput,
    removalInput,
    handoffOutput,
    statusEl,
    announceEl,
    progressEl,
    progressLabel,
    elapsedEl,
    logEl,
    logEmpty,
    evidenceEl,
    traceEl,
    evidenceDetails,
    traceDetails,
    fundingSelect,
    withdrawalSelect,
    withdrawalAmount,
    withdrawalRecipient,
    grantGrantee,
    grantAsset,
    grantRecipient,
    grantPerCall,
    grantCap,
    revokeGrantId,
    exportGrantId,
    grantOpeningInput,
    grantSpendAmount,
    grantSpentPrev,
    knownAddress,
  };
}
