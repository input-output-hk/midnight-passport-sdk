import { Proof, Transaction, type Effects } from '@midnightntwrk/ledger-v9';
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

function checkedCall(tx: ReturnType<typeof Transaction.deserialize>, quote: PaidClaimQuote) {
  if (tx.rewards || tx.guaranteedOffer || tx.fallibleOffer?.size)
    throw new Error('Unexpected claim transaction components.');
  const call = findStandaloneClaimCall(tx, quote);
  const proof = call?.proof;
  if (
    !(proof instanceof Proof) ||
    !call?.guaranteedTranscript ||
    call.fallibleTranscript ||
    !matchesRegistryCharge(call.guaranteedTranscript.effects, quote)
  ) {
    throw new Error('Claim proof or registry charge differs from the quote.');
  }
  return { proof, communicationCommitment: call.communicationCommitment };
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
  if (
    owner.intents?.size !== 1 ||
    !intent ||
    intent.dustActions ||
    intent.guaranteedUnshieldedOffer ||
    intent.fallibleUnshieldedOffer
  )
    throw new Error('Owner proof must contain only the registration call.');
  const ownerCall = checkedCall(owner, expected);
  const ownerProof = await claimDigest(ownerCall.proof.serialize());
  const sponsored = await balance(original);
  checkBytes(sponsored);
  const bytes = new Uint8Array(sponsored);
  const finalized = Transaction.deserialize('signature', 'proof', 'binding', bytes);
  const finalizedCall = checkedCall(finalized, expected);
  if (
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
