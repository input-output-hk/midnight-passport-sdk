import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  ContractMaintenanceAuthority,
  ContractOperation,
  ContractState,
} from '@midnight-ntwrk/compact-runtime';
import { resolveBinding } from '../packages/contract/dist/registry.js';
import { AccSimulator } from '../scripts/qualification/acc-simulator.mjs';
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
const bindingId = 'acc-s3r1.1';
const binding = resolveBinding(bindingId);
const accProfile = {
  MN_EXPECTED_ACC_ADDRESS: '4'.repeat(64),
  MN_EXPECTED_ACC_BINDING_ID: bindingId,
  MN_EXPECTED_ACC_MANIFEST_SHA256: binding.manifestSha256,
};
const verifierNames = Object.entries(binding.circuits).flatMap(([name, circuit]) =>
  circuit.proof ? [name] : [],
);

/** @param {{genesis?: string, canonical?: string, specVersion?: number, indexedHash?: string,
 * timestamp?: number, oversized?: boolean, snapshot?: Response}} [overrides] */
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
      if (body.variables.address !== undefined) {
        calls.push('acc');
        assert.match(body.query, /^query QualificationAcc\b/);
        assert.match(body.query, /contract\(address: \$address, offset: \$offset\)/);
        assert.deepEqual(body.variables, {
          address: accProfile.MN_EXPECTED_ACC_ADDRESS,
          offset: { hash: finalized },
        });
        assert.ok(overrides.snapshot);
        return overrides.snapshot;
      }
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
  return {
    calls,
    run: (/** @type {NodeJS.ProcessEnv} */ extra = {}) =>
      observeHostedNetwork({ ...profile, ...extra }, { fetch: fetcher, now: () => now }),
  };
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
    { MN_EXPECTED_ACC_ADDRESS: '' },
    { MN_EXPECTED_ACC_BINDING_ID: bindingId },
    { ...accProfile, MN_EXPECTED_ACC_ADDRESS: 'A'.repeat(64) },
    { ...accProfile, MN_EXPECTED_ACC_BINDING_ID: 'acc-45721e1' },
    { ...accProfile, MN_EXPECTED_ACC_MANIFEST_SHA256: '3'.repeat(64) },
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

/** @param {{activate?: boolean, swapVerifiers?: boolean, omitVerifier?: boolean}} [options] */
async function compiledState({
  activate = true,
  swapVerifiers = false,
  omitVerifier = false,
} = {}) {
  const sim = await AccSimulator.create({ activate });
  const packed = new URL('../packages/contract/resources/acc-s3r1.1.zkir.json.gz', import.meta.url);
  const { files } = JSON.parse(gunzipSync(readFileSync(packed)).toString('utf8'));
  const state = new ContractState();
  assert.ok(sim.state);
  state.data = sim.state;
  state.maintenanceAuthority = new ContractMaintenanceAuthority([], 1);
  for (const [index, name] of verifierNames.entries()) {
    if (omitVerifier && index === 0) continue;
    const keyName = swapVerifiers && index < 2 ? verifierNames[1 - index] : name;
    const operation = new ContractOperation();
    operation.verifierKey = Buffer.from(files[`keys/${keyName}.verifier`], 'base64');
    state.setOperation(name, operation);
  }
  return Buffer.from(state.serialize()).toString('hex');
}

/** @param {string | null} state @param {Record<string, unknown>} [block] @param {string} [address] */
function snapshot(state, block = {}, address = accProfile.MN_EXPECTED_ACC_ADDRESS) {
  return Response.json({
    data: {
      block: { hash: finalized, height: 20, protocolVersion: 2001000, ...block },
      contract: state === null ? null : { address, state },
    },
  });
}

test('ACC preflight observes an active compiled ACC at the admitted finalized block', async () => {
  const { run, calls } = fixture({ snapshot: snapshot(await compiledState()) });
  const result = await run(accProfile);
  assert.equal(result.ready, true);
  assert.ok('account' in result && 'finalizedHash' in result);
  assert.equal(result.finalizedHash, finalized);
  assert.deepEqual(result.account, {
    address: accProfile.MN_EXPECTED_ACC_ADDRESS,
    bindingId,
    manifestSha256: binding.manifestSha256,
    verifierCount: verifierNames.length,
    specVersion: 3,
    protocolVersion: 2001000,
    maintenanceCanUpdate: false,
  });
  assert.deepEqual(calls.slice(-2), ['indexer', 'acc']);
});

test('ACC preflight stops on failed network admission and rejects an undated or malformed snapshot', async () => {
  const { run, calls } = fixture({ indexedHash: genesis });
  assert.deepEqual(await run(accProfile), { ready: false, reason: 'indexer-mismatch' });
  assert.ok(!calls.includes('acc'));
  for (const response of [
    snapshot('00', { hash: genesis }),
    snapshot('00', { height: 21 }),
    snapshot('00', { protocolVersion: 1001000 }),
    snapshot('00', { protocolVersion: 2001000.5 }),
    snapshot('00', { protocolVersion: 3000000 }),
    snapshot('00', { protocolVersion: '2001000' }),
    snapshot('00', {}, genesis),
    snapshot(null),
    snapshot('0'),
    snapshot('zz'),
    Response.json({ errors: [{ message: 'private transport details' }] }),
  ]) {
    assert.deepEqual(await fixture({ snapshot: response }).run(accProfile), {
      ready: false,
      reason: 'acc-snapshot-unavailable',
    });
  }
  const oversized = new Response('{}', { headers: { 'content-length': '4194305' } });
  assert.deepEqual(await fixture({ snapshot: oversized }).run(accProfile), {
    ready: false,
    reason: 'observation-unavailable',
  });
});

test('ACC preflight rejects a wrong verifier assignment, incomplete table or dormant ACC', async () => {
  for (const [state, reason] of /** @type {const} */ ([
    [await compiledState({ swapVerifiers: true }), 'acc-binding-mismatch'],
    [await compiledState({ omitVerifier: true }), 'acc-binding-mismatch'],
    ['00', 'acc-binding-mismatch'],
    [await compiledState({ activate: false }), 'acc-not-active'],
  ])) {
    assert.deepEqual(await fixture({ snapshot: snapshot(state) }).run(accProfile), {
      ready: false,
      reason,
    });
  }
});
