import { z } from 'zod';
import {
  abortable,
  hostChainRpc,
  isHostFinalizedBlock,
} from '@input-output-hk/mn-passport-service/finality';
import {
  replayLedgerTransition,
  type CanonicalLedgerBlock,
  type ReplayLedger,
  type ReplayTarget,
} from './ledger-block-replay.ts';

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const requestSchema = z.object({
  blockHash: hash,
  blockHeight: z.number().int().positive(),
  identity: z.object({ txHash: hash, bytesSha256: hash }),
});
const header = z.object({ parentHash: z.string().regex(/^0x[0-9a-f]{64}$/) });
const version = z.object({ specVersion: z.literal(2_001_000) });
const root = z
  .array(z.number().int().min(0).max(255))
  .length(33)
  .refine((value) => value[0] === 0)
  .transform((value) => Buffer.from(value).toString('hex'));

interface TransitionRequest {
  readonly blockHash: string;
  readonly blockHeight: number;
  readonly identity: ReplayTarget;
}

type ShieldedTransitionRuntime = Parameters<typeof hostChainRpc>[0] & {
  readonly ledger: ReplayLedger;
  readonly genesisHash: string;
  /** Same trusted node, with phase-ordered execution inputs and timestamps. Only parameters may come from an indexer. Bound reads at the transport. */
  readonly readCanonicalBlock: (
    blockHash: string,
    signal: AbortSignal,
  ) => Promise<CanonicalLedgerBlock | undefined>;
  /** Complete parent snapshot. The node's state root authenticates these bytes. */
  readonly readLedgerSnapshot: (
    blockHash: string,
    signal: AbortSignal,
  ) => Promise<Uint8Array | undefined>;
};

/** Read-only evidence for the reference withdrawal and owner inbox append observers. */
export function createShieldedTransitionSource(runtime: ShieldedTransitionRuntime) {
  const genesis = '0x' + hash.parse(runtime.genesisHash);
  async function transition(request: TransitionRequest, signal: AbortSignal) {
    try {
      signal.throwIfAborted();
      const { blockHash, blockHeight, identity } = requestSchema.parse(request);
      const rpc = hostChainRpc(runtime, signal);
      const hashArg = '0x' + blockHash;
      if ((await rpc('chain_getBlockHash', [0])) !== genesis) return undefined;
      if (!(await abortable(isHostFinalizedBlock(runtime, blockHeight, blockHash), signal)))
        return undefined;
      const { parentHash } = header.parse(await rpc('chain_getHeader', [hashArg]));
      const [parentVersion, blockVersion, parentRoot, blockRoot, block, snapshot] =
        await Promise.all([
          rpc('state_getRuntimeVersion', [parentHash]),
          rpc('state_getRuntimeVersion', [hashArg]),
          rpc('midnight_ledgerStateRoot', [parentHash]),
          rpc('midnight_ledgerStateRoot', [hashArg]),
          abortable(runtime.readCanonicalBlock(blockHash, signal), signal),
          abortable(runtime.readLedgerSnapshot(parentHash.slice(2), signal), signal),
        ]);
      if (
        !version.safeParse(parentVersion).success ||
        !version.safeParse(blockVersion).success ||
        !snapshot ||
        block?.blockHash !== blockHash ||
        block.parentHash !== parentHash.slice(2) ||
        block.height !== blockHeight
      )
        return undefined;
      return replayLedgerTransition(
        runtime.ledger,
        block,
        snapshot,
        { parent: root.parse(parentRoot), block: root.parse(blockRoot) },
        identity,
        signal,
      );
    } catch {
      return undefined;
    }
  }
  return {
    async verifyInsertion(
      output: Omit<TransitionRequest, 'identity'> &
        ReplayTarget & {
          readonly account: string;
          readonly commitment: string;
          readonly index: bigint;
        },
      signal: AbortSignal,
    ): Promise<boolean> {
      const { txHash, bytesSha256, commitment, account, index } = output;
      const exact = await transition({ ...output, identity: { txHash, bytesSha256 } }, signal);
      const matches = exact?.result.events
        .map(({ content, source }) =>
          source.transactionHash === txHash &&
          content.tag === 'zswapOutput' &&
          'commitment' in content &&
          content.commitment === commitment
            ? content
            : undefined,
        )
        .filter((content) => content !== undefined);
      const match = matches?.[0];
      return (
        matches?.length === 1 &&
        match?.contract === account &&
        match.mtIndex === index &&
        !signal.aborted
      );
    },
    async readAuthenticatedTransition(
      original: TransitionRequest & { readonly account: string },
      signal: AbortSignal,
    ) {
      const exact = await transition(original, signal);
      if (exact?.result.type !== 'success' || signal.aborted) return undefined;
      const before = exact.before.index(original.account);
      const after = exact.after.index(original.account);
      return before && after ? { before, after } : undefined;
    },
  };
}
