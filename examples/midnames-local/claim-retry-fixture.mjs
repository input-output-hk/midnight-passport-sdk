import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readClaimFinality } from '../../apps/passport-dapp/src/midnames/claim-finality.ts';
import { claimQuoteDigest } from '../../apps/passport-dapp/src/midnames/claim-quote.ts';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';
import { openClaimDispatch } from './claim-dispatch.mts';
import { claimFailedArchivePath, createClaimPreparationJournal } from './claim-preparation.mts';
import { verifyIndexedClaimFailure } from './claim-indexed-failure.mjs';
import { createOnce } from './create-once.mts';
import { qualifyPartialClaim } from './claim-partial-probe.mjs';
import { qualifyPageOwnedClaim } from './claim-page-fixture.mjs';

/** After exact indexed failure, the browser releases the original and the
 * Passport page owns a fresh quote, owner proof, preparation, send and recovery. */
export async function qualifyClaimRetry(input) {
  const {
    output,
    quote,
    receipt,
    fixtureQuote,
    ownerProofSha256,
    registryAddress,
    accountAddress,
    rootId,
    price,
    compiled,
    registry,
    regProviders,
    walletModule,
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
    sponsorPaymentAddress,
  } = input;
  const sponsorDir = join(output, 'sponsor-journal');
  mkdirSync(sponsorDir, { mode: 0o700 });
  const sponsor = openClaimDispatch(sponsorDir);
  const originalJournal = openClaimDispatch(output);
  const originalBytes = originalJournal.preparedBytes(receipt);
  assert.ok(originalBytes);
  sponsor.retain(originalBytes, receipt);
  const digest = await claimQuoteDigest(fixtureQuote);
  assert.equal(receipt.quoteSha256, digest);
  createOnce(join(sponsorDir, `quote-${fixtureQuote.id}.json`), JSON.stringify(fixtureQuote));
  createOnce(
    join(sponsorDir, `quote-decision-${fixtureQuote.id}.json`),
    JSON.stringify({
      kind: 'intent',
      digest,
      ownerCommitment: receipt.ownerCommitment,
      proofSha256: ownerProofSha256,
    }),
  );
  createOnce(
    join(sponsorDir, 'claim-prepare-intent.json'),
    JSON.stringify({
      quoteId: fixtureQuote.id,
      digest,
      ownerCommitment: receipt.ownerCommitment,
      proofSha256: ownerProofSha256,
    }),
  );
  const first = await qualifyPartialClaim({ ...input, dispatchJournalDir: sponsorDir });
  assert.equal(first.indexedClaimFailure, true);
  assert.equal(first.originalDispatches, 1);
  assert.ok(sponsor.hasFence(receipt));
  let sponsorChecks = 0;
  const sponsorPorts = {
    async issue() {
      assert.fail('The failed-original journal must not issue a retry quote.');
    },
    async authorizeQuote() {},
    async balance() {
      assert.fail('Native failure retirement never balances.');
    },
    async retireIndexedFailure(original) {
      const until = Date.now() + 120_000;
      let error;
      while (Date.now() < until) {
        try {
          const confirmed = await verifyIndexedClaimFailure({
            receipt: original,
            nodeUrl: process.env.MN_NODE_URL,
            indexerUrl: process.env.MN_INDEXER_URL,
            protocolVersion: 2001100,
            reader: reads,
            profile,
          });
          sponsorChecks++;
          return confirmed;
        } catch (failure) {
          error = failure;
          await delay(1500);
        }
      }
      throw error ?? new Error('Exact indexed failure did not finalize.');
    },
  };
  const sponsorJournal = createClaimPreparationJournal(sponsorDir, sponsor, sponsorPorts);
  const retirement = await sponsorJournal.retireIndexedFailure(receipt);
  assert.deepEqual(retirement, { status: 'retired', reason: 'claim-failed' });
  assert.equal(sponsorChecks, 2);
  const archive = claimFailedArchivePath(sponsorDir, receipt);
  assert.deepEqual(openClaimDispatch(archive).preparedReceipt(), receipt);
  assert.equal(openClaimDispatch(sponsorDir).preparedReceipt(), undefined);
  saveIsolationReceipt(join(output, 'native-sponsor-failure-archive.json'), {
    original: receipt,
    reason: retirement.reason,
    sponsorChecks,
    archive,
  });
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
  // Rebuild the sponsor's coin view after the first transaction's partial result.
  step('refresh-sponsor-wallet-after-partial-result');
  const freshSponsor = await walletModule.createWallet('0'.repeat(63) + '1');
  let freshProviders;
  try {
    await walletModule.syncWallet(freshSponsor, 'isolated retry sponsor');
    assert.equal(
      Buffer.from(walletModule.userAddressBytes(freshSponsor)).toString('hex'),
      sponsorPaymentAddress,
    );
    freshProviders = await walletModule.createProviders(freshSponsor);
  } catch (error) {
    await freshSponsor.wallet.stop();
    throw error;
  }
  const retryDir = join(output, 'retry');
  let retryReceipt;
  let retryDispatches = 0;
  let second;
  try {
    mkdirSync(retryDir, { mode: 0o700 });
    second = await qualifyPageOwnedClaim({
      output: retryDir,
      ref,
      assets,
      modulePath,
      registryAddress,
      accountAddress,
      name: quote.name,
      failedOriginal: receipt,
      sponsorJournalDir: sponsorDir,
      sponsorPaymentAddress,
      walletProvider: freshProviders.walletProvider,
      submit: (tx) => providers.midnightProvider.submitTx(tx),
      ledger,
      parentDomain: parent,
      readLive,
      reads,
      profile,
      step,
    });
    retryReceipt = second.receipt;
    retryDispatches = second.dispatches;
    const browserRelease = second.page.browserRelease;
    assert.equal(browserRelease.originalDigest, receipt.transaction.sha256);
    assert.equal(browserRelease.releaseReason, 'CLAIM_SEGMENT_FAILURE');
    assert.equal(browserRelease.liveIndexerRequests > 0, true);
    saveIsolationReceipt(join(output, 'browser-claim-failed-release.json'), browserRelease);
    assert.notEqual(retryReceipt.transaction.sha256, receipt.transaction.sha256);
    assert.equal(second.page.recoveredInSameProfile, true);
  } finally {
    await freshSponsor.wallet.stop();
  }
  assert.equal(retryDispatches, 1);
  assert.ok(retryReceipt);
  const browserRelease = second.page.browserRelease;
  assert.equal(
    await readClaimFinality(process.env.MN_INDEXER_URL, receipt, fetch, 2001100),
    'claim-failed',
  );
  saveIsolationReceipt(join(output, 'indexed-claim-retry.json'), {
    original: receipt,
    retry: retryReceipt,
    originalDispatches: first.originalDispatches,
    retryDispatches,
    parentRestored: true,
    browserRelease,
    registryBoundToSameAccount: true,
  });
  return {
    indexedClaimFailure: true,
    indexedRetrySuccess: true,
    originalDispatches: first.originalDispatches,
    retryDispatches,
    browserRelease,
  };
}
