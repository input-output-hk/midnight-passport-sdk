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
  queryShieldedInputs(
    txHash: string,
  ): Promise<readonly { readonly contractAddress?: string | null; readonly nullifier: string }[]>;
  /** Derive the ACC input nullifier using the qualified coin and current tree. */
  coinNullifier(account: string, coin: ShieldedCoin, index: bigint): Promise<string>;
}

const hex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'byteLength')?.get;
const typedArrayName = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)?.get;

/** Admit actual byte storage before copying; Buffer and cross-realm Uint8Array are supported. */
function ownedCoinBytes(value: Uint8Array): Uint8Array | undefined {
  if (!typedArrayLength || !typedArrayName) return undefined;
  try {
    const name: unknown = Reflect.apply(typedArrayName, value, []);
    const length: unknown = Reflect.apply(typedArrayLength, value, []);
    if (name !== 'Uint8Array' || length !== 32) return undefined;
    return new Uint8Array(value);
  } catch {
    return undefined;
  }
}
function ownedCoin(coin: ShieldedCoin): ShieldedCoin | undefined {
  try {
    const { nonce, color, value } = coin;
    if (typeof value !== 'bigint' || value < 0n || value >= 1n << 128n) return undefined;
    const ownedNonce = ownedCoinBytes(nonce),
      ownedColor = ownedCoinBytes(color);
    if (!ownedNonce || !ownedColor) return undefined;
    return { nonce: ownedNonce, color: ownedColor, value };
  } catch {
    return undefined;
  }
}
const copyCoin = (coin: ShieldedCoin): ShieldedCoin => ({
  nonce: new Uint8Array(coin.nonce),
  color: new Uint8Array(coin.color),
  value: coin.value,
});

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

/** Own every candidate before commitment/history, retaining its original inbox position. */
function holdingCandidates(account: string, opened: readonly (OpenedInboxEntry | null)[]) {
  const candidates: { index: number; commitment: string; coin: ShieldedCoin }[] = [];
  for (let index = 0; index < opened.length; index++) {
    const item = opened[index];
    const coin = item?.kind === 'coin' ? ownedCoin(item.coin) : undefined;
    if (!coin) continue;
    const commitment = coinCommitment(account, coin);
    if (commitment) candidates.push({ index, commitment, coin });
  }
  return candidates;
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
  ) => {
    if (entries.length !== opened.length)
      throw new Error('the opened inbox does not match its entries');
    if (!/^[0-9a-f]{64}$/i.test(account)) throw new Error('invalid ACC address');
    const candidates = holdingCandidates(account, opened);
    if (candidates.length === 0) return [];
    const actions = await indexer.enumerateContractActions(account);
    const hashes = [...new Set(actions.map((action) => action.txHash))];
    const received = new Map<string, { indices: Set<bigint>; missing: boolean }>();
    const spent = new Set<string>();
    // Bound concurrent indexer queries without changing which output is accepted.
    for (let offset = 0; offset < hashes.length; offset += 8) {
      const batch = await Promise.all(
        hashes
          .slice(offset, offset + 8)
          .map(async (hash) =>
            Promise.all([indexer.queryShieldedOutputs(hash), indexer.queryShieldedInputs(hash)]),
          ),
      );
      for (const [outputs, inputs] of batch) {
        for (const output of outputs) {
          if (output.contractAddress?.toLowerCase() !== account.toLowerCase()) continue;
          const commitment = output.commitment.toLowerCase();
          const found = received.get(commitment) ?? { indices: new Set<bigint>(), missing: false };
          if (typeof output.index === 'bigint' && output.index >= 0n && output.index < 1n << 64n)
            found.indices.add(output.index);
          else found.missing = true;
          received.set(commitment, found);
        }
        for (const input of inputs) {
          spent.add(input.nullifier.toLowerCase());
        }
      }
    }
    const selected: { index: number; coin: ShieldedCoin; mtIndex: bigint }[] = [];
    const seen = new Set<string>();
    for (const { index, commitment, coin } of candidates) {
      const found = received.get(commitment);
      if (!found || seen.has(commitment)) continue;
      const mtIndex = found.indices.values().next().value;
      if (found.missing || found.indices.size !== 1 || mtIndex === undefined)
        throw new Error('the ACC holding has no unique verified Merkle index');
      if (spent.has((await indexer.coinNullifier(account, copyCoin(coin), mtIndex)).toLowerCase()))
        continue;
      seen.add(commitment);
      selected.push({ index, coin, mtIndex });
    }
    return selected;
  };
  return {
    async selectHeldEntries(account, entries, opened) {
      return (await verified(account, entries, opened)).map(({ index }) => index);
    },
    async selectQualifiedHeldCoins(account, entries, opened) {
      return (await verified(account, entries, opened)).map(({ index, coin, mtIndex }) => ({
        inboxIndex: index,
        coin: {
          ...copyCoin(coin),
          mt_index: mtIndex,
        },
      }));
    },
  };
}
