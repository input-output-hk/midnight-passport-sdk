import { z } from 'zod';
import type { P256GrantSpendFinalitySource } from '../../../packages/account/dist/index.js';
import { fetchJsonBounded } from './bounded-json.ts';
import { readHostConfirmation, type HostConfirmationRuntime } from './host-confirmation.ts';

const rpcResponse = z.object({ id: z.literal(1), result: z.unknown(), error: z.undefined() });
const rpcHash = z.string().regex(/^0x[0-9a-f]{64}$/);
const header = z.object({ number: z.string().regex(/^0x[0-9a-f]{1,16}$/) });

/** Read the exact v9 receipt and prove its block is at or below the node's finalized head. */
export function createP256GrantFinality(
  runtime: HostConfirmationRuntime & { readonly networkId: string; readonly nodeUrl: string },
): P256GrantSpendFinalitySource {
  const { networkId, nodeUrl, fetch: fetcher = fetch } = runtime;
  const rpc = async (method: string, params: readonly (string | number)[], signal: AbortSignal) => {
    const response = await fetchJsonBounded(
      fetcher,
      nodeUrl,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal,
        redirect: 'error',
      },
      64 * 1024,
    );
    return response.ok ? rpcResponse.parse(response.value).result : undefined;
  };
  return {
    networkId,
    async readFinalized(transaction) {
      try {
        const included = await readHostConfirmation(
          { identifiers: transaction.identifiers },
          runtime,
          transaction,
        );
        if (!included?.blockHash || !included.blockHeight) return undefined;
        const signal = AbortSignal.timeout(4000);
        const head = rpcHash.parse(await rpc('chain_getFinalizedHead', [], signal));
        const finalized = header.parse(await rpc('chain_getHeader', [head], signal));
        if (BigInt(finalized.number) < BigInt(included.blockHeight)) return undefined;
        const canonical = rpcHash.parse(
          await rpc('chain_getBlockHash', [included.blockHeight], signal),
        );
        if (canonical !== '0x' + included.blockHash) return undefined;
        return { ...transaction, blockHeight: included.blockHeight };
      } catch {
        return undefined;
      }
    },
  };
}
