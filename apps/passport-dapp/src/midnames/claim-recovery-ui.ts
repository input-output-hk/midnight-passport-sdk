import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { byId } from '../ui-dom.js';
import { openClaimJournal } from './claim-journal.js';
import { showClaimPreparation } from './claim-preparation-ui.js';
import { createClaimSendReview } from './claim-send-review.js';
import {
  claimDigest,
  claimReceipt,
  claimReceiptLimit,
  normalizeClaimName,
  type ClaimRecovery,
} from './claim-receipt.js';

const messages = {
  pending: 'Claim pending. Check this original receipt again after the indexer catches up.',
  conflict:
    'The original transaction failed, or its claim differs from the registry owner or target. Inspect the original claim.',
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

async function restoreSelection(
  recovery: ClaimRecovery,
  currentAccount: () => PassportAccount | undefined,
  name: HTMLInputElement,
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
    report('Name changed. Check the selected name before claiming.');
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    busy = availability.disabled = retain.disabled = check.disabled = send.disabled = true;
    preparation?.setBusy(true);
    report('Checking claim details…');
    const account = currentAccount();
    const selected = normalizeClaimName(name.value);
    const checkingAvailability = event.submitter === availability;
    const saving = event.submitter === retain;
    const sending = event.submitter === send;
    if (!sending) sendReview.clear();
    const raw = receipt.value;
    name.disabled = receipt.disabled = true;
    const ensureAccount = () => assertClaimContext(account, currentAccount, selected, name);
    void (async () => {
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
        if (preparation?.handles(event.submitter)) {
          await preparation.run(event.submitter, {
            account,
            name: selected,
            credential: scope,
            journal,
            ensureAccount,
          });
          return;
        }
        if (saving) {
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
          receipt.value = '';
          report('Original receipt saved. Check it after the sponsor sends the claim.');
          return;
        }
        const readOriginal = () => journal.read(recovery.registryAddress, selected, scope);
        let original = await readOriginal();
        ensureAccount();
        if (!original && checkingAvailability) {
          const result = await recovery
            .availability(selected, account.address)
            .catch(() => undefined);
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
          report('Save the original claim receipt on this device first.');
          return;
        }
        if (original.accountAddress !== account.address) {
          report('Use the original account and receipt to check this claim.');
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
        report(messages[result]);
      } finally {
        journal.close();
      }
    })()
      .catch((error: unknown) => {
        if (account !== currentAccount()) return;
        report(
          claimConflict(error) ??
            'Claim check unavailable. Keep the original receipt and verify the open account, name and registry.',
        );
      })
      .finally(() => {
        preparation?.setBusy(false);
        busy = availability.disabled = retain.disabled = check.disabled = send.disabled = false;
        name.disabled = receipt.disabled = false;
        if (account === currentAccount() && status.textContent) report(status.textContent);
      });
  });
  return () => {
    sendReview.clear();
    preparation?.clear();
    name.value = '';
    receipt.value = '';
    const account = currentAccount();
    report(initialClaimStatus(recovery, account));
    void restoreSelection(recovery, currentAccount, name, report);
  };
}
