import {
  Proof,
  Transaction,
  type Effects,
  type Signaturish,
  type UnshieldedOffer,
} from '@midnightntwrk/ledger-v9';
import { findStandaloneClaimCall } from './claim-call.js';
import {
  claimDigest,
  claimHex,
  claimName,
  claimReceipt,
  type ClaimScope,
} from './claim-receipt.js';

export interface PaidClaimQuote extends ClaimScope {
  readonly registryPayee: string;
  readonly night: bigint;
}

const nightType = '00'.repeat(32);
const sizeLimit = 1024 * 1024;

function isNight(token: { tag: string; raw?: string }): boolean {
  return token.tag === 'unshielded' && token.raw === nightType;
}

function matchesNight(
  entries: ReadonlyMap<{ tag: string; raw?: string }, bigint>,
  amount: bigint,
): boolean {
  if (entries.size !== 1) return false;
  for (const [token, value] of entries) return isNight(token) && value === amount;
  return false;
}

export function matchesRegistryCharge(effects: Effects, quote: PaidClaimQuote): boolean {
  const payments = [...effects.claimedUnshieldedSpends];
  const [payment] = payments;
  return (
    quote.night > 0n &&
    matchesNight(effects.unshieldedInputs, quote.night) &&
    matchesNight(effects.unshieldedOutputs, quote.night) &&
    payments.length === 1 &&
    !!payment &&
    isNight(payment[0][0]) &&
    payment[0][1].tag === 'user' &&
    payment[0][1].address === quote.registryPayee &&
    payment[1] === quote.night &&
    effects.claimedNullifiers.length === 0 &&
    effects.claimedShieldedReceives.length === 0 &&
    effects.claimedShieldedSpends.length === 0 &&
    effects.claimedContractCalls.length === 0 &&
    effects.shieldedMints.size === 0 &&
    effects.unshieldedMints.size === 0
  );
}

export function matchesOwnerOffer(
  offer: UnshieldedOffer<Signaturish> | undefined,
  quote: PaidClaimQuote,
): boolean {
  const outputs = offer?.outputs ?? [];
  const [output] = outputs;
  return (
    !!offer &&
    offer.inputs.length === 0 &&
    offer.signatures.length === 0 &&
    outputs.length === 1 &&
    !!output &&
    output.type === nightType &&
    output.owner === quote.registryPayee &&
    output.value === quote.night
  );
}

function checkedCall(tx: ReturnType<typeof Transaction.deserialize>, quote: PaidClaimQuote) {
  if (tx.rewards || tx.guaranteedOffer || tx.fallibleOffer?.size)
    throw new Error('Unexpected claim transaction components.');
  const call = findStandaloneClaimCall(tx, quote);
  const proof = call?.proof;
  const guaranteed = call?.guaranteedTranscript;
  const fallible = call?.fallibleTranscript;
  const transcript = guaranteed ?? fallible;
  if (
    !call ||
    !(proof instanceof Proof) ||
    !transcript ||
    (guaranteed && fallible) ||
    !matchesRegistryCharge(transcript.effects, quote)
  ) {
    throw new Error('Claim proof or registry charge differs from the quote.');
  }
  return {
    proof,
    communicationCommitment: call.communicationCommitment,
    phase: guaranteed ? ('guaranteed' as const) : ('fallible' as const),
  };
}

function checkBytes(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > sizeLimit)
    throw new Error('Invalid claim transaction size.');
}

/**
 * Inspect the standalone owner-proved claim and the corresponding sponsored
 * bytes. The caller still owns live proof validation, fee policy and dispatch.
 */
export async function prepareSponsoredClaim(
  quote: PaidClaimQuote,
  ownerProved: Uint8Array,
  balance: (proved: Uint8Array) => Promise<Uint8Array>,
) {
  const expected = Object.freeze({ ...quote });
  if (
    expected.networkId !== 'undeployed' ||
    !claimName(expected.name) ||
    ![
      expected.registryAddress,
      expected.accountAddress,
      expected.ownerCommitment,
      expected.registryPayee,
    ].every(claimHex) ||
    typeof expected.night !== 'bigint' ||
    expected.night <= 0n ||
    expected.night >= 1n << 128n
  )
    throw new Error('Invalid standalone claim quote.');

  checkBytes(ownerProved);
  const original = new Uint8Array(ownerProved);
  const owner = Transaction.deserialize('signature', 'proof', 'pre-binding', original);
  const [intent] = owner.intents?.values() ?? [];
  const ownerCall = checkedCall(owner, expected);
  const guaranteed = ownerCall.phase === 'guaranteed';
  const offer = guaranteed ? intent?.guaranteedUnshieldedOffer : intent?.fallibleUnshieldedOffer;
  const extra = guaranteed ? intent?.fallibleUnshieldedOffer : intent?.guaranteedUnshieldedOffer;
  if (
    owner.intents?.size !== 1 ||
    !intent ||
    intent.dustActions ||
    extra ||
    !matchesOwnerOffer(offer, expected)
  )
    throw new Error('Owner proof must contain only the registration call and its quoted output.');
  const ownerProof = await claimDigest(ownerCall.proof.serialize());
  const sponsored = await balance(original);
  checkBytes(sponsored);
  const bytes = new Uint8Array(sponsored);
  const finalized = Transaction.deserialize('signature', 'proof', 'binding', bytes);
  const finalizedCall = checkedCall(finalized, expected);
  if (
    finalizedCall.phase !== ownerCall.phase ||
    finalizedCall.communicationCommitment !== ownerCall.communicationCommitment ||
    (await claimDigest(finalizedCall.proof.serialize())) !== ownerProof
  )
    throw new Error('Sponsor changed the owner-proved call.');
  const receipt = claimReceipt({
    ...expected,
    transaction: { identifiers: finalized.identifiers(), sha256: await claimDigest(bytes) },
  });
  return { bytes, receipt };
}
