import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkKnownMapping, nodeProjectId, onlineProfile } from './check-known-mapping.mjs';

const hash = 'c'.repeat(64);
const block = { hash, height: 42 };
const knownAcc = 'b'.repeat(64);
const input = {
  schemaVersion: 1,
  networkId: 'preprod',
  nodeRpcUrl: 'http://127.0.0.1:9944/',
  registryProfile: 'midnames-2.1.0',
  registryAddress: 'a'.repeat(64),
  bindingId: 'acc-s3r1.1',
  namespace: 'night',
  knownName: 'alice.night',
  knownAcc,
  observationDate: '2026-11-19',
  primaryIndexer: {
    http: 'http://127.0.0.1:18088/api/v4/graphql',
    ws: 'ws://127.0.0.1:18088/api/v4/graphql/ws',
  },
  witnessIndexer: {
    http: 'https://independent.example/api/v4/graphql',
    ws: 'wss://independent.example/api/v4/graphql/ws',
  },
};

function fixture(overrides = {}) {
  const profile = onlineProfile(input);
  const calls = [];
  const rpc = async (method, params) => {
    calls.push(['node', method, params]);
    const results = {
      system_chain: 'Midnight Preprod',
      chain_getFinalizedHead: `0x${hash}`,
      chain_getHeader: { number: '0x2a' },
      chain_getBlockHash: `0x${hash}`,
    };
    return overrides[method] ?? results[method];
  };
  const provider = (source) => ({
    async queryBlock(offset) {
      calls.push([source, 'block', offset]);
      return overrides[`${source}Block`] ?? block;
    },
  });
  const readAt = async (source, observed, scope) => {
    calls.push([source.id, 'read', observed]);
    assert.deepEqual(observed, block);
    assert.equal(scope.knownName, input.knownName);
    return overrides[`${source.id}Mapping`] ?? knownAcc;
  };
  return {
    profile,
    calls,
    dependencies: {
      rpc,
      primary: Object.assign(provider('primary'), { id: 'primary' }),
      witness: Object.assign(provider('witness'), { id: 'witness' }),
      readAt,
    },
  };
}

test('admits only an exact finalized block and matching ACC on both readers', async () => {
  const { profile, calls, dependencies } = fixture();
  const receipt = await checkKnownMapping(profile, dependencies);
  assert.deepEqual(receipt.finalizedBlock, block);
  assert.equal(receipt.accountAddress, knownAcc);
  assert.deepEqual(receipt.indexerOrigins, [
    'http://127.0.0.1:18088',
    'https://independent.example',
  ]);
  assert.deepEqual(
    calls.filter((entry) => entry[1] === 'block').map((entry) => entry[2]),
    Array(2).fill({ type: 'blockHash', blockHash: hash }),
  );
  assert.deepEqual(
    calls.filter((entry) => entry[1] === 'read').map((entry) => entry[0]),
    ['primary', 'witness'],
  );
  assert.equal(calls.at(-1)[1], 'chain_getBlockHash');
});

test('refuses a stale or divergent indexer before reading any name', async () => {
  for (const overrides of [
    { primaryBlock: { hash: 'd'.repeat(64), height: 42 } },
    { witnessBlock: { hash, height: 41 } },
  ]) {
    const { profile, calls, dependencies } = fixture(overrides);
    await assert.rejects(checkKnownMapping(profile, dependencies), /different block/);
    assert.equal(
      calls.some((entry) => entry[1] === 'read'),
      false,
    );
  }
});

test('refuses a wrong node chain, changed known target, and reorged finality', async () => {
  for (const [overrides, expected] of [
    [{ system_chain: 'Midnight Preview' }, /Wrong node chain/],
    [{ witnessMapping: 'd'.repeat(64) }, /does not resolve/],
    [{ chain_getBlockHash: `0x${'d'.repeat(64)}` }, /no longer canonical/],
  ]) {
    const { profile, dependencies } = fixture(overrides);
    await assert.rejects(checkKnownMapping(profile, dependencies), expected);
  }
});

test('rejects credentialed URLs, same-origin readers, wrong pins and invalid dates before I/O', () => {
  for (const changed of [
    { nodeRpcUrl: 'https://rpc.midnight-preprod.blockfrost.io/?project_id=secret' },
    {
      primaryIndexer: {
        http: 'https://independent.example/api/v4/graphql',
        ws: 'wss://independent.example/api/v4/graphql/ws',
      },
    },
    { knownName: 'Alice.night' },
    { registryProfile: 'standalone-0.35' },
    { observationDate: '2026-02-31' },
  ])
    assert.throws(() => onlineProfile({ ...input, ...changed }));
});

test('sends a Blockfrost ID only to the exact official node host for its network', () => {
  const token = 'nightpreprodTEST123';
  const official = onlineProfile({
    ...input,
    nodeRpcUrl: 'https://rpc.midnight-preprod.blockfrost.io/',
  });
  assert.equal(nodeProjectId(official, { BLOCKFROST_PROJECT_ID: token }), token);
  assert.throws(() => nodeProjectId(official, { BLOCKFROST_PROJECT_ID: 'nightmainnetWrong' }));
  assert.equal(nodeProjectId(onlineProfile(input), { BLOCKFROST_PROJECT_ID: token }), undefined);
  const lookalike = onlineProfile({
    ...input,
    nodeRpcUrl: 'https://rpc.midnight-preprod.blockfrost.io.evil.example/',
  });
  assert.equal(nodeProjectId(lookalike, { BLOCKFROST_PROJECT_ID: token }), undefined);
  const nonstandardPort = onlineProfile({
    ...input,
    nodeRpcUrl: 'https://rpc.midnight-preprod.blockfrost.io:8443/',
  });
  assert.equal(nodeProjectId(nonstandardPort, { BLOCKFROST_PROJECT_ID: token }), undefined);
});
