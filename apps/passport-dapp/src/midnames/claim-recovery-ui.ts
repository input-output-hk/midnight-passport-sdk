import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { byId } from '../ui-dom.js';
import { openClaimJournal } from './claim-journal.js';
import {
  claimDigest,
  claimName,
  claimReceipt,
  claimReceiptLimit,
  type ClaimRecovery,
} from './claim-receipt.js';

export function showClaimRecovery(
  recovery: ClaimRecovery,
  currentAccount: () => PassportAccount | undefined,
): () => void {
  const form = byId<HTMLFormElement>('claim-recovery');
  const name = byId<HTMLInputElement>('claim-recovery-name');
  const receipt = byId<HTMLTextAreaElement>('claim-recovery-receipt');
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

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (busy) return;
    busy = retain.disabled = check.disabled = true;
    status.textContent = 'Checking claim details…';
    const account = currentAccount();
    const selected = name.value.trim().toLowerCase();
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
      if (!claimName(selected)) {
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
        if (!original || original.accountAddress !== account.address) {
          status.textContent = 'Save the sponsor’s original receipt for this account and name.';
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
        busy = retain.disabled = check.disabled = name.disabled = receipt.disabled = false;
      });
  });
  return () => {
    name.value = '';
    receipt.value = '';
    status.textContent = '';
  };
}
