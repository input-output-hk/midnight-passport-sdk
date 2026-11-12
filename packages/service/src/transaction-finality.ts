import { readHostConfirmation, type HostConfirmationRuntime } from './host-confirmation.js';
import { isHostFinalizedBlock } from './host-finalized-block.js';

interface ExactHostTransaction {
  readonly identifiers: readonly string[];
  readonly txHash: string;
  readonly bytesSha256: string;
}

/** Read the exact v9 receipt and check its block against the node's finalized chain. */
export function createHostTransactionFinality(
  runtime: HostConfirmationRuntime & { readonly networkId: string; readonly nodeUrl: string },
) {
  return {
    networkId: runtime.networkId,
    async readFinalized<T extends ExactHostTransaction>(transaction: T) {
      const included = await readHostConfirmation(
        { identifiers: transaction.identifiers },
        runtime,
        transaction,
      );
      if (!included?.blockHash || !included.blockHeight) return undefined;
      if (!(await isHostFinalizedBlock(runtime, included.blockHeight, included.blockHash)))
        return undefined;
      return { ...transaction, blockHeight: included.blockHeight };
    },
  };
}
