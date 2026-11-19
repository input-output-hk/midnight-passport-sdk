import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  claimDestination,
  claimQuote,
  claimQuoteDigest,
  ClaimPreIntentRefusal,
  ClaimSponsorBusy,
  matchesDestination,
  type ClaimDestination,
  type ClaimQuote,
} from '../../apps/passport-dapp/src/midnames/claim-quote.ts';
import {
  claimDigest,
  claimHex,
  claimReceipt,
  claimReceiptLimit,
  type ClaimReceipt,
} from '../../apps/passport-dapp/src/midnames/claim-receipt.ts';
import {
  admitNativeClaim,
  preparedClaimExpired,
} from '../../apps/passport-dapp/src/midnames/claim-native-admission.ts';
import { prepareSponsoredClaim } from '../../apps/passport-dapp/src/midnames/claim-sponsorship.ts';
import { openClaimDispatch, readClaimRecord } from './claim-dispatch.mts';
import { createOnce } from './create-once.mts';

export const claimPrepareLimit = 2 * 1024 * 1024 + claimReceiptLimit;
const minimumQuoteRemaining = 2 * 60_000;

/** Balance with enough time for deliberate browser review, within the reviewed quote. */
export function claimBalanceTtl(quoteExpiresAt: number, now = Date.now()): Date {
  if (quoteExpiresAt - now < minimumQuoteRemaining)
    throw new Error('The claim quote has too little time left for preparation and review.');
  return new Date(quoteExpiresAt);
}

export function claimRetiredArchivePath(directory: string, receipt: ClaimReceipt): string {
  return join(
    dirname(directory),
    `claim-journal-retired-${claimReceipt(receipt).transaction.sha256}`,
  );
}

export function claimUnpreparedArchivePath(directory: string, quote: ClaimQuote): string {
  return join(dirname(directory), `claim-journal-unprepared-${claimQuote(quote).id}`);
}

export interface ClaimSponsorPreparationPorts {
  issue(destination: ClaimDestination): Promise<ClaimQuote>;
  /** Recheck the approved price, payee, sponsor, target and availability before any balance. */
  authorizeQuote(quote: ClaimQuote): Promise<void>;
  balance(proof: Uint8Array, ttl: Date): Promise<Uint8Array>;
  /** Confirm the exact expired original was never indexed and its name remains free. */
  retireExpiredUnsent?: (receipt: ClaimReceipt) => Promise<void>;
  /** Recheck the registry before archiving an expired intent with no transaction. */
  retireExpiredUnprepared?: (quote: ClaimQuote) => Promise<void>;
}

function recordOnce(path: string, record: unknown): boolean {
  try {
    createOnce(path, JSON.stringify(record));
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  }
}

function requestFields(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('quote' in value) ||
    !('ownerCommitment' in value) ||
    !claimHex(value.ownerCommitment)
  )
    throw new Error('Invalid claim preparation request.');
  return { quote: claimQuote(value.quote), ownerCommitment: value.ownerCommitment };
}

/** One original balance operation in the same private directory as its dispatch journal. */
export function createClaimPreparationJournal(
  directory: string,
  dispatch: ReturnType<typeof openClaimDispatch>,
  ports: ClaimSponsorPreparationPorts,
) {
  const intentPath = join(directory, 'claim-prepare-intent.json');
  const quotePath = (id: string) => join(directory, 'quote-' + id + '.json');
  const decisionPath = (id: string) => join(directory, 'quote-decision-' + id + '.json');
  const unpreparedRetiredPath = (id: string) =>
    join(directory, 'quote-unprepared-retired-' + id + '.json');

  function wasUnpreparedRetired(id: string, digest: string, ownerCommitment: string): boolean {
    const marker = readClaimRecord(unpreparedRetiredPath(id), claimReceiptLimit);
    if (marker === undefined) return false;
    if (
      !marker ||
      typeof marker !== 'object' ||
      !('digest' in marker) ||
      marker.digest !== digest ||
      !('ownerCommitment' in marker) ||
      marker.ownerCommitment !== ownerCommitment
    )
      throw new Error('Retired quote differs from its original.');
    return true;
  }

  function wasRefused(id: string, digest: string): boolean {
    const marker = readClaimRecord(decisionPath(id), claimReceiptLimit);
    if (marker === undefined) return false;
    if (
      !marker ||
      typeof marker !== 'object' ||
      !('kind' in marker) ||
      !('digest' in marker) ||
      marker.digest !== digest ||
      !['refused', 'intent'].includes(String(marker.kind))
    )
      throw new Error('Claim decision differs from the original quote.');
    return marker.kind === 'refused';
  }

  function refuseBeforeIntent(id: string, digest: string): never {
    if (readClaimRecord(intentPath, claimReceiptLimit) !== undefined)
      throw new Error('The original preparation may already have started.');
    if (!recordOnce(decisionPath(id), { kind: 'refused', digest }) && !wasRefused(id, digest))
      throw new Error('The original preparation may already have started.');
    throw new ClaimPreIntentRefusal('The sponsor refused before any balance intent.');
  }

  function refuseQuoteSupersededByOriginal(id: string, digest: string): void {
    const intent = readClaimRecord(intentPath, claimReceiptLimit);
    if (intent === undefined) return;
    if (
      !intent ||
      typeof intent !== 'object' ||
      !('quoteId' in intent) ||
      !claimHex(intent.quoteId)
    )
      throw new Error('The original preparation record is unavailable.');
    if (intent.quoteId === id) return;
    // An older quote cannot have entered this sponsor's one balance intent.
    // Refuse that exact quote durably so its browser can release only its own
    // unprepared reservation; never alter the occupying original or its fence.
    if (dispatch.preparedReceipt()?.quoteSha256 === digest)
      throw new Error('The original prepared receipt differs from its intent.');
    if (!recordOnce(decisionPath(id), { kind: 'refused', digest }) && !wasRefused(id, digest)) {
      const decision = readClaimRecord(decisionPath(id), claimReceiptLimit);
      if (
        !decision ||
        typeof decision !== 'object' ||
        !('kind' in decision) ||
        !('digest' in decision) ||
        !('ownerCommitment' in decision) ||
        !('proofSha256' in decision) ||
        decision.kind !== 'intent' ||
        decision.digest !== digest ||
        !claimHex(decision.ownerCommitment) ||
        !claimHex(decision.proofSha256)
      )
        throw new Error('The quote decision differs from its original.');
      // This quote wrote its decision before the competing original claimed
      // intentPath. Because intentPath is create-once, its different quote ID
      // proves this quote never reached ports.balance.
    }
    throw new ClaimPreIntentRefusal('The sponsor refused before any balance intent.');
  }

  async function approved(input: unknown) {
    const { quote, ownerCommitment } = requestFields(input);
    const issued = claimQuote(readClaimRecord(quotePath(quote.id), claimReceiptLimit));
    if (JSON.stringify(issued) !== JSON.stringify(quote))
      throw new Error('Claim quote was not issued by this sponsor.');
    const digest = await claimQuoteDigest(quote);
    return { quote, ownerCommitment, digest };
  }

  function find(quoteId: string, digest: string, ownerCommitment: string, proofSha256?: string) {
    const value = readClaimRecord(intentPath, claimReceiptLimit);
    if (value === undefined) return undefined;
    if (
      !value ||
      typeof value !== 'object' ||
      !('digest' in value) ||
      !('ownerCommitment' in value) ||
      !('proofSha256' in value) ||
      !('quoteId' in value) ||
      value.quoteId !== quoteId ||
      value.digest !== digest ||
      value.ownerCommitment !== ownerCommitment ||
      !claimHex(value.proofSha256) ||
      (proofSha256 && value.proofSha256 !== proofSha256)
    )
      throw new Error('A different original preparation is recorded.');
    const receipt = dispatch.preparedReceipt();
    if (receipt && (receipt.quoteSha256 !== digest || receipt.ownerCommitment !== ownerCommitment))
      throw new Error('The original prepared receipt differs from its intent.');
    return { receipt };
  }

  return {
    async retireExpiredUnprepared(input: unknown) {
      if (!ports.retireExpiredUnprepared)
        throw new Error('Expired unprepared claim retirement is unavailable.');
      const { quote, ownerCommitment } = requestFields(input);
      const digest = await claimQuoteDigest(quote);
      const archive = claimUnpreparedArchivePath(directory, quote);
      if (existsSync(archive)) {
        const archived = openClaimDispatch(archive);
        const archivedQuote = readClaimRecord(
          join(archive, `quote-${quote.id}.json`),
          claimReceiptLimit,
        );
        const archivedIntent = readClaimRecord(
          join(archive, 'claim-prepare-intent.json'),
          claimReceiptLimit,
        );
        if (
          JSON.stringify(archivedQuote) !== JSON.stringify(quote) ||
          !archivedIntent ||
          typeof archivedIntent !== 'object' ||
          !('digest' in archivedIntent) ||
          !('ownerCommitment' in archivedIntent) ||
          archivedIntent.digest !== digest ||
          archivedIntent.ownerCommitment !== ownerCommitment ||
          archived.preparedReceipt() !== undefined ||
          archived.hasAnyFence()
        )
          throw new Error('Archived unprepared claim differs from the original.');
        return { status: 'retired' as const };
      }
      await approved(input);
      if (wasUnpreparedRetired(quote.id, digest, ownerCommitment))
        return { status: 'retired' as const };
      const noIntent = () =>
        quote.expiresAt <= Date.now() &&
        readClaimRecord(intentPath, claimReceiptLimit) === undefined &&
        readClaimRecord(decisionPath(quote.id), claimReceiptLimit) === undefined &&
        dispatch.preparedReceipt() === undefined &&
        !dispatch.hasAnyFence();
      if (noIntent()) {
        await ports.retireExpiredUnprepared(quote);
        if (!noIntent()) throw new Error('The original quote changed during retirement.');
        const marker = { digest, ownerCommitment };
        if (
          !recordOnce(unpreparedRetiredPath(quote.id), marker) &&
          !wasUnpreparedRetired(quote.id, digest, ownerCommitment)
        )
          throw new Error('The retired quote differs from its original.');
        return { status: 'retired' as const };
      }
      const isUnprepared = () => {
        const intent = readClaimRecord(intentPath, claimReceiptLimit);
        const decision = readClaimRecord(decisionPath(quote.id), claimReceiptLimit);
        return (
          quote.expiresAt <= Date.now() &&
          !!intent &&
          typeof intent === 'object' &&
          'quoteId' in intent &&
          intent.quoteId === quote.id &&
          'digest' in intent &&
          intent.digest === digest &&
          'ownerCommitment' in intent &&
          intent.ownerCommitment === ownerCommitment &&
          'proofSha256' in intent &&
          claimHex(intent.proofSha256) &&
          !!decision &&
          typeof decision === 'object' &&
          'kind' in decision &&
          decision.kind === 'intent' &&
          'digest' in decision &&
          decision.digest === digest &&
          'ownerCommitment' in decision &&
          decision.ownerCommitment === ownerCommitment &&
          'proofSha256' in decision &&
          decision.proofSha256 === intent.proofSha256 &&
          dispatch.preparedReceipt() === undefined &&
          !dispatch.hasAnyFence()
        );
      };
      if (!isUnprepared())
        throw new Error('The original claim is not an expired, unprepared intent.');
      await ports.retireExpiredUnprepared(quote);
      if (!isUnprepared()) throw new Error('The original claim changed during retirement.');
      renameSync(directory, archive);
      mkdirSync(directory, { mode: 0o700 });
      const parent = openSync(dirname(directory), 'r');
      try {
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
      return { status: 'retired' as const };
    },
    async retireExpiredUnsent(input: unknown) {
      if (!ports.retireExpiredUnsent)
        throw new Error('Expired unsent claim retirement is unavailable.');
      const receipt = claimReceipt(input);
      const archive = claimRetiredArchivePath(directory, receipt);
      if (existsSync(archive)) {
        const archived = openClaimDispatch(archive).preparedReceipt();
        if (JSON.stringify(archived) !== JSON.stringify(receipt))
          throw new Error('Retired claim receipt differs.');
        return { status: 'retired' as const };
      }
      const intent = readClaimRecord(intentPath, claimReceiptLimit);
      if (
        !intent ||
        typeof intent !== 'object' ||
        !('quoteId' in intent) ||
        !claimHex(intent.quoteId)
      )
        throw new Error('The original claim preparation is unavailable.');
      const quote = claimQuote(readClaimRecord(quotePath(intent.quoteId), claimReceiptLimit));
      const digest = await claimQuoteDigest(quote);
      const bytes = dispatch.preparedBytes(receipt);
      if (
        !bytes ||
        (quote.expiresAt > Date.now() && !preparedClaimExpired(bytes)) ||
        receipt.quoteSha256 !== digest ||
        !matchesDestination(receipt, quote) ||
        !find(quote.id, digest, receipt.ownerCommitment)?.receipt ||
        JSON.stringify(dispatch.preparedReceipt()) !== JSON.stringify(receipt) ||
        dispatch.hasFence(receipt)
      )
        throw new Error('The original claim is not an expired, unsent preparation.');
      await ports.retireExpiredUnsent(receipt);
      // Recheck after the asynchronous chain read, while the HTTP handler excludes
      // concurrent dispatch, then atomically retain the entire private journal.
      if (
        dispatch.hasFence(receipt) ||
        JSON.stringify(dispatch.preparedReceipt()) !== JSON.stringify(receipt)
      )
        throw new Error('The original claim changed during retirement.');
      renameSync(directory, archive);
      mkdirSync(directory, { mode: 0o700 });
      const parent = openSync(dirname(directory), 'r');
      try {
        fsyncSync(parent);
      } finally {
        closeSync(parent);
      }
      return { status: 'retired' as const };
    },
    async issue(input: unknown) {
      const destination = claimDestination(input);
      const busy = () =>
        readClaimRecord(intentPath, claimReceiptLimit) !== undefined ||
        dispatch.preparedReceipt() !== undefined;
      if (busy()) throw new ClaimSponsorBusy('The sponsor has an unresolved original claim.');
      const quote = claimQuote(await ports.issue(destination));
      if (busy()) throw new ClaimSponsorBusy('The sponsor has an unresolved original claim.');
      if (!matchesDestination(quote, destination) || quote.expiresAt <= Date.now())
        throw new Error('The sponsor cannot issue this quote.');
      const path = quotePath(quote.id);
      if (
        !recordOnce(path, quote) &&
        JSON.stringify(claimQuote(readClaimRecord(path, claimReceiptLimit))) !==
          JSON.stringify(quote)
      )
        throw new Error('Quote ID already identifies different terms.');
      return quote;
    },
    async findPrepared(input: unknown) {
      const { quote, digest, ownerCommitment } = await approved(input);
      if (wasUnpreparedRetired(quote.id, digest, ownerCommitment))
        throw new ClaimPreIntentRefusal(
          'The sponsor retired this quote before any balance intent.',
        );
      refuseQuoteSupersededByOriginal(quote.id, digest);
      const result = find(quote.id, digest, ownerCommitment);
      if (!result && wasRefused(quote.id, digest))
        throw new ClaimPreIntentRefusal('The sponsor refused before any balance intent.');
      return result;
    },
    async authorizeDispatch(bytes: Uint8Array, receipt: ClaimReceipt) {
      const intent = readClaimRecord(intentPath, claimReceiptLimit);
      if (
        !intent ||
        typeof intent !== 'object' ||
        !('quoteId' in intent) ||
        !claimHex(intent.quoteId)
      )
        throw new Error('The original claim quote is unavailable.');
      const quote = claimQuote(readClaimRecord(quotePath(intent.quoteId), claimReceiptLimit));
      const digest = await claimQuoteDigest(quote);
      if (
        receipt.quoteSha256 !== digest ||
        !matchesDestination(receipt, quote) ||
        !find(quote.id, digest, receipt.ownerCommitment)?.receipt
      )
        throw new Error('The dispatch differs from the original quote.');
      await ports.authorizeQuote(quote);
      if (quote.expiresAt <= Date.now()) throw new Error('The claim quote expired.');
      const paid = {
        ...quote,
        ownerCommitment: receipt.ownerCommitment,
        night: BigInt(quote.night),
      };
      admitNativeClaim(bytes, receipt, paid, BigInt(quote.maximumDust));
    },
    async prepare(input: unknown) {
      const { quote, digest, ownerCommitment } = await approved(input);
      if (wasUnpreparedRetired(quote.id, digest, ownerCommitment))
        throw new ClaimPreIntentRefusal(
          'The sponsor retired this quote before any balance intent.',
        );
      const proof = (input as { proof?: unknown }).proof;
      if (
        typeof proof !== 'string' ||
        !proof.length ||
        proof.length > 2 * 1024 * 1024 ||
        proof.length % 2 ||
        !/^[0-9a-f]+$/.test(proof)
      )
        throw new Error('Invalid proved transaction bytes.');
      const bytes = Buffer.from(proof, 'hex');
      const proofSha256 = await claimDigest(bytes);
      refuseQuoteSupersededByOriginal(quote.id, digest);
      const previous = find(quote.id, digest, ownerCommitment, proofSha256);
      if (previous) return previous;
      if (wasRefused(quote.id, digest))
        throw new ClaimPreIntentRefusal('The sponsor refused before any balance intent.');
      if (dispatch.preparedReceipt()) throw new Error('This claim cannot be prepared.');
      if (quote.expiresAt <= Date.now()) refuseBeforeIntent(quote.id, digest);
      try {
        await ports.authorizeQuote(quote);
      } catch {
        refuseBeforeIntent(quote.id, digest);
      }
      const paid = { ...quote, ownerCommitment, night: BigInt(quote.night) };
      const occupied = new Error('Preparation already started.');
      let enteredBalance = false;
      try {
        const prepared = await prepareSponsoredClaim(paid, bytes, async (proved) => {
          const ttl = claimBalanceTtl(quote.expiresAt);
          if (
            !recordOnce(decisionPath(quote.id), {
              kind: 'intent',
              digest,
              ownerCommitment,
              proofSha256,
            })
          ) {
            if (wasRefused(quote.id, digest))
              throw new ClaimPreIntentRefusal('The sponsor refused before any balance intent.');
            throw occupied;
          }
          enteredBalance = true;
          if (!recordOnce(intentPath, { quoteId: quote.id, digest, ownerCommitment, proofSha256 }))
            throw occupied;
          return ports.balance(proved, ttl);
        });
        const receipt = claimReceipt({ ...prepared.receipt, quoteSha256: digest });
        admitNativeClaim(prepared.bytes, receipt, paid, BigInt(quote.maximumDust));
        dispatch.retain(prepared.bytes, receipt);
        return { receipt };
      } catch (error) {
        if (!enteredBalance && readClaimRecord(intentPath, claimReceiptLimit) === undefined)
          refuseBeforeIntent(quote.id, digest);
        if (error !== occupied) throw error;
        const result = find(quote.id, digest, ownerCommitment, proofSha256);
        if (!result) throw new Error('The original preparation record is unavailable.');
        return result;
      }
    },
  };
}
