import type { P256GrantSpendFinalitySource } from '../../../packages/account/dist/index.js';
import { readHostConfirmation, type HostConfirmationRuntime } from './host-confirmation.ts';
import { isHostFinalizedBlock } from './host-finalized-block.ts';

/** Read the exact v9 receipt and prove its block is at or below the node's finalized head. */
export function createP256GrantFinality(
  runtime: HostConfirmationRuntime & { readonly networkId: string; readonly nodeUrl: string },
): P256GrantSpendFinalitySource {
  return {
    networkId: runtime.networkId,
    async readFinalized(transaction) {
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
