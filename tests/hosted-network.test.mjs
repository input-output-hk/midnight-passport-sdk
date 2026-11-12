import assert from 'node:assert/strict';
import test from 'node:test';
import { observeHostedNetwork } from '../scripts/qualification/hosted-network.mjs';

const genesis = '1'.repeat(64);
const finalized = '2'.repeat(64);
const now = 1794495000000;
const profile = {
  MN_NETWORK_ID: 'qualification-testnet',
  MN_EXPECTED_GENESIS_HASH: genesis,
  MN_EXPECTED_RUNTIME_SPEC_NAME: 'midnight-test',
  MN_EXPECTED_RUNTIME_SPEC_VERSION: '2001000',
  MN_NODE_URL: 'https://node.example.invalid/rpc',
  MN_INDEXER_URL: 'https://indexer.example.invalid/api/v4/graphql',
};

/** @param {{genesis?: string, canonical?: string, specVersion?: number, indexedHash?: string,
 * timestamp?: number, oversized?: boolean}} [overrides] */
function fixture(overrides = {}) {
  /** @type {string[]} */
  const calls = [];
  /** @type {typeof fetch} */
  const fetcher = async (url, init) => {
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    const body = JSON.parse(String(init.body));
    if (url === profile.MN_INDEXER_URL) {
      calls.push('indexer');
      assert.deepEqual(body.variables, { offset: { hash: finalized } });
      if (overrides.oversized)
        return new Response('{}', { headers: { 'content-length': '65537' } });
      return Response.json({
        data: {
          block: {
            hash: overrides.indexedHash ?? finalized,
            height: 20,
            timestamp: overrides.timestamp ?? now - 12000,
          },
        },
      });
    }
    assert.equal(url, profile.MN_NODE_URL);
    calls.push(body.method);
    let result;
    switch (body.method) {
      case 'chain_getBlockHash':
        assert.ok(body.params[0] === 0 || body.params[0] === 20);
        result =
          '0x' +
          (body.params[0] === 0
            ? (overrides.genesis ?? genesis)
            : (overrides.canonical ?? finalized));
        break;
      case 'chain_getFinalizedHead':
        result = '0x' + finalized;
        break;
      case 'chain_getHeader':
      case 'state_getRuntimeVersion':
        assert.deepEqual(body.params, ['0x' + finalized]);
        result =
          body.method === 'chain_getHeader'
            ? { number: '0x14' }
            : {
                specName: 'midnight-test',
                specVersion: overrides.specVersion ?? 2001000,
              };
        break;
      default:
        return assert.fail('Expected a read-only method.');
    }
    return Response.json({ jsonrpc: '2.0', id: 1, result });
  };
  return { calls, run: () => observeHostedNetwork(profile, { fetch: fetcher, now: () => now }) };
}

test('hosted network preflight binds a fresh indexer block to the pinned chain and runtime', async () => {
  const { run, calls } = fixture();
  assert.deepEqual(await run(), {
    ready: true,
    networkId: profile.MN_NETWORK_ID,
    genesisHash: genesis,
    specName: 'midnight-test',
    specVersion: 2001000,
    finalizedHash: finalized,
    finalizedHeight: 20,
    lagMs: 12000,
  });
  assert.deepEqual(calls, [
    'chain_getBlockHash',
    'chain_getFinalizedHead',
    'chain_getHeader',
    'chain_getBlockHash',
    'state_getRuntimeVersion',
    'indexer',
  ]);
});

test('hosted preflight refuses mismatched pins, stale observations and oversized responses', async () => {
  const other = '3'.repeat(64);
  for (const [overrides, reason] of /** @type {const} */ ([
    [{ genesis: other }, 'genesis-mismatch'],
    [{ canonical: other }, 'invalid-finality'],
    [{ specVersion: 2001001 }, 'runtime-mismatch'],
    [{ indexedHash: other }, 'indexer-mismatch'],
    [{ timestamp: now - 120001 }, 'stale-indexer-block'],
    [{ timestamp: Math.floor(now / 1000) }, 'stale-indexer-block'],
    [{ oversized: true }, 'observation-unavailable'],
  ])) {
    assert.deepEqual(await fixture(overrides).run(), { ready: false, reason });
  }
});

test('invalid hosted profiles fail before a request and transport diagnostics stay private', async () => {
  let requests = 0;
  /** @type {typeof fetch} */
  const fetcher = async () => {
    requests++;
    throw new Error('Private endpoint information.');
  };
  for (const invalid of [
    { MN_NETWORK_ID: 'undeployed' },
    { MN_EXPECTED_GENESIS_HASH: undefined },
    { MN_EXPECTED_RUNTIME_SPEC_NAME: 'runtime name' },
    { MN_EXPECTED_RUNTIME_SPEC_VERSION: '4294967296' },
    { MN_NODE_URL: 'http://node.example.invalid' },
    { MN_NODE_URL: 'https://alice:private@node.example.invalid' },
    { MN_INDEXER_URL: 'https://indexer.example.invalid?token=private' },
  ]) {
    assert.deepEqual(await observeHostedNetwork({ ...profile, ...invalid }, { fetch: fetcher }), {
      ready: false,
      reason: 'invalid-profile',
    });
  }
  assert.equal(requests, 0);
  assert.deepEqual(await observeHostedNetwork(profile, { fetch: fetcher }), {
    ready: false,
    reason: 'observation-unavailable',
  });
  assert.equal(requests, 1);
});
