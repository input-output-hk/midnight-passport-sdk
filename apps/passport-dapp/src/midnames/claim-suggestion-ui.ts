import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { openClaimJournal } from './claim-journal.js';
import { claimDigest, type ClaimRecovery } from './claim-receipt.js';

async function suggestClaimName(
  recovery: ClaimRecovery,
  currentAccount: () => PassportAccount | undefined,
  name: HTMLInputElement,
  report: (message: string) => void,
) {
  const account = currentAccount();
  if (!account?.credentialId?.length || account.networkId !== 'undeployed') {
    report('Open the local Passport account with its passkey before choosing a name.');
    return;
  }
  if (name.value !== '') {
    report('Keep the current name or clear it before requesting a suggestion.');
    return;
  }
  const scope = await claimDigest(Uint8Array.from(account.credentialId));
  const journal = await openClaimJournal(indexedDB);
  try {
    const selected = await journal.readSelection(recovery.registryAddress, account.address, scope);
    if (account !== currentAccount() || name.value !== '') return;
    if (selected) {
      name.value = selected;
      report('Your earlier selected name is restored. Continue its original registration.');
      return;
    }
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    name.value = `demo-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}.night`;
    name.dispatchEvent(new Event('input', { bubbles: true }));
    report(
      'Suggestion only. Continue registration to check availability and review a claim quote.',
    );
  } finally {
    journal.close();
  }
}

export function installClaimSuggestion(
  button: HTMLButtonElement,
  recovery: ClaimRecovery,
  currentAccount: () => PassportAccount | undefined,
  name: HTMLInputElement,
  report: (message: string) => void,
  busy: () => boolean,
) {
  button.hidden = !recovery.preparation && !recovery.dispatch;
  button.addEventListener('click', () => {
    if (busy()) return;
    const account = currentAccount();
    void suggestClaimName(recovery, currentAccount, name, report).catch(() => {
      if (account === currentAccount())
        report('Name suggestion unavailable. Keep the original selection and try again later.');
    });
  });
}
