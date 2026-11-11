import type * as Ledger from '@midnightntwrk/ledger-v9';

/**
 * Check an insertion against the original offers and authenticated Zswap state
 * immediately before this successful transaction. The caller supplies that
 * state and verifies inclusion independently of the receipt indexer.
 */
export function verifyShieldedInsertionByReplay(
  before: Ledger.ZswapChainState,
  tx: Ledger.FinalizedTransaction,
  commitment: string,
  expectedIndex: bigint,
): boolean {
  const fallible = [...(tx.fallibleOffer?.values() ?? [])];
  // This verifier covers the single-call wallet route with at most one
  // fallible offer. It refuses to guess execution order across segments.
  if (fallible.length > 1) return false;
  const guaranteed = tx.guaranteedOffer;
  const offers = guaranteed ? [guaranteed, ...fallible] : fallible;
  let state = before;
  let matched: bigint | undefined;
  for (const offer of offers) {
    const [after, inserted] = state.tryApply(offer);
    state = after;
    const index = inserted.get(commitment);
    if (index === undefined) continue;
    if (matched !== undefined) return false;
    matched = index;
  }
  return matched !== undefined && matched === expectedIndex;
}
