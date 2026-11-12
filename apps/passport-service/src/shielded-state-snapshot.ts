import type * as Ledger from '@midnightntwrk/ledger-v9';
import { z } from 'zod';
import { abortable, hostChainRpc } from '@input-output-hk/mn-passport-service/finality';
import { ledgerStateRootV18, maximumLedgerSnapshotBytes } from './ledger-state-root.ts';
import type { HostZswapStateSource } from './shielded-change-unspent.ts';

const blockHashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const byteLengthOf = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  'byteLength',
)?.get;
const rootSchema = z.array(z.number().int().min(0).max(255)).length(33);

type ShieldedSnapshotRuntime = Parameters<typeof hostChainRpc>[0] & {
  readonly networkId: string;
  /** Expected chain genesis hash, supplied independently of the snapshot and node. */
  readonly genesisHash: string;
  readonly ledger: { readonly LedgerState: Pick<typeof Ledger.LedgerState, 'deserialize'> };
  /** Supply a full v18 ledger snapshot at the exact hash, after bounding its transport. */
  readonly readLedgerSnapshot: (
    blockHash: string,
    signal: AbortSignal,
  ) => Promise<Uint8Array | undefined>;
};

/** Authenticate complete state, including spent nullifiers, against the configured node. */
export function createShieldedSnapshotSource(
  runtime: ShieldedSnapshotRuntime,
): HostZswapStateSource {
  const { networkId, ledger, readLedgerSnapshot, nodeUrl, fetch } = runtime;
  const genesis = '0x' + blockHashSchema.parse(runtime.genesisHash);
  return {
    networkId,
    async readAuthenticatedState(requested, signal) {
      try {
        signal.throwIfAborted();
        const blockHash = blockHashSchema.parse(requested);
        const rpc = hostChainRpc({ nodeUrl, ...(fetch && { fetch }) }, signal);
        if ((await rpc('chain_getBlockHash', [0])) !== genesis) return undefined;
        const [root, received] = await Promise.all([
          rpc('midnight_ledgerStateRoot', ['0x' + blockHash]),
          abortable(readLedgerSnapshot(blockHash, signal), signal),
        ]);
        const expected = rootSchema.parse(root);
        if (
          !byteLengthOf ||
          expected[0] !== 0 ||
          !(received instanceof Uint8Array) ||
          Reflect.apply(byteLengthOf, received, []) > maximumLedgerSnapshotBytes
        )
          return undefined;
        const snapshot = new Uint8Array(received);
        if (ledgerStateRootV18(snapshot) !== Buffer.from(expected).toString('hex'))
          return undefined;
        signal.throwIfAborted();
        return { blockHash, state: ledger.LedgerState.deserialize(snapshot).zswap };
      } catch {
        return undefined;
      }
    },
  };
}
