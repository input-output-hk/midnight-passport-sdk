import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { admitNativeClaim } from '../../apps/passport-dapp/src/midnames/claim-native-admission.ts';
import { readClaimFinality } from '../../apps/passport-dapp/src/midnames/claim-finality.ts';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';
import { openClaimDispatch } from './claim-dispatch.mts';
import { qualifyClaimHandoff } from './claim-handoff-fixture.mjs';
import { qualifyPartialClaim } from './claim-partial-probe.mjs';

/** A separate, freshly prepared sponsored original follows the indexed failure.
 * This host-only lane checks native dispatch and registry finality; the browser
 * release/review ceremony has its own test until a combined lane is qualified. */
export async function qualifyClaimRetry(input) {
  const {
    output,
    quote,
    receipt,
    fixtureQuote,
    registryAddress,
    accountAddress,
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
    ref,
    assets,
    modulePath,
    registryManifestHash,
    sponsorPaymentAddress,
  } = input;
  const first = await qualifyPartialClaim(input);
  assert.equal(first.indexedClaimFailure, true);
  assert.equal(first.originalDispatches, 1);
  step('restore-parent-registration-for-fresh-claim');
  await contracts.submitCallTx(regProviders, {
    compiledContract: compiled,
    contractAddress: registryAddress,
    circuitId: 'update_payment_config',
    privateStateId: 'midnames-registry',
    args: [rootId, { ...price, buy_enabled: true }],
  });
  const current = await providers.publicDataProvider.queryContractState(registryAddress);
  const parent = registry.ledger(current.data).id_to_data.lookup(rootId);
  assert.equal(parent.payment_config.buy_enabled, true);
  assert.equal(await reads.readClaim(quote.name, profile), undefined);
  const retryDir = join(output, 'retry');
  mkdirSync(retryDir, { mode: 0o700 });
  let retryReceipt;
  let retryDispatches = 0;
  const second = await qualifyClaimHandoff({
    output: retryDir,
    ref,
    assets,
    modulePath,
    registryManifestHash,
    registryAddress,
    accountAddress,
    sponsorPaymentAddress,
    walletProvider: regProviders.walletProvider,
    ledger,
    rootId,
    parentDomain: parent,
    step,
    async dispatch(nextQuote, nextReceipt, nextFixtureQuote) {
      await readLive(nextQuote);
      assert.equal(nextQuote.name, quote.name);
      assert.notEqual(nextReceipt.transaction.sha256, receipt.transaction.sha256);
      assert.notEqual(nextFixtureQuote.id, fixtureQuote.id);
      retryReceipt = nextReceipt;
      const journal = openClaimDispatch(retryDir);
      const pending = await journal.dispatch(nextReceipt, {
        async authorize(bytes, acknowledged) {
          await readLive(nextQuote);
          admitNativeClaim(bytes, acknowledged, nextQuote, 100_000_000_000_000_000n);
        },
        async submit(bytes) {
          retryDispatches++;
          const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes);
          await providers.midnightProvider.submitTx({ version: 'v9', tx });
        },
      });
      assert.equal(pending.status, 'pending');
      assert.equal(retryDispatches, 1);
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const status = await readClaimFinality(process.env.MN_INDEXER_URL, nextReceipt);
        if (status === true) break;
        assert.ok(status === false || status === undefined);
        await delay(1500);
      }
      assert.equal(await readClaimFinality(process.env.MN_INDEXER_URL, nextReceipt), true);
      assert.deepEqual(await reads.readClaim(nextQuote.name, profile), {
        ownerCommitment: nextQuote.ownerCommitment,
        target: { kind: 'contract', address: accountAddress },
      });
      return { indexedRetrySuccess: true, retryDispatches };
    },
  });
  assert.equal(second.indexedRetrySuccess, true);
  assert.equal(retryDispatches, 1);
  assert.ok(retryReceipt);
  assert.equal(await readClaimFinality(process.env.MN_INDEXER_URL, receipt), 'claim-failed');
  saveIsolationReceipt(join(output, 'indexed-claim-retry.json'), {
    original: receipt,
    retry: retryReceipt,
    originalDispatches: first.originalDispatches,
    retryDispatches,
    parentRestored: true,
    registryBoundToSameAccount: true,
  });
  return {
    indexedClaimFailure: true,
    indexedRetrySuccess: true,
    originalDispatches: first.originalDispatches,
    retryDispatches,
  };
}
