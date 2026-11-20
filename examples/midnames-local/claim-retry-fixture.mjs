import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readClaimFinality } from '../../apps/passport-dapp/src/midnames/claim-finality.ts';
import {
  claimDestination,
  claimQuoteDigest,
} from '../../apps/passport-dapp/src/midnames/claim-quote.ts';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';
import { openClaimDispatch } from './claim-dispatch.mts';
import { claimFailedArchivePath, createClaimPreparationJournal } from './claim-preparation.mts';
import { verifyIndexedClaimFailure } from './claim-indexed-failure.mjs';
import { createOnce } from './create-once.mts';
import { qualifyClaimHandoff } from './claim-handoff-fixture.mjs';
import { qualifyPartialClaim } from './claim-partial-probe.mjs';
import { qualifyBrowserClaim, runBrowser } from './claim-browser-fixture.mjs';

/** A separate, freshly prepared sponsored original follows the indexed failure.
 * The browser releases the first original, dispatches the fresh one and recovers
 * after a lost sponsor response. New quote issuance and proof remain host-driven. */
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
    registryManifestHash,
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
    async issue(destination) {
      assert.deepEqual(destination, claimDestination(fixtureQuote));
      await readLive(quote);
      return {
        ...fixtureQuote,
        id: randomBytes(32).toString('hex'),
        expiresAt: Date.now() + 240_000,
      };
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
  step('release-indexed-claim-failure-in-browser');
  saveIsolationReceipt(join(output, 'original-claim.json'), receipt);
  await runBrowser(output, undefined, 270_000, 'e2e/midnames-claim-failed.e2e.ts');
  const browserRelease = JSON.parse(
    readFileSync(join(output, 'browser-claim-failed-release.json'), 'utf8'),
  );
  assert.equal(browserRelease.originalDigest, receipt.transaction.sha256);
  assert.equal(browserRelease.releaseReason, 'CLAIM_SEGMENT_FAILURE');
  assert.equal(browserRelease.liveIndexerRequests > 0, true);
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
  const freshSponsorQuote = await sponsorJournal.issue(fixtureQuote);
  assert.notEqual(freshSponsorQuote.id, fixtureQuote.id);
  assert.equal(freshSponsorQuote.accountAddress, accountAddress);
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
    second = await qualifyClaimHandoff({
      output: retryDir,
      ref,
      assets,
      modulePath,
      registryManifestHash,
      registryAddress,
      accountAddress,
      sponsorPaymentAddress,
      walletProvider: freshProviders.walletProvider,
      ledger,
      rootId,
      parentDomain: parent,
      sponsorIssuedQuote: freshSponsorQuote,
      step,
      async dispatch(nextQuote, nextReceipt, nextFixtureQuote, ownerProofSha256) {
        await readLive(nextQuote);
        assert.equal(nextQuote.name, quote.name);
        assert.notEqual(nextReceipt.transaction.sha256, receipt.transaction.sha256);
        assert.equal(nextFixtureQuote.id, freshSponsorQuote.id);
        assert.ok(Date.now() < freshSponsorQuote.expiresAt);
        retryReceipt = nextReceipt;
        const browserRetry = await qualifyBrowserClaim({
          output: retryDir,
          quote: nextQuote,
          receipt: nextReceipt,
          fixtureQuote: nextFixtureQuote,
          ownerProofSha256,
          ledger,
          readLive: async (current) => {
            assert.ok(Date.now() < freshSponsorQuote.expiresAt, 'Fresh sponsor quote expired.');
            await readLive(current);
          },
          submit: async ({ tx }) => providers.midnightProvider.submitTx({ version: 'v9', tx }),
        });
        retryDispatches = browserRetry.dispatches;
        assert.equal(retryDispatches, 1);
        assert.equal(browserRetry.browser.recoveredAfterBrowserRestart, true);
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          const status = await readClaimFinality(
            process.env.MN_INDEXER_URL,
            nextReceipt,
            fetch,
            2001100,
          );
          if (status === true) break;
          assert.ok(status === false || status === undefined, `Fresh retry status: ${status}`);
          await delay(1500);
        }
        assert.equal(
          await readClaimFinality(process.env.MN_INDEXER_URL, nextReceipt, fetch, 2001100),
          true,
        );
        assert.deepEqual(await reads.readClaim(nextQuote.name, profile), {
          ownerCommitment: nextQuote.ownerCommitment,
          target: { kind: 'contract', address: accountAddress },
        });
        return { indexedRetrySuccess: true, retryDispatches };
      },
    });
  } finally {
    await freshSponsor.wallet.stop();
  }
  assert.equal(second.indexedRetrySuccess, true);
  assert.equal(retryDispatches, 1);
  assert.ok(retryReceipt);
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
