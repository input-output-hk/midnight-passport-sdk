import type * as Ledger from '@midnightntwrk/ledger-v9';
import {
  recoverShieldedWithdrawal,
  type ShieldedBackfillPorts,
  type ShieldedWithdrawalRecoveryPorts,
} from '../../../packages/account/dist/index.js';
import { abortable } from './bounded-json.ts';
import { hostChainRpc, readHostBestHash } from './host-finalized-block.ts';
import { hex, same } from './host-ledger.ts';

interface HostZswapStateSource {
  readonly networkId: string;
  /**
   * Authenticate full, unfiltered Zswap state (including the spent nullifier
   * set) against the exact requested block on this network. Neither a
   * filtered indexer snapshot nor a matching coin-tree root alone suffices.
   */
  readAuthenticatedState(
    blockHash: string,
    signal: AbortSignal,
  ): Promise<{ readonly blockHash: string; readonly state: Ledger.ZswapChainState } | undefined>;
}

interface ShieldedChangeUnspentRuntime {
  readonly ledger: Pick<typeof Ledger, 'ZswapInput' | 'ZswapOffer'>;
  readonly networkId: string;
  readonly nodeUrl: string;
  readonly fetch?: typeof fetch;
  readonly stateSource: HostZswapStateSource;
}

/**
 * A local dry run against current canonical state. Re-qualify the original
 * insertion first: constructing a Ledger 9 input at an occupied index is
 * insufficient evidence that the index belongs to this coin.
 */
export function createShieldedChangeUnspentCheck(
  requestId: string,
  withdrawal: ShieldedWithdrawalRecoveryPorts,
  runtime: ShieldedChangeUnspentRuntime,
): ShieldedBackfillPorts['isUnspent'] {
  const { networkId, stateSource, ledger } = runtime;
  return async (account, coin) => {
    if (networkId !== withdrawal.finality.networkId || networkId !== stateSource.networkId)
      return false;
    try {
      if (
        !(coin.nonce instanceof Uint8Array) ||
        coin.nonce.length !== 32 ||
        !(coin.color instanceof Uint8Array) ||
        coin.color.length !== 32
      )
        return false;
      const { value, mt_index } = coin;
      const color = new Uint8Array(coin.color);
      const nonce = new Uint8Array(coin.nonce);
      const original = await recoverShieldedWithdrawal(requestId, withdrawal);
      if (
        original.kind !== 'change-found' ||
        original.account !== account ||
        original.change.mt_index !== mt_index ||
        original.change.value !== value ||
        !same(original.change.color, color) ||
        !same(original.change.nonce, nonce)
      )
        return false;
      const signal = AbortSignal.timeout(4000);
      const rpc = hostChainRpc(runtime, signal);
      const best = await readHostBestHash(rpc);
      const snapshot = await abortable(stateSource.readAuthenticatedState(best, signal), signal);
      if (!snapshot || snapshot.blockHash !== best || mt_index >= snapshot.state.firstFree)
        return false;
      const input = ledger.ZswapInput.newContractOwned(
        { type: hex(color), nonce: hex(nonce), value, mt_index },
        undefined,
        account,
        snapshot.state,
      );
      snapshot.state.tryApply(ledger.ZswapOffer.fromInput(input));
      return (await readHostBestHash(rpc)) === best && !signal.aborted;
    } catch {
      return false;
    }
  };
}
