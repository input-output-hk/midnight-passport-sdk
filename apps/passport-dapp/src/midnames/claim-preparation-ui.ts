import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { byId } from '../ui-dom.js';
import type { ClaimJournal } from './claim-journal.js';
import {
  claimOwnerProof,
  ClaimPreIntentRefusal,
  claimQuote,
  claimQuoteDigest,
  matchesDestination,
  type ClaimPreparation,
  type ClaimQuote,
} from './claim-quote.js';
import { claimReceipt } from './claim-receipt.js';

interface PreparationContext {
  readonly account: PassportAccount;
  readonly name: string;
  readonly credential: string;
  readonly journal: ClaimJournal;
  ensureAccount(): void;
}

export function claimQuoteSummary(quote: ClaimQuote): string {
  return [
    `Register ${quote.name}`,
    `Registry price ${quote.night} smallest NIGHT units`,
    `Maximum sponsor fee ${quote.maximumDust} SPECKs`,
    `Quote expires ${new Date(quote.expiresAt).toISOString()}`,
    `Network ${quote.networkId}`,
    `Passport account ${quote.accountAddress}`,
    `Registry ${quote.registryAddress}`,
    `Registry payee ${quote.registryPayee}`,
    `Future subdomain payment address ${quote.sponsorAddress}`,
    `Sponsor payment wallet ${quote.sponsorPaymentAddress}`,
  ].join('\n');
}

const refusedBeforeIntent = Symbol('refused-before-intent');

async function preparationReply(
  request: Promise<unknown>,
  journal: ClaimJournal,
  quote: ClaimQuote,
  credential: string,
  owner: string,
): Promise<unknown> {
  try {
    return await request;
  } catch (error) {
    if (!(error instanceof ClaimPreIntentRefusal)) return undefined;
    await journal.releaseRefused(quote, credential, owner);
    return refusedBeforeIntent;
  }
}

function currentReservation(reservation: Awaited<ReturnType<ClaimJournal['readPreparation']>>) {
  return reservation && (reservation.ownerCommitment || reservation.quote.expiresAt > Date.now())
    ? reservation
    : undefined;
}

async function retireExpiredPreparation(
  host: ClaimPreparation,
  journal: ClaimJournal,
  quote: ClaimQuote,
  credential: string,
  owner: string,
  ensureAccount: () => void,
) {
  if (!host.retireExpiredUnprepared)
    throw new Error('The expired preparation needs sponsor recovery.');
  await host.retireExpiredUnprepared(quote, owner);
  ensureAccount();
  await journal.releaseExpiredUnprepared(quote, credential, owner);
}

async function savePrepared(
  result: unknown,
  journal: ClaimJournal,
  quote: ClaimQuote,
  credential: string,
  owner: string,
) {
  const original = claimReceipt(result);
  if (
    !matchesDestination(original, quote) ||
    original.ownerCommitment !== owner ||
    original.quoteSha256 !== (await claimQuoteDigest(quote))
  )
    throw new Error('Prepared receipt differs from the original quote.');
  await journal.retain(original, credential, quote);
}

async function recoverExpiredPreparation(
  host: ClaimPreparation,
  journal: ClaimJournal,
  quote: ClaimQuote,
  credential: string,
  owner: string,
  ensureAccount: () => void,
): Promise<'prepared' | 'released' | 'pending'> {
  const result = await preparationReply(
    host.findPrepared(quote, owner),
    journal,
    quote,
    credential,
    owner,
  );
  ensureAccount();
  if (result === refusedBeforeIntent) return 'released';
  if (result !== undefined) {
    await savePrepared(result, journal, quote, credential, owner);
    ensureAccount();
    return 'prepared';
  }
  try {
    await retireExpiredPreparation(host, journal, quote, credential, owner, ensureAccount);
    ensureAccount();
    return 'released';
  } catch {
    ensureAccount();
    return 'pending';
  }
}

export function showClaimPreparation(
  host: ClaimPreparation,
  registryAddress: string,
  status: HTMLElement,
  name: HTMLInputElement,
) {
  const review = byId<HTMLButtonElement>('claim-review-quote');
  const prepare = byId<HTMLButtonElement>('claim-prepare');
  const summary = byId('claim-quote-summary');
  review.hidden = false;
  let reviewed: { quote: ClaimQuote; account: PassportAccount } | undefined;

  function clear() {
    reviewed = undefined;
    prepare.hidden = true;
    summary.hidden = true;
    summary.textContent = '';
  }

  function display(quote: ClaimQuote, account: PassportAccount, recovering: boolean) {
    reviewed = { quote, account };
    summary.textContent = [
      claimQuoteSummary(quote),
      ...(recovering
        ? []
        : ['Preparing uses the open account’s passkey to derive the naming key.']),
    ].join('\n');
    summary.hidden = false;
    prepare.textContent = recovering ? 'Check saved claim' : 'Approve with passkey';
    prepare.hidden = false;
  }

  name.addEventListener('input', clear);
  return {
    clear,
    setBusy(value: boolean) {
      review.disabled = prepare.disabled = value;
    },
    handles(button: HTMLElement | null) {
      return button === review || button === prepare;
    },
    isReview(button: HTMLElement | null) {
      return button === review;
    },
    async run(button: HTMLElement | null, context: PreparationContext) {
      const { account, name, credential, journal, ensureAccount } = context;
      const destination = {
        networkId: 'undeployed' as const,
        registryAddress,
        accountAddress: account.address,
        name,
      };
      const reservation = await journal.readPreparation(registryAddress, name, credential);
      ensureAccount();
      let stored = currentReservation(reservation);
      if (await journal.read(registryAddress, name, credential)) {
        ensureAccount();
        clear();
        status.textContent = 'Original receipt is already saved.';
        return;
      }
      ensureAccount();
      if (button === review) {
        clear();
        if (stored?.ownerCommitment && stored.quote.expiresAt <= Date.now()) {
          const resolved = await recoverExpiredPreparation(
            host,
            journal,
            stored.quote,
            credential,
            stored.ownerCommitment,
            ensureAccount,
          );
          if (resolved === 'prepared') {
            status.textContent = 'Original receipt saved. Review the payment terms.';
            return;
          }
          if (resolved === 'pending') {
            display(stored.quote, account, true);
            status.textContent =
              'The original preparation is still unresolved. Continue registration to check it again.';
            return;
          }
          stored = undefined;
        }
        const quote = stored?.quote ?? claimQuote(await host.quote(destination));
        ensureAccount();
        if (!matchesDestination(quote, destination) || (!stored && quote.expiresAt <= Date.now()))
          throw new Error('Claim quote differs from the current account or has expired.');
        await journal.selectName(registryAddress, account.address, credential, name);
        ensureAccount();
        display(quote, account, !!stored?.ownerCommitment);
        status.textContent = stored
          ? 'The original quote is saved.'
          : 'Review the quote before preparing the claim.';
        return;
      }
      const selected = reviewed?.account === account ? reviewed.quote : undefined;
      if (!selected || !matchesDestination(selected, destination))
        throw new Error('Review the current claim quote first.');
      if (stored && JSON.stringify(stored.quote) !== JSON.stringify(selected)) {
        display(stored.quote, account, !!stored.ownerCommitment);
        status.textContent = 'Another tab saved a different quote. Review the original quote.';
        return;
      }
      if (!stored?.ownerCommitment && selected.expiresAt <= Date.now()) {
        clear();
        status.textContent = 'The quote expired. Review a fresh quote.';
        return;
      }
      let owner = stored?.ownerCommitment;
      let request: Promise<unknown>;
      if (owner) {
        request = host.findPrepared(selected, owner);
      } else {
        await journal.reserve(selected, credential);
        ensureAccount();
        const proved = claimOwnerProof(await host.prove(selected, account));
        ensureAccount();
        if (selected.expiresAt <= Date.now()) {
          status.textContent = 'The original quote expired before preparation.';
          return;
        }
        owner = proved.ownerCommitment;
        const first = await journal.bindOwner(selected, credential, owner);
        ensureAccount();
        request = first ? host.prepare(selected, proved) : host.findPrepared(selected, owner);
      }
      display(selected, account, true);
      const result = await preparationReply(request, journal, selected, credential, owner);
      if (result === refusedBeforeIntent) {
        ensureAccount();
        clear();
        status.textContent = 'The sponsor refused before preparation. Review a fresh quote.';
        return;
      }
      if (result === undefined) {
        ensureAccount();
        status.textContent =
          'The sponsor response is unavailable. Your original is saved; continue registration to check its result.';
        return;
      }
      // A late reply is still retained for the captured credential, even if the UI locked.
      await savePrepared(result, journal, selected, credential, owner);
      ensureAccount();
      clear();
      status.textContent = 'Original receipt saved. Send the prepared claim when ready.';
    },
  };
}
