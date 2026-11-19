// Read-only gate for a local demo profile. A matching genesis alone does not
// identify a retained development chain, so also pin a finalized claim block.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createMidnamesIndexer,
  createMidnamesLedgerReads,
} from '../../apps/passport-dapp/src/midnames/ledger-reader.ts';
import { waitForFinalizedIndexerBlock } from './finalized-indexer.mjs';

const [file] = process.argv.slice(2);
assert.ok(file, 'Pass a local Midnames profile JSON file.');
const source = JSON.parse(readFileSync(file, 'utf8'));
// A completed shared-claim receipt is also a profile source. Its finalized
// original block pins the retained development chain.
const profile =
  source.status === 'PASS'
    ? {
        schemaVersion: 1,
        chain: { networkId: source.networkId },
        registry: {
          profile: 'standalone-0.35',
          address: source.registryAddress,
          name: source.name,
          claimBlock: source.claimBlock,
        },
        recipient: { bindingId: 'acc-s3r1.1', address: source.accountAddress },
      }
    : source;
const hex = /^[a-f0-9]{64}$/;
assert.equal(profile.schemaVersion, 1);
assert.equal(profile.chain?.networkId, 'undeployed');
if (source.status !== 'PASS') assert.match(profile.chain.genesisHash, /^0x[a-f0-9]{64}$/);
assert.equal(profile.registry?.profile, 'standalone-0.35');
assert.match(profile.registry.address, hex);
assert.match(profile.recipient?.address, hex);
assert.match(profile.registry.claimBlock?.hash, hex);
assert.ok(Number.isSafeInteger(profile.registry.claimBlock.height));
assert.match(profile.registry.name, /^[a-z0-9-]+\.night$/);

const nodeUrl = process.env.MN_NODE_URL;
const indexerUrl = process.env.MN_INDEXER_URL;
const indexerWsUrl = process.env.MN_INDEXER_WS_URL;
assert.ok(nodeUrl && indexerUrl && indexerWsUrl, 'Configure the local Ledger 9 endpoints.');
async function rpc(method, params) {
  const response = await fetch(nodeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
  assert.ok(response.ok, `Node read failed: ${method}`);
  const result = await response.json();
  assert.equal(result.error, undefined, `Node refused ${method}`);
  return result.result;
}

const genesisHash = await rpc('chain_getBlockHash', [0]);
if (source.status !== 'PASS')
  assert.equal(genesisHash, profile.chain.genesisHash, 'Wrong chain genesis.');
assert.equal(
  await rpc('chain_getBlockHash', [profile.registry.claimBlock.height]),
  `0x${profile.registry.claimBlock.hash}`,
  'The recorded name claim is not on this chain.',
);
const finalizedHash = await rpc('chain_getFinalizedHead', []);
assert.match(finalizedHash, /^0x[a-f0-9]{64}$/);
const finalizedHeader = await rpc('chain_getHeader', [finalizedHash]);
assert.match(finalizedHeader?.number, /^0x[a-f0-9]+$/);
const finalizedHeight = Number(BigInt(finalizedHeader.number));
assert.ok(Number.isSafeInteger(finalizedHeight));
const indexer = createMidnamesIndexer('undeployed', indexerUrl, indexerWsUrl);
try {
  assert.ok(finalizedHeight >= profile.registry.claimBlock.height);
  const blockHash = finalizedHash.slice(2);
  const block = await waitForFinalizedIndexerBlock(indexer, blockHash, finalizedHeight);
  // Midnames and ACC must be read as of the same canonical finalized block. A
  // fresh read of each contract at the indexer tip can straddle a name update.
  const pinned = {
    ...indexer,
    queryContractState: (address) =>
      indexer.queryContractState(address, { type: 'blockHash', blockHash }),
  };
  const reader = createMidnamesLedgerReads(
    pinned,
    'undeployed',
    profile.recipient.bindingId ?? 'acc-s3r1.1',
    'standalone-0.35',
  );
  const scope = {
    networkId: 'undeployed',
    namespace: 'night',
    registryAddress: profile.registry.address,
  };
  const claim = await reader.readClaim(profile.registry.name, scope);
  assert.equal(claim?.target.kind, 'contract', 'The name has no contract target.');
  assert.equal(claim.target.address, profile.recipient.address, 'The name target changed.');
  assert.ok(await reader.isSupportedAccount(profile.recipient.address, 'undeployed'));
  assert.equal(
    await rpc('chain_getBlockHash', [finalizedHeight]),
    finalizedHash,
    'The anchored indexer block is not canonical on the node.',
  );
  console.log(
    JSON.stringify({
      networkId: 'undeployed',
      registryAddress: scope.registryAddress,
      name: profile.registry.name,
      accountAddress: profile.recipient.address,
      claimBlock: profile.registry.claimBlock,
      finalizedRead: { hash: blockHash, height: block.height },
    }),
  );
} finally {
  await indexer.dispose?.();
}
