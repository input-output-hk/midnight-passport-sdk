import { createHash } from 'node:crypto';
import { readClaimFinality } from '../../apps/passport-dapp/src/midnames/claim-finality.ts';
import { dedicatedIndexerReadiness } from '../../scripts/qualification/indexer-readiness.mjs';

const address = /^[0-9a-f]{64}$/;
const claimBlockQuery =
  'query ClaimBlock($offset:TransactionOffset!){transactions(offset:$offset){__typename protocolVersion hash raw ... on RegularTransaction{identifiers transactionResult{status segments{id success}} block{hash height}}}}';

/** Keep the block observation tied to the original bytes, not just its offset. */
export function indexedClaimBlock(row, receipt, protocolVersion) {
  const block = row?.block;
  if (
    row?.__typename !== 'RegularTransaction' ||
    row.protocolVersion !== protocolVersion ||
    !address.test(row.hash) ||
    typeof row.raw !== 'string' ||
    row.raw.length === 0 ||
    row.raw.length > 2 * 1024 * 1024 ||
    row.raw.length % 2 !== 0 ||
    !/^[0-9a-f]+$/.test(row.raw) ||
    createHash('sha256').update(Buffer.from(row.raw, 'hex')).digest('hex') !==
      receipt.transaction.sha256 ||
    JSON.stringify(row.identifiers) !== JSON.stringify(receipt.transaction.identifiers) ||
    !address.test(block?.hash) ||
    !Number.isSafeInteger(block?.height) ||
    block.height < 1
  )
    return undefined;
  return block;
}

async function verifiedClaimBlock({ receipt, nodeUrl, indexerUrl, protocolVersion }) {
  const finalized = await dedicatedIndexerReadiness({ nodeUrl, indexerUrl });
  const reason = await readClaimFinality(indexerUrl, receipt, fetch, protocolVersion);
  if (!finalized.ready || (reason !== 'failed' && reason !== 'claim-failed' && reason !== true))
    throw new Error('The exact indexed claim result is not confirmed.');
  const response = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: claimBlockQuery,
      variables: { offset: { identifier: receipt.transaction.identifiers[0] } },
    }),
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error('The claim block is unavailable.');
  // Validate the exact same response with the full Ledger transaction parser;
  // another transaction at this offset must never lend its block to the claim.
  const blockReason = await readClaimFinality(
    indexerUrl,
    receipt,
    async () => response.clone(),
    protocolVersion,
  );
  if (blockReason !== reason)
    throw new Error('The indexed claim changed while checking its block.');
  const body = await response.json();
  const rows = body?.data?.transactions;
  const block =
    Array.isArray(rows) && rows.length === 1
      ? indexedClaimBlock(rows[0], receipt, protocolVersion)
      : undefined;
  if (
    body.errors ||
    !block ||
    block.height > finalized.finalizedHeight ||
    (block.height === finalized.finalizedHeight && block.hash !== finalized.finalizedHash)
  )
    throw new Error('The claim is not in a confirmed finalized block.');
  const node = await fetch(nodeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'chain_getBlockHash',
      params: [block.height],
    }),
    signal: AbortSignal.timeout(6_000),
  }).then((value) => value.json());
  if (node.result !== `0x${block.hash}`)
    throw new Error('The indexed claim block is not canonical on the local node.');
  return { reason, block, finalized };
}

/** Require the exact failed claim to be in a canonical node-finalized block. */
export async function verifyIndexedClaimFailure(input) {
  const { receipt, reader, profile } = input;
  const { reason, finalized } = await verifiedClaimBlock(input);
  if (
    (reason !== 'failed' && reason !== 'claim-failed') ||
    (await reader.hasDomain(receipt.name, profile)) ||
    !(await reader.isSupportedAccount(receipt.accountAddress, receipt.networkId))
  )
    throw new Error('The exact indexed claim failure and free name are not confirmed.');
  return { reason, finalizedHash: finalized.finalizedHash };
}

/** Tie an exact successful original and its current name/ACC binding to one
 * canonical node-finalized indexer block. `readBindingAt` must pin both
 * contract reads to the supplied block hash. */
export async function verifyIndexedClaimSuccess(input) {
  const { receipt, readBindingAt } = input;
  const { reason, block, finalized } = await verifiedClaimBlock(input);
  if (reason !== true) throw new Error('The exact indexed claim did not succeed.');
  const binding = await readBindingAt(finalized.finalizedHash);
  if (
    binding?.ownerCommitment !== receipt.ownerCommitment ||
    binding?.target?.kind !== 'contract' ||
    binding.target.address !== receipt.accountAddress ||
    binding.supportedAccount !== true
  )
    throw new Error('The finalized name and activated ACC binding differ from the claim.');
  return {
    claimBlock: block,
    finalizedRead: { hash: finalized.finalizedHash, height: finalized.finalizedHeight },
  };
}
