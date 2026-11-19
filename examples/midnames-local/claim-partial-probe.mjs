import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readClaimFinality } from '../../apps/passport-dapp/src/midnames/claim-finality.ts';
import { admitNativeClaim } from '../../apps/passport-dapp/src/midnames/claim-native-admission.ts';
import { claimQuoteDigest } from '../../apps/passport-dapp/src/midnames/claim-quote.ts';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';
import { openClaimDispatch } from './claim-dispatch.mts';

/** Qualify the exact claim-segment failure when a sponsored claim loses a
 * parent-policy race. Its retained original is not replayed by this probe. */
export async function qualifyPartialClaim({
  output,
  quote,
  receipt,
  fixtureQuote,
  registryAddress,
  rootId,
  price,
  compiled,
  registry,
  regProviders,
  contracts,
  providers,
  ledger,
  reads,
  profile,
  step,
  readLive,
  dispatchJournalDir = output,
}) {
  assert.equal(receipt.quoteSha256, await claimQuoteDigest(fixtureQuote));
  const evidence = { original: receipt, attempts: 0, result: 'pending' };
  const save = () => saveIsolationReceipt(join(output, 'indexed-partial-claim.json'), evidence);
  const journal = openClaimDispatch(dispatchJournalDir);
  let originalBytes;
  let admissionAt;
  const pending = await journal.dispatch(receipt, {
    async authorize(bytes, acknowledged) {
      await readLive(quote);
      admissionAt = Date.now();
      evidence.admission = admitNativeClaim(
        bytes,
        acknowledged,
        quote,
        100_000_000_000_000_000n,
        admissionAt,
      );
      save();
    },
    async submit(bytes) {
      // A registry owner changes the *same* parent after sponsor admission and
      // before this already-fenced original reaches the node. This models a
      // genuine chain-state race without forging an indexer failure response.
      step('disable-parent-registration-before-original-dispatch');
      await contracts.submitCallTx(regProviders, {
        compiledContract: compiled,
        contractAddress: registryAddress,
        circuitId: 'update_payment_config',
        privateStateId: 'midnames-registry',
        args: [rootId, { ...price, buy_enabled: false }],
      });
      const current = await providers.publicDataProvider.queryContractState(registryAddress);
      assert.equal(
        registry.ledger(current.data).id_to_data.lookup(rootId).payment_config.buy_enabled,
        false,
      );
      const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes);
      originalBytes = new Uint8Array(bytes);
      evidence.attempts += 1;
      save();
      try {
        evidence.submittedId = String(
          await providers.midnightProvider.submitTx({ version: 'v9', tx }),
        );
      } catch (error) {
        evidence.submitError = String(error);
      }
      save();
    },
  });
  assert.equal(pending.status, 'pending');
  step('reconcile-exact-original-partial-status');
  const until = Date.now() + 120_000;
  const query =
    'query MidnamesClaim($offset: TransactionOffset!) { transactions(offset:$offset) { __typename protocolVersion hash raw ... on RegularTransaction { identifiers transactionResult { status segments { id success } } } } }';
  while (Date.now() < until) {
    let rows;
    try {
      const response = await fetch(process.env.MN_INDEXER_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query,
          variables: { offset: { identifier: receipt.transaction.identifiers[0] } },
        }),
        signal: AbortSignal.timeout(6000),
      });
      const body = await response.json();
      if (response.ok && !body.errors) rows = body.data?.transactions;
    } catch {
      // A temporary indexer outage does not establish finality.
    }
    if (Array.isArray(rows) && rows.length) {
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.equal(row.__typename, 'RegularTransaction');
      assert.equal(row.protocolVersion, 2001100);
      assert.ok(typeof row.raw === 'string' && /^[0-9a-f]+$/.test(row.raw));
      const raw = Buffer.from(row.raw, 'hex');
      assert.ok(originalBytes && raw.equals(Buffer.from(originalBytes)));
      assert.equal(createHash('sha256').update(raw).digest('hex'), receipt.transaction.sha256);
      const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', raw);
      assert.equal(row.hash, tx.transactionHash());
      assert.deepEqual(row.identifiers, receipt.transaction.identifiers);
      assert.deepEqual(tx.identifiers(), receipt.transaction.identifiers);
      assert.ok(admissionAt !== undefined);
      // Recheck through the app's Ledger copy; the reference ACC worktree has
      // a separate ContractCall constructor, so cross-copy instanceof fails.
      assert.deepEqual(
        admitNativeClaim(raw, receipt, quote, 100_000_000_000_000_000n, admissionAt),
        evidence.admission,
      );
      evidence.indexerStatus = row.transactionResult?.status;
      evidence.indexerSegments = row.transactionResult?.segments;
      save();
      assert.equal(evidence.indexerStatus, 'PARTIAL_SUCCESS');
      assert.equal(
        await readClaimFinality(process.env.MN_INDEXER_URL, receipt, fetch, 2001100),
        'claim-failed',
      );
      assert.equal(await reads.readClaim(quote.name, profile), undefined);
      assert.equal(evidence.attempts, 1);
      evidence.result = 'claim-segment-failed';
      save();
      return { indexedClaimFailure: true, originalDispatches: evidence.attempts };
    }
    await delay(1500);
  }
  evidence.result = 'unresolved';
  save();
  throw new Error('Original claim has no exact indexed result; preserve its fence and receipt.');
}
