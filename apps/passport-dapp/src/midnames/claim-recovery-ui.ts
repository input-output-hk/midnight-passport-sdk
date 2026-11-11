import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { byId } from '../ui-dom.js';
import { openClaimJournal } from './claim-journal.js';
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
  const check = byId<HTMLButtonElement>('claim-recovery-check');
  const status = byId('claim-recovery-status');
  form.hidden = false;
  let busy = false;
  const messages = {
    pending: 'Claim pending. Check this original receipt again after the indexer catches up.',
    conflict: 'The registry owner or target differs from this receipt. Inspect the original claim.',
    registered: 'Registered. The original claim and current registry record match this account.',
  } as const;

  const availabilityMessages = {
    available: 'Available at the last registry read. The name stays open until a claim finalizes.',
    taken: 'This name is already registered.',
    unsupported: 'This Passport account is not active on the configured registry’s network.',
  } as const;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    busy = availability.disabled = retain.disabled = check.disabled = true;
    status.textContent = 'Checking claim details…';
    const account = currentAccount();
    const selected = normalizeClaimName(name.value);
    const checkingAvailability = event.submitter === availability;
    const saving = event.submitter === retain;
    const raw = receipt.value;
    name.disabled = receipt.disabled = true;
    const ensureAccount = () => {
      if (account !== currentAccount()) throw new Error('Account changed.');
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
        const original = await journal.read(recovery.registryAddress, selected, scope);
        ensureAccount();
        if (original?.accountAddress === account.address) {
          const result = await recovery.check(original);
          ensureAccount();
          status.textContent = messages[result];
          return;
        }
        if (original || !checkingAvailability) {
          status.textContent = 'Use the original account and receipt to check this claim.';
          return;
        }
        const result = await recovery.availability(selected, account.address);
        ensureAccount();
        status.textContent = availabilityMessages[result];
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
        busy = availability.disabled = retain.disabled = check.disabled = false;
        name.disabled = receipt.disabled = false;
      });
  });
  return () => {
    name.value = '';
    receipt.value = '';
    status.textContent = '';
  };
}
