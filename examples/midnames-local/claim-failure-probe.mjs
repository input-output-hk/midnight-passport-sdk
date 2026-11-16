import assert from 'node:assert/strict';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readClaimFinality } from '../../apps/passport-dapp/src/midnames/claim-finality.ts';
import { admitNativeClaim } from '../../apps/passport-dapp/src/midnames/claim-native-admission.ts';
import { claimQuoteDigest } from '../../apps/passport-dapp/src/midnames/claim-quote.ts';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';
import { openClaimDispatch } from './claim-dispatch.mts';

/** Probe whether a claim admitted after a parent-policy race is indexed as FAILURE.
 * The retained original is never replayed; a non-Failure result keeps the case open. */
export async function qualifyIndexedFailure({
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
}) {
  assert.equal(receipt.quoteSha256, await claimQuoteDigest(fixtureQuote));
  const evidence = { original: receipt, attempts: 0, result: 'pending' };
  const save = () => saveIsolationReceipt(join(output, 'indexed-failure-probe.json'), evidence);
  const journal = openClaimDispatch(output);
  const pending = await journal.dispatch(receipt, {
    async authorize(bytes, acknowledged) {
      await readLive(quote);
      evidence.admission = admitNativeClaim(bytes, acknowledged, quote, 100_000_000_000_000_000n);
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
  step('reconcile-exact-original-failure');
  const until = Date.now() + 120_000;
  while (Date.now() < until) {
    const result = await readClaimFinality(process.env.MN_INDEXER_URL, receipt);
    if (result === 'failed') {
      assert.equal(await reads.readClaim(quote.name, profile), undefined);
      evidence.result = 'failed';
      save();
      return { indexedFailure: true, originalDispatches: evidence.attempts };
    }
    if (result === true || result === 'conflict') {
      evidence.result = result;
      save();
      throw new Error(`Original claim did not fail: ${String(result)}`);
    }
    await delay(1500);
  }
  evidence.result = 'unresolved';
  save();
  throw new Error('Original claim has no exact indexed FAILURE; preserve its fence and receipt.');
}
