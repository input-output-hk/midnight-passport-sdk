// Read-only diagnostic for the pinned transitional Midnames Mainnet registry.
// This cannot qualify an online Passport ACC mapping or independent providers.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createMidnamesIndexer } from '../../apps/passport-dapp/src/midnames/ledger-reader.ts';

const requireApp = createRequire(new URL('../../apps/passport-dapp/package.json', import.meta.url));
const { getContractLedger } = await import(requireApp.resolve('@midnames/sdk/core'));
const { AddressType } = await import(requireApp.resolve('@midnames/sdk'));

const profile = Object.freeze({
  networkId: 'mainnet',
  indexerUrl: 'https://api.midnames.com/api/v4/graphql',
  indexerWsUrl: 'wss://api.midnames.com/api/v4/graphql/ws',
  nodeUrl: 'https://rpc.mainnet.midnight.network/',
  registryAddress: '83b0d57aba442f92e12b5cdf92642adb9927ccd554a9061b5bd0992fc72596bb',
});

async function nodeResult(method, params = []) {
  const response = await fetch(profile.nodeUrl, {
    method: 'POST',
    redirect: 'error',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Mainnet node ${method} read failed.`);
  const reply = await response.json();
  if (reply?.jsonrpc !== '2.0' || reply.id !== 1 || reply.error || reply.result == null)
    throw new Error(`Mainnet node ${method} refused the read.`);
  return reply.result;
}

async function scan() {
  const provider = createMidnamesIndexer(
    profile.networkId,
    profile.indexerUrl,
    profile.indexerWsUrl,
  );
  try {
    assert.equal(await nodeResult('system_chain'), 'Midnight Mainnet');
    const block = await provider.queryBlock();
    assert.match(block?.hash, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(block.height) && block.height >= 0);
    const finalized = await nodeResult('chain_getFinalizedHead');
    assert.match(finalized, /^0x[a-f0-9]{64}$/);
    const header = await nodeResult('chain_getHeader', [finalized]);
    assert.match(header?.number, /^0x[0-9a-f]+$/);
    const finalizedHeight = BigInt(header.number);
    assert.ok(finalizedHeight >= BigInt(block.height));
    const canonical = await nodeResult('chain_getBlockHash', [block.height]);
    assert.equal(canonical, `0x${block.hash}`);

    const at = {
      ...provider,
      queryContractState: (address) =>
        provider.queryContractState(address, { type: 'blockHash', blockHash: block.hash }),
    };
    const observed = await at.queryContractState(profile.registryAddress);
    assert.ok(observed, 'The pinned registry is absent at the selected block.');
    const state = observed.contractState.serialize();
    const nodeState = await nodeResult('midnight_contractState', [
      profile.registryAddress,
      `0x${block.hash}`,
    ]);
    assert.equal(nodeState, Buffer.from(state).toString('hex'));
    const decoded = await getContractLedger(at, profile.registryAddress);
    assert.equal(decoded.success, true);
    assert.equal(decoded.data.TLD, 'night');

    const counts = { contract: 0, shielded: 0, unshielded: 0 };
    let nonRootContractTargets = 0;
    const rootId = String(decoded.data.ROOT_ZONE_ID);
    for (const [id, record] of decoded.data.id_to_data) {
      if (record.target_type === AddressType.ContractAddr) {
        counts.contract++;
        if (String(id) !== rootId) nonRootContractTargets++;
      } else if (record.target_type === AddressType.ZswapCPKAddr) counts.shielded++;
      else if (record.target_type === AddressType.UnshieldedAddr) counts.unshielded++;
      else throw new Error('The registry contains an unknown target class.');
    }
    assert.equal(
      BigInt(counts.contract + counts.shielded + counts.unshielded),
      decoded.data.id_to_data.size(),
    );
    assert.equal(await nodeResult('chain_getBlockHash', [block.height]), canonical);
    return {
      schemaVersion: 1,
      kind: 'midnames-mainnet-node-anchored-contract-target-scan',
      scanner: 'examples/midnames-online/scan-mainnet-registry.mjs',
      observedAt: new Date().toISOString(),
      result:
        nonRootContractTargets === 0
          ? 'NO_NONROOT_CONTRACT_TARGET_AT_SELECTED_BLOCK'
          : 'CONTRACT_TARGET_CANDIDATES_PRESENT',
      networkId: profile.networkId,
      indexerOrigin: new URL(profile.indexerUrl).origin,
      indexerApi: 'v4',
      nodeOrigin: new URL(profile.nodeUrl).origin,
      registryAddress: profile.registryAddress,
      selectedBlock: { height: block.height, hash: block.hash },
      nodeFinalizedHeight: Number(finalizedHeight),
      registryStateBytes: state.length,
      nodeStateBytesMatchIndexer: true,
      registryTld: decoded.data.TLD,
      rootZoneId: rootId,
      zoneRecords: String(decoded.data.id_to_data.size()),
      targetTypeCounts: counts,
      nonRootContractTargetCount: nonRootContractTargets,
      limits: [
        'One Midnames-hosted indexer plus one public node, not independent indexer operators or a cryptographic state inclusion proof.',
        'A contract target candidate is not a verified Passport ACC or an independently known name mapping.',
        'This is a dated block observation; later writes or another registry can change the result.',
        'No ownership, delegated passport.night subdomain, claim, payment, physical passkey, or released SDK is qualified.',
      ],
    };
  } finally {
    await provider.dispose?.();
  }
}

const output = process.argv[2];
if (!output || !isAbsolute(output)) throw new Error('Pass a fresh absolute receipt path.');
const receipt = await scan();
writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(
  JSON.stringify({
    result: receipt.result,
    selectedBlock: receipt.selectedBlock,
    nonRootContractTargetCount: receipt.nonRootContractTargetCount,
  }),
);
