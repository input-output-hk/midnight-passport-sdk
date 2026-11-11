import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { byId } from '../ui-dom.js';
import { openClaimJournal } from './claim-journal.js';
import { showClaimPreparation } from './claim-preparation-ui.js';
import {
  claimDigest,
  claimReceipt,
  claimReceiptLimit,
  normalizeClaimName,
  type ClaimRecovery,
} from './claim-receipt.js';

export function showClaimRecovery(
  recovery: ClaimRecovery,
  currentAccount: () => PassportAccount | undefined,
): () => void {
  const form = byId<HTMLFormElement>('claim-recovery');
  const name = byId<HTMLInputElement>('claim-recovery-name');
  const receipt = byId<HTMLTextAreaElement>('claim-recovery-receipt');
  const availability = byId<HTMLButtonElement>('claim-check-availability');
  const retain = byId<HTMLButtonElement>('claim-recovery-retain');
  const send = byId<HTMLButtonElement>('claim-dispatch');
  send.hidden = !recovery.dispatch;
  const check = byId<HTMLButtonElement>('claim-recovery-check');
  const status = byId('claim-recovery-status');
  const preparation =
    recovery.preparation &&
    showClaimPreparation(recovery.preparation, recovery.registryAddress, status, name);
  form.hidden = false;
  let busy = false;
  const messages = {
    pending: 'Claim pending. Check this original receipt again after the indexer catches up.',
    conflict: 'The registry owner or target differs from this receipt. Inspect the original claim.',
    registered: 'Registered. The original claim and current registry record match this account.',
  } as const;

  const availabilityMessages = {
    available: 'Unregistered at the last registry read. Registration is a separate step.',
    taken: 'This name is already registered.',
    unsupported: 'This Passport account is not active on the configured registry’s network.',
  } as const;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    busy = availability.disabled = retain.disabled = check.disabled = send.disabled = true;
    preparation?.setBusy(true);
    status.textContent = 'Checking claim details…';
    const account = currentAccount();
    const selected = normalizeClaimName(name.value);
    const checkingAvailability = event.submitter === availability;
    const saving = event.submitter === retain;
    const sending = event.submitter === send;
    const raw = receipt.value;
    name.disabled = receipt.disabled = true;
    const ensureAccount = () => {
      if (account !== currentAccount() || selected !== normalizeClaimName(name.value))
        throw new Error('Claim context changed.');
    };
    void (async () => {
      if (account?.networkId !== 'undeployed' || !account.credentialId?.length) {
        status.textContent = 'Open this Passport account with its passkey first.';
        return;
      }
      if (!selected) {
        status.textContent = 'Enter a single label ending in .night.';
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
          status.textContent =
            'Original receipt saved. Check it after the sponsor sends the claim.';
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
            status.textContent = availabilityMessages[result];
            return;
          }
        }
        if (!original) {
          status.textContent = 'Save the original claim receipt on this device first.';
          return;
        }
        if (original.accountAddress !== account.address) {
          status.textContent = 'Use the original account and receipt to check this claim.';
          return;
        }
        if (sending && recovery.dispatch) {
          // Journal read above is the acknowledgement. A transport failure leaves
          // the same receipt available for reconciliation on this device.
          await recovery.dispatch(original).catch(() => undefined);
          ensureAccount();
          status.textContent = messages.pending;
          return;
        }
        const result = await recovery.check(original);
        ensureAccount();
        status.textContent = messages[result];
      } finally {
        journal.close();
      }
    })()
      .catch(() => {
        if (account !== currentAccount()) return;
        status.textContent =
          'Claim check unavailable. Keep the original receipt and verify the open account, name and registry.';
      })
      .finally(() => {
        preparation?.setBusy(false);
        busy = availability.disabled = retain.disabled = check.disabled = send.disabled = false;
        name.disabled = receipt.disabled = false;
      });
  });
  return () => {
    preparation?.clear();
    name.value = '';
    receipt.value = '';
    status.textContent = '';
  };
}
