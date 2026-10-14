import { ZswapOutput } from '@midnightntwrk/ledger-v9';
import type {
  OpenedInboxEntry,
  ShieldedCoin,
  VerifiedHoldingSource,
} from '@input-output-hk/mn-passport-account/ports';

/** The two chain-history queries Lace's Passport custody walk uses. */
export interface HoldingIndexer {
  enumerateContractActions(account: string): Promise<readonly { readonly txHash: string }[]>;
  queryShieldedOutputs(
    txHash: string,
  ): Promise<readonly { readonly contractAddress?: string | null; readonly commitment: string }[]>;
}

const hex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Recompute the chain commitment rather than trusting a decryptable inbox description. */
function coinCommitment(account: string, coin: ShieldedCoin): string | undefined {
  try {
    return ZswapOutput.newContractOwned(
      { type: hex(coin.color), nonce: hex(coin.nonce), value: coin.value },
      undefined,
      account,
    ).commitment.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Select the first inbox description of each distinct output the chain created for this ACC.
 * The host injects an indexer pinned to the same network as its account chain adapter.
 */
export function createMidnightHoldingSource(indexer: HoldingIndexer): VerifiedHoldingSource {
  return {
    async selectHeldEntries(account, entries, opened) {
      if (entries.length !== opened.length)
        throw new Error('the opened inbox does not match its entries');
      if (!/^[0-9a-f]{64}$/i.test(account)) throw new Error('invalid ACC address');
      const candidates: { index: number; commitment: string }[] = [];
      for (let index = 0; index < opened.length; index++) {
        const item: OpenedInboxEntry | null = opened[index] ?? null;
        if (item?.kind !== 'coin') continue;
        const commitment = coinCommitment(account, item.coin);
        if (commitment) candidates.push({ index, commitment });
      }
      if (candidates.length === 0) return [];
      const actions = await indexer.enumerateContractActions(account);
      const hashes = [...new Set(actions.map((action) => action.txHash))];
      const received = new Set<string>();
      // Bound concurrent indexer queries without changing which output is accepted.
      for (let offset = 0; offset < hashes.length; offset += 8) {
        const batch = await Promise.all(
          hashes.slice(offset, offset + 8).map((hash) => indexer.queryShieldedOutputs(hash)),
        );
        for (const output of batch.flat()) {
          if (output.contractAddress?.toLowerCase() === account.toLowerCase())
            received.add(output.commitment.toLowerCase());
        }
      }
      const selected: number[] = [];
      const seen = new Set<string>();
      for (const { index, commitment } of candidates) {
        if (!received.has(commitment) || seen.has(commitment)) continue;
        seen.add(commitment);
        selected.push(index);
      }
      return selected;
    },
  };
}
