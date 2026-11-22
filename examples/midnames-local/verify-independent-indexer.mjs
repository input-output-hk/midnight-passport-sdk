#!/usr/bin/env node
// Read-only shared-chain witness: two separately stored Indexer API v4 paths,
// one canonical finalized node, and one pinned local name-to-ACC observation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMidnamesNodeFinality } from '../../apps/passport-dapp/src/midnames/chain-finality.ts';
import { configureMidnames } from '../../apps/passport-dapp/src/midnames/config.ts';
import { createMidnamesIndexer } from '../../apps/passport-dapp/src/midnames/ledger-reader.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [profilePath, primaryHttp, primaryWs, witnessHttp, witnessWs, nodeUrl] =
  process.argv.slice(2);
if (
  !process.env.IN_NIX_SHELL ||
  !profilePath ||
  !primaryHttp ||
  !primaryWs ||
  !witnessHttp ||
  !witnessWs ||
  !nodeUrl
)
  throw new Error('Use Nix and pass: claim receipt, primary HTTP/WS, witness HTTP/WS, node URL.');

const receipt = JSON.parse(readFileSync(resolve(profilePath), 'utf8'));
const { chain, registry, recipient } = receipt;
assert.equal(chain?.networkId, 'undeployed');
assert.equal(registry?.profile, 'standalone-0.35');
assert.equal(recipient?.bindingId, 'acc-s3r1.1');
assert.match(registry?.address ?? '', /^[a-f0-9]{64}$/);
assert.match(recipient?.address ?? '', /^[a-f0-9]{64}$/);
assert.match(registry?.name ?? '', /^[a-z0-9-]+\.night$/);
assert.ok(Number.isSafeInteger(registry?.claimBlock?.height) && registry.claimBlock.height > 0);
assert.match(registry?.claimBlock?.hash ?? '', /^[a-f0-9]{64}$/);

const pin = {
  nodeUrl,
  anchorHeight: registry.claimBlock.height,
  anchorHash: registry.claimBlock.hash,
};
const verifyFinalizedBlock = createMidnamesNodeFinality(pin);
const endpoints = [
  { id: 'primary', http: primaryHttp, ws: primaryWs },
  { id: 'witness', http: witnessHttp, ws: witnessWs },
];
const states = new Map();
const blocks = [];
for (const endpoint of endpoints) {
  const provider = createMidnamesIndexer('undeployed', endpoint.http, endpoint.ws);
  const block = await provider.queryBlock();
  assert.equal(
    block.protocolVersion,
    2001100,
    'Expected the observed Ledger 9 transaction protocol.',
  );
  await verifyFinalizedBlock(block);
  blocks.push({ id: endpoint.id, height: block.height, hash: block.hash });
  const hashes = [];
  for (const [kind, address] of [
    ['registry', registry.address],
    ['account', recipient.address],
  ]) {
    const state = await provider.queryContractState(address, {
      type: 'blockHash',
      blockHash: registry.claimBlock.hash,
    });
    assert.equal(state?.protocolVersion, 2001100);
    const bytes = state?.contractState?.serialize();
    assert.ok(bytes instanceof Uint8Array && bytes.length > 0, `${kind} state is unavailable.`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    hashes.push({ kind, bytes: bytes.length, sha256: hash });
  }
  states.set(endpoint.id, hashes);
}
assert.deepEqual(states.get('primary'), states.get('witness'), 'Pinned contract state differs.');

const names = configureMidnames(
  {
    registryProfile: registry.profile,
    registryAddress: registry.address,
    namespace: 'night',
    networkId: chain.networkId,
    indexerUrl: primaryHttp,
    indexerWsUrl: primaryWs,
    verificationIndexerUrl: witnessHttp,
    verificationIndexerWsUrl: witnessWs,
    nodeUrl,
    anchorBlockHeight: String(pin.anchorHeight),
    anchorBlockHash: pin.anchorHash,
    knownName: registry.name,
    knownAccountAddress: recipient.address,
  },
  chain.networkId,
  recipient.bindingId,
);
assert.ok(names, 'The explicit Midnames profile must be configured.');
const resolved = await names.resolve({ name: registry.name, networkId: chain.networkId });
assert.equal(resolved?.accountAddress, recipient.address);
assert.equal(resolved?.name, registry.name);

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: 'PASS_LOCAL_READ_ONLY',
      sourceCommit,
      chain: { networkId: chain.networkId, genesisHash: chain.genesisHash },
      anchor: registry.claimBlock,
      indexers: blocks,
      stateSha256: states.get('primary'),
      name: registry.name,
      registryAddress: registry.address,
      accountAddress: resolved.accountAddress,
      bindingId: recipient.bindingId,
      limits: [
        'Both indexers attach to one shared node; this is not independent node consensus.',
        'Matching indexer state bytes do not establish a cryptographic contract-state proof.',
        'The local transitional .night registry is not public passport.night or MIP-0007 delegation.',
      ],
    },
    null,
    2,
  ),
);
