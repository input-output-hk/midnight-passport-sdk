import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { byId } from '../ui-dom.js';
import { openClaimJournal, type ClaimJournal } from './claim-journal.js';
import { showClaimPreparation } from './claim-preparation-ui.js';
import { createClaimSendReview } from './claim-send-review.js';
import {
  claimDigest,
  claimReceipt,
  claimReceiptLimit,
  normalizeClaimName,
  type ClaimReceipt,
  type ClaimRecovery,
} from './claim-receipt.js';

const messages = {
  pending: 'Claim pending. Check this original receipt again after the indexer catches up.',
  conflict:
    'The original transaction or current registry binding conflicts with this claim. Preserve and inspect the original receipt.',
  failed:
    'The exact original transaction failed and the name is unregistered. You can explicitly release this attempt, then review a fresh claim quote.',
  'claim-failed':
    'The exact registration claim failed while the sponsor fee succeeded. The name is unregistered. You can explicitly release this attempt, then review a fresh quote; the fee is not returned.',
  registered: 'Registered. The original claim and current registry record match this account.',
  unavailable: 'Name service unavailable. Keep the original receipt and check it again later.',
} as const;

const availabilityMessages = {
  available: 'Unregistered at the last registry read. Registration is a separate step.',
  taken: 'This name is already registered.',
  unsupported: 'This Passport account is not active on the configured registry’s network.',
} as const;

function claimConflict(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if (error.message === 'This failed original was already released. Review a fresh claim.')
    return error.message;
  if (error.message === 'A different original claim is retained for this name.')
    return 'A different original claim is retained for this name. Inspect the original claim and credential before another attempt.';
  return /^(?:Multiple original claims require manual recovery|Recover the original claim before (?:choosing|reserving) another name|A different name is selected for this ACC)\.$/.test(
    error.message,
  )
    ? `${error.message} Enter the original name to inspect its claim.`
    : undefined;
}

function claimReport(status: HTMLElement, onSetupStatus?: (message: string) => void) {
  return (message: string) => {
    status.textContent = message;
    onSetupStatus?.(
      message.startsWith('Registered.') ? message : `Pending Passport setup. ${message}`,
    );
  };
}

function initialClaimStatus(recovery: ClaimRecovery, account: PassportAccount | undefined): string {
  if (!account) return 'Open an account with its passkey.';
  return recovery.preparation || recovery.dispatch
    ? 'Choose a .night name for this account.'
    : 'Read-only .night profile. Check or retain an existing original receipt; claiming is unavailable.';
}

function assertClaimContext(
  account: PassportAccount | undefined,
  currentAccount: () => PassportAccount | undefined,
  selected: string | undefined,
  name: HTMLInputElement,
) {
  if (account !== currentAccount() || selected !== normalizeClaimName(name.value))
    throw new Error('Claim context changed.');
}

async function saveOriginalReceipt(
  raw: string,
  selected: string,
  recovery: ClaimRecovery,
  account: PassportAccount,
  scope: string,
  journal: ClaimJournal,
  ensureAccount: () => void,
) {
  if (raw.length > claimReceiptLimit) throw new Error('Receipt is too large.');
  const original = claimReceipt(JSON.parse(raw));
  if (
    original.name !== selected ||
    original.registryAddress !== recovery.registryAddress ||
    original.accountAddress !== account.address
  )
    throw new Error('Receipt scope differs.');
  await journal.retain(original, scope);
  ensureAccount();
}

async function releaseVerifiedFailure(
  recovery: ClaimRecovery,
  journal: ClaimJournal,
  original: ClaimReceipt,
  account: PassportAccount,
  selected: string,
  scope: string,
  ensureAccount: () => void,
) {
  const result = await recovery.check(original).catch(() => 'unavailable' as const);
  if (result !== 'failed' && result !== 'claim-failed')
    throw new Error('The original failure is no longer confirmed. Preserve its receipt.');
  ensureAccount();
  const availability = await recovery
    .availability(selected, account.address)
    .catch(() => undefined);
  ensureAccount();
  if (availability !== 'available')
    throw new Error('Registry availability is not confirmed. Preserve the original receipt.');
  if ((await recovery.check(original).catch(() => 'unavailable' as const)) !== result)
    throw new Error('The original failure changed. Preserve its receipt.');
  ensureAccount();
  await journal.releaseFailed(
    original,
    scope,
    result === 'claim-failed' ? 'CLAIM_SEGMENT_FAILURE' : 'FAILURE',
  );
  ensureAccount();
}

async function restoreSelection(
  recovery: ClaimRecovery,
  currentAccount: () => PassportAccount | undefined,
  name: HTMLInputElement,
  release: HTMLButtonElement,
  report: (message: string) => void,
): Promise<void> {
  const account = currentAccount();
  const credentialId = account?.credentialId && Uint8Array.from(account.credentialId);
  if (!account || !credentialId?.length || account.networkId !== 'undeployed') return;
  try {
    const scope = await claimDigest(credentialId);
    const journal = await openClaimJournal(indexedDB);
    try {
      const selected = await journal.readSelection(
        recovery.registryAddress,
        account.address,
        scope,
      );
      if (account !== currentAccount() || name.value !== '' || !selected) return;
      name.value = selected;
      const original = await journal.read(recovery.registryAddress, selected, scope);
      if (account !== currentAccount() || name.value !== selected) return;
      if (!original) {
        report(
          'The selected name is pending. Review the claim quote or recover the original preparation.',
        );
        return;
      }
      if (original.accountAddress !== account.address) {
        report(
          'The retained claim belongs to another Passport ACC. Open that account to recover it.',
        );
        return;
      }
      const result = await recovery.check(original).catch(() => 'unavailable' as const);
      if (account !== currentAccount() || name.value !== selected) return;
      release.hidden = result !== 'failed' && result !== 'claim-failed';
      report(messages[result]);
    } finally {
      journal.close();
    }
  } catch (error) {
    if (account === currentAccount())
      report(
        claimConflict(error) ??
          'Claim state unavailable. Preserve this browser’s data and inspect the original claim.',
      );
  }
}

interface ClaimActionContext {
  readonly recovery: ClaimRecovery;
  readonly account: PassportAccount | undefined;
  readonly selected: string | undefined;
  readonly submitter: HTMLElement | null;
  readonly raw: string;
  readonly receipt: HTMLTextAreaElement;
  readonly availability: HTMLButtonElement;
  readonly retain: HTMLButtonElement;
  readonly send: HTMLButtonElement;
  readonly release: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly report: (message: string) => void;
  readonly preparation: ReturnType<typeof showClaimPreparation> | undefined;
  readonly sendReview: ReturnType<typeof createClaimSendReview>;
  readonly ensureAccount: () => void;
}

async function runClaimAction(context: ClaimActionContext): Promise<void> {
  const {
    recovery,
    account,
    selected,
    submitter,
    raw,
    receipt,
    availability,
    retain,
    send,
    release,
    status,
    report,
    preparation,
    sendReview,
    ensureAccount,
  } = context;
  const checkingAvailability = submitter === availability;
  const saving = submitter === retain;
  const sending = submitter === send;
  const releasing = submitter === release;
  if (account?.networkId !== 'undeployed' || !account.credentialId?.length) {
    report('Open this Passport account with its passkey first.');
    return;
  }
  if (!selected) {
    report('Enter a single label ending in .night.');
    return;
  }
  const scope = await claimDigest(account.credentialId);
  ensureAccount();
  const journal = await openClaimJournal(indexedDB);
  try {
    ensureAccount();
    if (preparation?.handles(submitter)) {
      await preparation.run(submitter, {
        account,
        name: selected,
        credential: scope,
        journal,
        ensureAccount,
      });
      return;
    }
    if (saving) {
      await saveOriginalReceipt(raw, selected, recovery, account, scope, journal, ensureAccount);
      receipt.value = '';
      report('Original receipt saved. Check it after the sponsor sends the claim.');
      return;
    }
    const readOriginal = () => journal.read(recovery.registryAddress, selected, scope);
    let original = await readOriginal();
    ensureAccount();
    if (!original && checkingAvailability) {
      const result = await recovery.availability(selected, account.address).catch(() => undefined);
      ensureAccount();
      // A different tab may have retained a receipt during the registry read.
      original = await readOriginal();
      ensureAccount();
      if (!original) {
        if (result === undefined) throw new Error('Registry read failed.');
        report(availabilityMessages[result]);
        return;
      }
    }
    if (!original) {
      const history = await journal.readReleased(
        recovery.registryAddress,
        selected,
        account.address,
        scope,
      );
      ensureAccount();
      if (history.length) {
        receipt.value = JSON.stringify(history.at(-1));
        report('A failed original is retained in local history. Review a fresh claim quote.');
        return;
      }
      report('Save the original claim receipt on this device first.');
      return;
    }
    if (original.accountAddress !== account.address) {
      report('Use the original account and receipt to check this claim.');
      return;
    }
    if (releasing) {
      if (release.hidden) throw new Error('Check the failed original before release.');
      // A failed recheck must not leave the previous failure observation actionable.
      release.hidden = true;
      await releaseVerifiedFailure(
        recovery,
        journal,
        original,
        account,
        selected,
        scope,
        ensureAccount,
      );
      preparation?.clear();
      sendReview.clear();
      release.hidden = true;
      receipt.value = JSON.stringify(original);
      report('Failed original retained in local history. Review a fresh claim quote to retry.');
      return;
    }
    if (sending && recovery.dispatch) {
      if (!(await sendReview.ready(account, original, journal, scope, ensureAccount, status)))
        return;
      // Journal read above is the acknowledgement. A transport failure leaves
      // the same receipt available for reconciliation on this device.
      await recovery.dispatch(original).catch(() => undefined);
      ensureAccount();
      report(messages.pending);
      return;
    }
    const result = await recovery.check(original).catch(() => 'unavailable' as const);
    ensureAccount();
    release.hidden = result !== 'failed' && result !== 'claim-failed';
    report(messages[result]);
  } finally {
    journal.close();
  }
}

export function showClaimRecovery(
  recovery: ClaimRecovery,
  currentAccount: () => PassportAccount | undefined,
  onSetupStatus?: (message: string) => void,
): () => void {
  const form = byId<HTMLFormElement>('claim-recovery');
  const name = byId<HTMLInputElement>('claim-recovery-name');
  const receipt = byId<HTMLTextAreaElement>('claim-recovery-receipt');
  const availability = byId<HTMLButtonElement>('claim-check-availability');
  const retain = byId<HTMLButtonElement>('claim-recovery-retain');
  const send = byId<HTMLButtonElement>('claim-dispatch');
  const quoteSummary = byId('claim-quote-summary');
  send.hidden = !recovery.dispatch;
  const check = byId<HTMLButtonElement>('claim-recovery-check');
  const release = byId<HTMLButtonElement>('claim-release-failed');
  const status = byId('claim-recovery-status');
  const report = claimReport(status, onSetupStatus);
  const preparation =
    recovery.preparation &&
    showClaimPreparation(recovery.preparation, recovery.registryAddress, status, name);
  const sendReview = createClaimSendReview(send, quoteSummary);
  form.hidden = false;
  let busy = false;
  name.addEventListener('input', () => {
    sendReview.clear();
    release.hidden = true;
    report('Name changed. Check the selected name before claiming.');
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    busy =
      availability.disabled =
      retain.disabled =
      check.disabled =
      send.disabled =
      release.disabled =
        true;
    preparation?.setBusy(true);
    report('Checking claim details…');
    const account = currentAccount();
    const selected = normalizeClaimName(name.value);
    if (event.submitter !== send) sendReview.clear();
    name.disabled = receipt.disabled = true;
    const ensureAccount = () => assertClaimContext(account, currentAccount, selected, name);
    void runClaimAction({
      recovery,
      account,
      selected,
      submitter: event.submitter,
      raw: receipt.value,
      receipt,
      availability,
      retain,
      send,
      release,
      status,
      report,
      preparation,
      sendReview,
      ensureAccount,
    })
      .catch((error: unknown) => {
        if (account !== currentAccount()) return;
        report(
          claimConflict(error) ??
            'Claim check unavailable. Keep the original receipt and verify the open account, name and registry.',
        );
      })
      .finally(() => {
        preparation?.setBusy(false);
        busy =
          availability.disabled =
          retain.disabled =
          check.disabled =
          send.disabled =
          release.disabled =
            false;
        name.disabled = receipt.disabled = false;
        if (account === currentAccount() && status.textContent) report(status.textContent);
      });
  });
  return () => {
    sendReview.clear();
    preparation?.clear();
    name.value = '';
    receipt.value = '';
    release.hidden = true;
    const account = currentAccount();
    report(initialClaimStatus(recovery, account));
    void restoreSelection(recovery, currentAccount, name, release, report);
  };
}
