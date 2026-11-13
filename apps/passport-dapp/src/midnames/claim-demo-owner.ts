import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { createLocalClaimPreparation } from './claim-preparation-transport.js';
import type { ClaimQuote, OwnerProvedClaim } from './claim-quote.js';

interface OwnerBundle {
  proveReviewedClaim(
    quote: ClaimQuote,
    credentialId: Uint8Array,
    check: () => void,
  ): Promise<OwnerProvedClaim>;
}

const ownerEntry = '/owner-claim/entry.js';

/** Opt-in, same-origin owner bundle. The proof port only receives the open credential. */
export function demoClaimPreparation(
  enabled: string | undefined,
  currentAccount: () => PassportAccount | undefined,
  load: () => Promise<OwnerBundle> = () => import(/* @vite-ignore */ ownerEntry),
) {
  if (enabled === undefined) return undefined;
  if (
    enabled !== '1' ||
    !/^http:\/\/localhost(?::[0-9]+)?$/.test(globalThis.location?.origin ?? '')
  )
    throw new Error('Owner proving requires the standalone demo on localhost.');
  return createLocalClaimPreparation(async (quote, account) => {
    if (!account.credentialId?.length) throw new Error('Open the account with its passkey first.');
    const credential = Uint8Array.from(account.credentialId);
    const check = () => {
      if (
        account !== currentAccount() ||
        account.networkId !== quote.networkId ||
        account.address !== quote.accountAddress ||
        account.credentialId?.length !== credential.length ||
        credential.some((byte, index) => account.credentialId?.[index] !== byte) ||
        quote.expiresAt <= Date.now()
      )
        throw new Error('The reviewed claim is no longer current.');
    };
    check();
    const owner = await load();
    check();
    const result = await owner.proveReviewedClaim(quote, credential.slice(), check);
    check();
    return result;
  });
}
