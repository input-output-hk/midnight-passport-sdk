import { join } from 'node:path';
import {
  claimDestination,
  claimQuote,
  claimQuoteDigest,
  ClaimPreIntentRefusal,
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
import { admitNativeClaim } from '../../apps/passport-dapp/src/midnames/claim-native-admission.ts';
import { prepareSponsoredClaim } from '../../apps/passport-dapp/src/midnames/claim-sponsorship.ts';
import { openClaimDispatch, readClaimRecord } from './claim-dispatch.mts';
import { createOnce } from './create-once.mts';

export const claimPrepareLimit = 2 * 1024 * 1024 + claimReceiptLimit;

export interface ClaimSponsorPreparationPorts {
  issue(destination: ClaimDestination): Promise<ClaimQuote>;
  /** Recheck the approved price, payee, sponsor, target and availability before any balance. */
  authorizeQuote(quote: ClaimQuote): Promise<void>;
  balance(proof: Uint8Array): Promise<Uint8Array>;
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
    async issue(input: unknown) {
      const destination = claimDestination(input);
      const quote = claimQuote(await ports.issue(destination));
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
          if (quote.expiresAt <= Date.now()) throw new Error('The claim quote expired.');
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
          return ports.balance(proved);
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
