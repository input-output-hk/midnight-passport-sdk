import { z } from 'zod';
import { fetchJsonBounded } from './bounded-json.js';

const rpcResponse = z.object({ id: z.literal(1), result: z.unknown(), error: z.undefined() });
const rpcHash = z.string().regex(/^0x[0-9a-f]{64}$/);
const header = z.object({ number: z.string().regex(/^0x[0-9a-f]{1,16}$/) });

export function hostChainRpc(
  { nodeUrl, fetch: fetcher = fetch }: { readonly nodeUrl: string; readonly fetch?: typeof fetch },
  signal: AbortSignal,
) {
  return async (method: string, params: readonly (string | number)[]) => {
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
}

/** Return the configured Substrate node's current best block hash. */
export async function readHostBestHash(rpc: ReturnType<typeof hostChainRpc>): Promise<string> {
  return rpcHash.parse(await rpc('chain_getBlockHash', [])).slice(2);
}

/** Check the indexed block against the configured node's finalized canonical chain. */
export async function isHostFinalizedBlock(
  runtime: Parameters<typeof hostChainRpc>[0],
  blockHeight: number,
  blockHash: string,
): Promise<boolean> {
  if (!Number.isSafeInteger(blockHeight) || blockHeight < 1) return false;
  const rpc = hostChainRpc(runtime, AbortSignal.timeout(4000));
  try {
    const head = rpcHash.parse(await rpc('chain_getFinalizedHead', []));
    const finalized = header.parse(await rpc('chain_getHeader', [head]));
    if (BigInt(finalized.number) < BigInt(blockHeight)) return false;
    return rpcHash.parse(await rpc('chain_getBlockHash', [blockHeight])) === '0x' + blockHash;
  } catch {
    return false;
  }
}
