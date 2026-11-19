import { readClaimFinality } from '../../apps/passport-dapp/src/midnames/claim-finality.ts';
import { dedicatedIndexerReadiness } from '../../scripts/qualification/indexer-readiness.mjs';

const address = /^[0-9a-f]{64}$/;
const claimBlockQuery =
  'query ClaimBlock($offset:TransactionOffset!){transactions(offset:$offset){block{hash height}}}';

/** Require the exact indexed claim to be in a canonical node-finalized block. */
export async function verifyIndexedClaimFailure({
  receipt,
  nodeUrl,
  indexerUrl,
  protocolVersion,
  reader,
  profile,
}) {
  const finalized = await dedicatedIndexerReadiness({ nodeUrl, indexerUrl });
  const reason = await readClaimFinality(indexerUrl, receipt, fetch, protocolVersion);
  if (
    !finalized.ready ||
    (reason !== 'failed' && reason !== 'claim-failed') ||
    (await reader.hasDomain(receipt.name, profile)) ||
    !(await reader.isSupportedAccount(receipt.accountAddress, receipt.networkId))
  )
    throw new Error('The exact indexed claim failure and free name are not confirmed.');
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
  const body = await response.json();
  const rows = body?.data?.transactions;
  const block = Array.isArray(rows) && rows.length === 1 ? rows[0]?.block : undefined;
  if (
    body.errors ||
    !address.test(block?.hash) ||
    !Number.isSafeInteger(block?.height) ||
    block.height < 1 ||
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
  return { reason, finalizedHash: finalized.finalizedHash };
}
