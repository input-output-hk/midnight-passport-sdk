import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { claimQuoteSummary } from './claim-preparation-ui.js';
import { reviewedDispatchQuote, type ClaimQuote } from './claim-quote.js';
import type { ClaimJournal } from './claim-journal.js';
import type { ClaimReceipt } from './claim-receipt.js';

/** Require a second deliberate click after showing the exact saved payment terms. */
export function createClaimSendReview(send: HTMLButtonElement, summary: HTMLElement) {
  let reviewed: { account: PassportAccount; receipt: string; quoteSha256: string } | undefined;
  function clear() {
    if (reviewed) {
      summary.hidden = true;
      summary.textContent = '';
    }
    reviewed = undefined;
    send.textContent = 'Send prepared claim';
  }
  function confirm(account: PassportAccount, receipt: ClaimReceipt, quote: ClaimQuote): boolean {
    const digest = receipt.quoteSha256;
    if (!digest) throw new Error('The saved quote digest is missing.');
    const key = JSON.stringify(receipt);
    if (
      reviewed?.account !== account ||
      reviewed.receipt !== key ||
      reviewed.quoteSha256 !== digest
    ) {
      reviewed = { account, receipt: key, quoteSha256: digest };
      summary.textContent = claimQuoteSummary(quote);
      summary.hidden = false;
      send.textContent = 'Confirm reviewed terms and send';
      return false;
    }
    clear();
    return true;
  }
  return {
    clear,
    async ready(
      account: PassportAccount,
      receipt: ClaimReceipt,
      journal: ClaimJournal,
      credential: string,
      ensureAccount: () => void,
      status: HTMLElement,
    ): Promise<boolean> {
      const saved = await journal.readPreparation(
        receipt.registryAddress,
        receipt.name,
        credential,
      );
      const quote = await reviewedDispatchQuote(receipt, saved);
      ensureAccount();
      if (!quote) {
        clear();
        status.textContent =
          'This receipt has no matching reviewed quote. It can be checked, but cannot be sent.';
        return false;
      }
      if (quote.expiresAt <= Date.now()) {
        clear();
        status.textContent = 'The original quote expired. Check the receipt; do not send it.';
        return false;
      }
      if (!confirm(account, receipt, quote)) {
        status.textContent = 'Review the saved payment terms above, then confirm the send.';
        return false;
      }
      return true;
    },
  };
}
