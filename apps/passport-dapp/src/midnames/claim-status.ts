import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type { ClaimRecovery } from './claim-receipt.js';

export function claimReport(
  status: HTMLElement,
  currentAccount: () => PassportAccount | undefined,
  onSetupStatus?: (message: string) => void,
) {
  return (message: string) => {
    status.textContent = message;
    onSetupStatus?.(
      message.startsWith('Registered.')
        ? message
        : `${currentAccount() ? 'Passport setup pending. ' : ''}Name registration. ${message}`,
    );
  };
}

export function initialClaimStatus(recovery: ClaimRecovery, account: PassportAccount | undefined) {
  if (!account) return 'Open an account with its passkey.';
  return recovery.preparation || recovery.dispatch
    ? 'Choose a .night name for this account.'
    : 'Read-only .night profile. Check or retain an existing original receipt; claiming is unavailable.';
}
