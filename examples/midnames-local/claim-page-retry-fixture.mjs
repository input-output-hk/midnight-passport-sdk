import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createMidnamesIndexer,
  createMidnamesLedgerReads,
} from '../../apps/passport-dapp/src/midnames/ledger-reader.ts';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';
import { verifyIndexedClaimSuccess } from './claim-indexed-failure.mjs';
import { claimFailedArchivePath } from './claim-preparation.mts';
import { openClaimDispatch } from './claim-dispatch.mts';
import { qualifyPageOwnedClaim } from './claim-page-fixture.mjs';

/** Prepare both originals in one Passport page profile. A registry policy race
 * makes the first claim fail after sponsor admission; only exact indexed
 * failure, sponsor archival and browser release permit the reviewed retry. */
export async function qualifyPageRetry(input) {
  const {
    output,
    quoteName,
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
    reads,
    candidateQualification,
    profile,
    step,
    sponsorPaymentAddress,
  } = input;
  const sponsorDir = join(output, 'page-sponsor-journal');
  const pageDir = join(output, 'page-retry');
  mkdirSync(sponsorDir, { mode: 0o700 });
  let firstReceipt;
  let policyDisabled = false;
  let freshSponsor;
  try {
    const result = await qualifyPageOwnedClaim({
      ...input,
      output: pageDir,
      name: quoteName,
      sponsorJournalDir: sponsorDir,
      walletProvider: regProviders.walletProvider,
      submit: (tx) => providers.midnightProvider.submitTx(tx),
      parentDomain: registry
        .ledger((await providers.publicDataProvider.queryContractState(registryAddress)).data)
        .id_to_data.lookup(rootId),
      firstAttemptFailure: {
        async disableParent() {
          assert.equal(policyDisabled, false);
          firstReceipt = openClaimDispatch(sponsorDir).preparedReceipt();
          assert.ok(firstReceipt, 'The first page-owned original must be prepared.');
          step('disable-parent-after-first-page-claim-admission');
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
          policyDisabled = true;
        },
        async restoreAndRefresh() {
          assert.equal(policyDisabled, true);
          assert.ok(firstReceipt);
          assert.deepEqual(
            openClaimDispatch(claimFailedArchivePath(sponsorDir, firstReceipt)).preparedReceipt(),
            firstReceipt,
          );
          assert.equal(await reads.readClaim(quoteName, profile), undefined);
          step('restore-parent-after-page-owned-failure');
          await contracts.submitCallTx(regProviders, {
            compiledContract: compiled,
            contractAddress: registryAddress,
            circuitId: 'update_payment_config',
            privateStateId: 'midnames-registry',
            args: [rootId, { ...price, buy_enabled: true }],
          });
          const current = await providers.publicDataProvider.queryContractState(registryAddress);
          assert.equal(
            registry.ledger(current.data).id_to_data.lookup(rootId).payment_config.buy_enabled,
            true,
          );
          step('refresh-sponsor-wallet-after-page-owned-failure');
          freshSponsor = await walletModule.createWallet('0'.repeat(63) + '1');
          await walletModule.syncWallet(freshSponsor, 'page-owned retry sponsor');
          assert.equal(
            Buffer.from(walletModule.userAddressBytes(freshSponsor)).toString('hex'),
            sponsorPaymentAddress,
          );
          const refreshed = await walletModule.createProviders(freshSponsor);
          return refreshed.walletProvider;
        },
      },
    });
    assert.equal(policyDisabled, true);
    assert.deepEqual(result.firstReceipt, firstReceipt);
    assert.equal(result.dispatches, 2);
    assert.equal(result.page.quoteRequests, 2);
    assert.equal(result.page.proofRequests, 2);
    assert.equal(result.page.prepareRequests, 2);
    assert.equal(result.page.dispatchRequests, 2);
    assert.ok(['acknowledged', 'unknown'].includes(result.page.firstDispatchTransport));
    assert.equal(result.page.browserRelease.originalDigest, firstReceipt.transaction.sha256);
    assert.equal(firstReceipt.ownerCommitment, result.receipt.ownerCommitment);
    assert.equal(result.page.recoveredInSameProfile, true);
    const indexer = createMidnamesIndexer(
      'undeployed',
      process.env.MN_INDEXER_URL,
      process.env.MN_INDEXER_WS_URL,
    );
    let finalizedSuccess;
    let lastFailure;
    try {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline && !finalizedSuccess) {
        try {
          finalizedSuccess = await verifyIndexedClaimSuccess({
            receipt: result.receipt,
            nodeUrl: process.env.MN_NODE_URL,
            indexerUrl: process.env.MN_INDEXER_URL,
            protocolVersion: 2001100,
            async readBindingAt(blockHash) {
              const pinned = {
                ...indexer,
                queryContractState: (address) =>
                  indexer.queryContractState(address, { type: 'blockHash', blockHash }),
              };
              const reader = createMidnamesLedgerReads(
                pinned,
                'undeployed',
                candidateQualification?.bindingId ?? 'acc-s3r1.1',
                'standalone-0.35',
                candidateQualification,
              );
              const claim = await reader.readClaim(quoteName, profile);
              return (
                claim && {
                  ...claim,
                  supportedAccount: await reader.isSupportedAccount(accountAddress, 'undeployed'),
                }
              );
            },
          });
        } catch (error) {
          lastFailure = error;
          await delay(1500);
        }
      }
    } finally {
      await indexer.dispose?.();
    }
    if (!finalizedSuccess)
      throw new Error('The page-owned retry did not reach canonical finalized binding.', {
        cause: lastFailure,
      });
    saveIsolationReceipt(join(output, 'indexed-page-owned-retry.json'), {
      original: firstReceipt,
      retry: result.receipt,
      originalDispatches: 1,
      retryDispatches: 1,
      page: result.page,
      registryBoundToSameAccount: true,
      finalizedSuccess,
    });
    return {
      indexedClaimFailure: true,
      indexedRetrySuccess: true,
      originalDispatches: 1,
      retryDispatches: 1,
      pagePreparedBothOriginals: true,
    };
  } finally {
    await freshSponsor?.wallet.stop();
  }
}
