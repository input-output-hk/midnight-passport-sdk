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
    `Name ${quote.name}`,
    `Network ${quote.networkId}`,
    `Passport account ${quote.accountAddress}`,
    `Registry ${quote.registryAddress}`,
    `Registry payee ${quote.registryPayee}`,
    `Future subdomain payment address ${quote.sponsorAddress}`,
    `Sponsor payment wallet ${quote.sponsorPaymentAddress}`,
    `Registry price ${quote.night} smallest NIGHT units`,
    `Maximum sponsor fee ${quote.maximumDust} SPECKs`,
    `Quote expires ${new Date(quote.expiresAt).toISOString()}`,
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
    prepare.textContent = recovering ? 'Recover prepared receipt' : 'Approve and prepare claim';
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
      const stored = currentReservation(reservation);
      if (await journal.read(registryAddress, name, credential)) {
        ensureAccount();
        clear();
        status.textContent = 'Original receipt is already saved.';
        return;
      }
      ensureAccount();
      if (button === review) {
        clear();
        const quote = stored?.quote ?? claimQuote(await host.quote(destination));
        ensureAccount();
        if (!matchesDestination(quote, destination) || (!stored && quote.expiresAt <= Date.now()))
          throw new Error('Claim quote differs from the current account or has expired.');
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
        status.textContent = 'Preparation response unavailable. Recover using the saved quote.';
        return;
      }
      const original = claimReceipt(result);
      if (
        !matchesDestination(original, selected) ||
        original.ownerCommitment !== owner ||
        original.quoteSha256 !== (await claimQuoteDigest(selected))
      )
        throw new Error('Prepared receipt differs from the original quote.');
      // A late reply is still retained for the captured credential, even if the UI locked.
      await journal.retain(original, credential, selected);
      ensureAccount();
      clear();
      status.textContent = 'Original receipt saved. Send the prepared claim when ready.';
    },
  };
}
