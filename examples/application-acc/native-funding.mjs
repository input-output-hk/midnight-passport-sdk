// Qualification-only funding evidence. No wallet signing, submission or resend port.
import assert from 'node:assert/strict';

/** @typedef {{value:bigint,owner:string,type:string}} Output */
/** @typedef {{outputs:readonly Output[]}} Offer */
/** @typedef {{intentHash(segment:number):string,guaranteedUnshieldedOffer?:Offer|undefined,fallibleUnshieldedOffer?:Offer|undefined}} FundingIntent */
/** @typedef {{hash:string,intentHash:string,outputNo:number,owner:string,color:string,amount:bigint}} FundingInput */
const HEX = /^[0-9a-f]{64}$/;
const NIGHT = '00'.repeat(32);

/** Accept only one unshielded offer and one exact owned12-unit output in a retained transfer.
 * The transaction comes from the pinned ledger decoder, not untrusted JSON or a balance probe.
 * @param {{transactionHash():string,intents:Map<number,FundingIntent>|undefined}} transaction
 * @param {string} owner
 * @returns {Readonly<FundingInput>}
 */
export function originalFundingInput(transaction, owner) {
  assert.match(owner, HEX);
  const hash = transaction.transactionHash();
  assert.match(hash, HEX);
  const offers = [];
  for (const [segment, intent] of transaction.intents ?? []) {
    for (const offer of [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer])
      if (offer && offer.outputs.length > 0) offers.push({ segment, intent, offer });
  }
  assert.equal(offers.length, 1, 'Funding fixture requires one unambiguous unshielded offer');
  const entry = offers[0];
  assert.ok(entry);
  const matching = entry.offer.outputs.flatMap((output, outputNo) =>
    output.owner === owner && output.type === NIGHT && output.value === 12n ? [outputNo] : [],
  );
  assert.equal(matching.length, 1, 'Retain one original exact owned NIGHT output; do not resplit');
  const outputNo = matching[0];
  assert.ok(outputNo !== undefined);
  const intentHash = entry.intent.intentHash(entry.segment);
  assert.match(intentHash, HEX);
  return Object.freeze({ hash, intentHash, outputNo, owner, color: NIGHT, amount: 12n });
}

/** A larger balance, another12-unit coin or an unsynchronised snapshot is insufficient.
 * @param {{isSynced:boolean,unshielded:{availableCoins:readonly {utxo:{value:bigint,owner:string,type:string,intentHash:string,outputNo:number}}[]}}} state
 * @param {Readonly<FundingInput>} expected
 */
export function hasOriginalFundingInput(state, expected) {
  if (state.isSynced !== true) return false;
  const matches = state.unshielded.availableCoins.filter(
    ({ utxo }) =>
      utxo.owner === expected.owner &&
      utxo.type === expected.color &&
      utxo.value === expected.amount &&
      utxo.intentHash === expected.intentHash &&
      utxo.outputNo === expected.outputNo,
  );
  assert.ok(matches.length <= 1, 'Ambiguous original funding observation');
  return matches.length === 1;
}

/** Canonical successful original transfer, independently of submit acknowledgement or wallet state.
 * Missing/stale/error evidence refuses; it never proves no send or authorizes a replacement.
 * @param {string} hash
 * @param {{post:(url:string,body:unknown)=>Promise<any>}} ports
 */
export async function confirmOriginalFunding(hash, { post }) {
  assert.match(hash, HEX);
  const indexer = 'http://127.0.0.1:18098/api/v4/graphql';
  const node = 'http://127.0.0.1:19954';
  const value = await post(indexer, {
    query:
      'query($offset:TransactionOffset!){transactions(offset:$offset){hash block{hash height} ... on RegularTransaction{transactionResult{status segments{id success}}}}}',
    variables: { offset: { hash } },
  });
  assert.ok(
    !value.errors && Array.isArray(value.data?.transactions),
    'Original funding evidence unavailable; do not resend',
  );
  const rows = value.data.transactions.filter((/** @type {any} */ row) => row.hash === hash);
  assert.equal(
    rows.length,
    1,
    'Original funding transaction is absent or ambiguous; do not resend',
  );
  const row = rows[0];
  assert.equal(row.transactionResult?.status, 'SUCCESS');
  assert.ok(
    row.transactionResult.segments == null ||
      (Array.isArray(row.transactionResult.segments) &&
        row.transactionResult.segments.every((/** @type {any} */ s) => s.success === true)),
  );
  assert.match(row.block?.hash, HEX);
  assert.ok(Number.isSafeInteger(row.block.height) && row.block.height >= 1);
  const finalized = await post(node, {
    jsonrpc: '2.0',
    id: 1,
    method: 'chain_getFinalizedHead',
    params: [],
  });
  assert.equal(finalized.error, undefined);
  assert.match(finalized.result, /^0x[0-9a-f]{64}$/);
  const header = await post(node, {
    jsonrpc: '2.0',
    id: 2,
    method: 'chain_getHeader',
    params: [finalized.result],
  });
  assert.equal(header.error, undefined);
  assert.match(header.result?.number, /^0x[0-9a-f]+$/);
  const height = BigInt(header.result.number);
  assert.ok(height >= BigInt(row.block.height));
  const canonical = await post(node, {
    jsonrpc: '2.0',
    id: 3,
    method: 'chain_getBlockHash',
    params: [row.block.height],
  });
  assert.equal(canonical.error, undefined);
  assert.equal(canonical.result, '0x' + row.block.hash);
  return Object.freeze({
    txHash: hash,
    blockHash: row.block.hash,
    blockHeight: row.block.height,
    finalizedHeight: height.toString(),
    finalizedHash: finalized.result.slice(2),
  });
}
