import { fetchJsonBounded, hostChainRpc } from '../../packages/service/dist/finality.js';

const hash = /^[0-9a-f]{64}$/;
const maximumLagMs = 120_000;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value */
function httpsEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  const url = URL.parse(value);
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    return undefined;
  return url.href;
}

/** @param {NodeJS.ProcessEnv} env */
export function hostedNetworkProfile(env) {
  const networkId = env.MN_NETWORK_ID;
  const genesisHash = env.MN_EXPECTED_GENESIS_HASH;
  const specName = env.MN_EXPECTED_RUNTIME_SPEC_NAME;
  const rawVersion = env.MN_EXPECTED_RUNTIME_SPEC_VERSION;
  const nodeUrl = httpsEndpoint(env.MN_NODE_URL);
  const indexerUrl = httpsEndpoint(env.MN_INDEXER_URL);
  if (
    !networkId ||
    networkId === 'undeployed' ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(networkId) ||
    !genesisHash ||
    !hash.test(genesisHash) ||
    !specName ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(specName) ||
    !rawVersion ||
    !/^[1-9][0-9]{0,9}$/.test(rawVersion) ||
    Number(rawVersion) > 0xffffffff ||
    !nodeUrl ||
    !indexerUrl
  )
    return undefined;
  return { networkId, genesisHash, specName, specVersion: Number(rawVersion), nodeUrl, indexerUrl };
}

/**
 * Admit a hosted node/indexer pair for read-only observation. The operator
 * supplies pins independently of the endpoints being observed.
 * @param {NodeJS.ProcessEnv} env
 * @param {{fetch?: typeof fetch, now?: () => number}} [options]
 */
export async function observeHostedNetwork(env, options = {}) {
  const profile = hostedNetworkProfile(env);
  if (!profile) return { ready: false, reason: 'invalid-profile' };
  const { networkId, genesisHash, specName, specVersion, nodeUrl, indexerUrl } = profile;
  const fetcher = options.fetch ?? fetch;
  const signal = AbortSignal.timeout(8000);
  const rpc = hostChainRpc({ nodeUrl, fetch: fetcher }, signal);
  try {
    if ((await rpc('chain_getBlockHash', [0])) !== '0x' + genesisHash)
      return { ready: false, reason: 'genesis-mismatch' };
    const finalized = await rpc('chain_getFinalizedHead', []);
    if (typeof finalized !== 'string' || !/^0x[0-9a-f]{64}$/.test(finalized))
      return { ready: false, reason: 'invalid-finality' };
    const header = await rpc('chain_getHeader', [finalized]);
    const height = finalizedHeight(header);
    if (!height || (await rpc('chain_getBlockHash', [height])) !== finalized)
      return { ready: false, reason: 'invalid-finality' };
    const runtime = await rpc('state_getRuntimeVersion', [finalized]);
    if (!record(runtime) || runtime.specName !== specName || runtime.specVersion !== specVersion)
      return { ready: false, reason: 'runtime-mismatch' };
    const finalizedHash = finalized.slice(2);
    const block = await readIndexedBlock(fetcher, indexerUrl, finalizedHash, signal);
    if (!block || block.hash !== finalizedHash || block.height !== height)
      return { ready: false, reason: 'indexer-mismatch' };
    const lagMs = (options.now ?? Date.now)() - Number(block.timestamp);
    if (
      !Number.isSafeInteger(block.timestamp) ||
      !Number.isFinite(lagMs) ||
      Math.abs(lagMs) > maximumLagMs
    )
      return { ready: false, reason: 'stale-indexer-block' };
    return {
      ready: true,
      networkId,
      genesisHash,
      specName,
      specVersion,
      finalizedHash,
      finalizedHeight: height,
      lagMs,
    };
  } catch {
    return { ready: false, reason: 'observation-unavailable' };
  }
}

/** @param {unknown} header */
function finalizedHeight(header) {
  if (
    !record(header) ||
    typeof header.number !== 'string' ||
    !/^0x[0-9a-f]{1,14}$/.test(header.number)
  )
    return undefined;
  const height = Number(BigInt(header.number));
  return Number.isSafeInteger(height) && height > 0 ? height : undefined;
}

/**
 * @param {typeof fetch} fetcher
 * @param {string} url
 * @param {string} blockHash
 * @param {AbortSignal} signal
 */
async function readIndexedBlock(fetcher, url, blockHash, signal) {
  const response = await fetchJsonBounded(
    fetcher,
    url,
    {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        query:
          'query QualificationFinality($offset:BlockOffset!){block(offset:$offset){hash height timestamp}}',
        variables: { offset: { hash: blockHash } },
      }),
    },
    64 * 1024,
  );
  const value = response.value;
  if (
    !response.ok ||
    !record(value) ||
    value.errors !== undefined ||
    !record(value.data) ||
    !record(value.data.block)
  )
    return undefined;
  return value.data.block;
}
