import { ZswapOutput } from '@midnightntwrk/ledger-v9';
import type {
  OpenedInboxEntry,
  QualifiedHoldingSource,
  ShieldedCoin,
} from '@input-output-hk/mn-passport-account/ports';

/** The two chain-history queries Lace's Passport custody walk uses. */
export interface HoldingIndexer {
  enumerateContractActions(account: string): Promise<readonly { readonly txHash: string }[]>;
  queryShieldedOutputs(txHash: string): Promise<
    readonly {
      readonly contractAddress?: string | null;
      readonly commitment: string;
      /** Lace's decoded zswap output event carries its exact Merkle index. */
      readonly index?: bigint;
    }[]
  >;
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
export function createMidnightHoldingSource(indexer: HoldingIndexer): QualifiedHoldingSource {
  const verified = async (
    account: string,
    entries: readonly Uint8Array[],
    opened: readonly (OpenedInboxEntry | null)[],
    qualified: boolean,
  ) => {
    if (entries.length !== opened.length)
      throw new Error('the opened inbox does not match its entries');
    if (!/^[0-9a-f]{64}$/i.test(account)) throw new Error('invalid ACC address');
    const candidates: { index: number; commitment: string; coin: ShieldedCoin }[] = [];
    for (let index = 0; index < opened.length; index++) {
      const item: OpenedInboxEntry | null = opened[index] ?? null;
      if (item?.kind !== 'coin') continue;
      const commitment = coinCommitment(account, item.coin);
      if (commitment) candidates.push({ index, commitment, coin: item.coin });
    }
    if (candidates.length === 0) return [];
    const actions = await indexer.enumerateContractActions(account);
    const hashes = [...new Set(actions.map((action) => action.txHash))];
    const received = new Map<string, { indices: Set<bigint>; missing: boolean }>();
    // Bound concurrent indexer queries without changing which output is accepted.
    for (let offset = 0; offset < hashes.length; offset += 8) {
      const batch = await Promise.all(
        hashes.slice(offset, offset + 8).map((hash) => indexer.queryShieldedOutputs(hash)),
      );
      for (const output of batch.flat()) {
        if (output.contractAddress?.toLowerCase() !== account.toLowerCase()) continue;
        const commitment = output.commitment.toLowerCase();
        const found = received.get(commitment) ?? { indices: new Set<bigint>(), missing: false };
        if (typeof output.index === 'bigint' && output.index >= 0n && output.index < 1n << 64n)
          found.indices.add(output.index);
        else found.missing = true;
        received.set(commitment, found);
      }
    }
    const selected: { index: number; coin: ShieldedCoin; mtIndex?: bigint }[] = [];
    const seen = new Set<string>();
    for (const { index, commitment, coin } of candidates) {
      const found = received.get(commitment);
      if (!found || seen.has(commitment)) continue;
      seen.add(commitment);
      if (qualified && (found.missing || found.indices.size !== 1))
        throw new Error('the ACC holding has no unique verified Merkle index');
      const mtIndex = [...found.indices][0];
      selected.push({ index, coin, ...(mtIndex !== undefined && { mtIndex }) });
    }
    return selected;
  };
  return {
    async selectHeldEntries(account, entries, opened) {
      return (await verified(account, entries, opened, false)).map(({ index }) => index);
    },
    async selectQualifiedHeldCoins(account, entries, opened) {
      return (await verified(account, entries, opened, true)).map(({ index, coin, mtIndex }) => ({
        inboxIndex: index,
        coin: {
          nonce: coin.nonce.slice(),
          color: coin.color.slice(),
          value: coin.value,
          mt_index: mtIndex!,
        },
      }));
    },
  };
}
