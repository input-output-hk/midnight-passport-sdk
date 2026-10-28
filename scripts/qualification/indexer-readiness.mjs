// A responding indexer can serve a stale database after node/VM interruption.
// Qualification may build with a wallet only after observing node finality in that indexer.
/** @param {{fetch?:typeof fetch,now?:()=>number}} [options] */
export async function dedicatedIndexerReadiness(options = {}) {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const node = 'http://127.0.0.1:19954';
  const indexer = 'http://127.0.0.1:18098/api/v4/graphql';
  /** @param {string} url @param {unknown} body */
  const post = async (url, body) => {
    const response = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error('Readiness transport unavailable.');
    return /** @type {any} */ (await response.json());
  };
  /** @param {string} method @param {unknown[]} [params] */
  const rpc = async (method, params = []) => {
    const body = await post(node, { jsonrpc: '2.0', id: 1, method, params });
    if (body.error || body.result === undefined) throw new Error('Readiness RPC unavailable.');
    return body.result;
  };
  try {
    const finalized = await rpc('chain_getFinalizedHead');
    if (typeof finalized !== 'string' || !/^0x[0-9a-f]{64}$/.test(finalized))
      return { ready: false };
    const header = await rpc('chain_getHeader', [finalized]);
    if (typeof header?.number !== 'string' || !/^0x[0-9a-f]+$/.test(header.number))
      return { ready: false };
    const height = Number(BigInt(header.number));
    if (!Number.isSafeInteger(height) || height < 1) return { ready: false };
    const hash = finalized.slice(2);
    const body = await post(indexer, {
      query:
        'query QualificationFinality($offset:BlockOffset!){block(offset:$offset){hash height timestamp}}',
      variables: { offset: { hash } },
    });
    const block = body.data?.block;
    if (
      body.errors ||
      block?.hash !== hash ||
      block?.height !== height ||
      !Number.isSafeInteger(block?.timestamp)
    )
      return { ready: false };
    const lagMs = now() - block.timestamp;
    // A finalized tip normally trails two six-second blocks. Refuse a stopped chain,
    // stale indexer, incompatible timestamp units or a materially different clock.
    if (!Number.isFinite(lagMs) || Math.abs(lagMs) > 120000) return { ready: false };
    return {
      ready: true,
      finalizedHash: hash,
      finalizedHeight: height,
      timestamp: block.timestamp,
      lagMs,
    };
  } catch {
    return { ready: false };
  }
}
