import { LedgerParameters, Transaction } from '@midnightntwrk/ledger-v9';
import { findStandaloneClaimCall } from './claim-call.js';
import type { ClaimReceipt } from './claim-receipt.js';
import { matchesRegistryCharge, type PaidClaimQuote } from './claim-sponsorship.js';

/** Check exact retained bytes against the standalone fixture's explicit DUST budget. */
export function admitNativeClaim(
  bytes: Uint8Array,
  receipt: ClaimReceipt,
  quote: PaidClaimQuote,
  feeCeiling: bigint,
  now = Date.now(),
) {
  const tx = Transaction.deserialize('signature', 'proof', 'binding', bytes);
  const actual = tx.identifiers();
  const expected = receipt.transaction.identifiers;
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index]))
    throw new Error('Finalized Ledger identifiers differ from the acknowledged receipt.');
  const call = findStandaloneClaimCall(tx, quote);
  const effects = call?.guaranteedTranscript?.effects ?? call?.fallibleTranscript?.effects;
  if (!effects || !matchesRegistryCharge(effects, quote))
    throw new Error('Finalized claim or NIGHT charge differs from the live quote.');
  const intents = [...(tx.intents?.values() ?? [])];
  const minimumTtl = Math.min(...intents.map(({ ttl }) => ttl.getTime()));
  if (!Number.isFinite(minimumTtl) || minimumTtl < now + 10_000)
    throw new Error('Claim expires too soon to dispatch.');
  const dust = intents.flatMap(({ dustActions }) => (dustActions ? [dustActions] : []));
  const spends = dust.flatMap(({ spends }) => spends);
  if (spends.length !== 2 || dust.some(({ registrations }) => registrations.length > 0))
    throw new Error('Standalone claim requires exactly two DUST spends.');
  const cost = tx.fees(LedgerParameters.initialParameters(), true);
  const paid = spends.reduce((total, spend) => total + spend.vFee, 0n);
  if (cost <= 0n || paid < cost || paid > feeCeiling)
    throw new Error('DUST payment is outside the sponsor budget.');
  return {
    dustSpends: spends.length,
    estimatedFee: String(cost),
    maximumDustCharged: String(paid),
  };
}
