import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { prepareSponsoredClaim } from '../../apps/passport-dapp/src/midnames/claim-sponsorship.ts';
import { claimQuote, claimQuoteDigest } from '../../apps/passport-dapp/src/midnames/claim-quote.ts';
import { claimDigest, claimReceipt } from '../../apps/passport-dapp/src/midnames/claim-receipt.ts';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';
import { proveInOwnerProcess } from './claim-owner-process.mjs';
import { openClaimDispatch } from './claim-dispatch.mts';

/** The sponsor balances a proved registration produced by the isolated owner process. */
export async function qualifyClaimHandoff({
  output,
  ref,
  assets,
  modulePath,
  registryManifestHash,
  registryAddress,
  accountAddress,
  sponsorPaymentAddress,
  walletProvider,
  ledger,
  rootId,
  parentDomain,
  step,
  dispatch,
  browserOwner = false,
  preproofReview = false,
}) {
  const label = 'charlie';
  const { owner_address: registryPayee, payment_config: price } = parentDomain;
  assert.ok(price.buy_enabled);
  assert.ok(price.coin_color.every((byte) => byte === 0));
  assert.ok(!preproofReview || browserOwner);

  const reviewedQuote = preproofReview
    ? claimQuote({
        networkId: 'undeployed',
        registryAddress,
        accountAddress,
        name: label + '.night',
        id: randomBytes(32).toString('hex'),
        sponsorAddress: '33'.repeat(32),
        registryPayee: Buffer.from(registryPayee.bytes).toString('hex'),
        sponsorPaymentAddress,
        night: String(price.cost_long),
        maximumDust: '100000000000000000',
        expiresAt: Date.now() + 600_000,
      })
    : undefined;

  step(
    preproofReview
      ? 'review-quote-before-owner-proof-in-chromium'
      : browserOwner
        ? 'prove-claim-in-owner-chromium'
        : 'prove-claim-in-owner-process',
  );
  const owner = await proveInOwnerProcess(
    {
      ref,
      assets,
      modulePath,
      registryManifestHash,
      registryAddress,
      accountAddress,
      indexerUrl: process.env.MN_INDEXER_URL,
      indexerWsUrl: process.env.MN_INDEXER_WS_URL,
      proverUrl: process.env.MN_PROOF_SERVER_URL,
      walletKeys: {
        coin: await walletProvider.getCoinPublicKey(),
        encryption: await walletProvider.getEncryptionPublicKey(),
      },
      childOwnerAddress: new Uint8Array(32).fill(0x33),
      rootId,
      label,
      price,
      ...(reviewedQuote && { reviewedQuote }),
    },
    browserOwner,
  );
  const quote = {
    networkId: 'undeployed',
    registryAddress,
    accountAddress,
    name: label + '.night',
    ownerCommitment: owner.ownerCommitment,
    sponsorAddress: '33'.repeat(32),
    registryPayee: Buffer.from(registryPayee.bytes).toString('hex'),
    sponsorPaymentAddress,
    night: price.cost_long,
  };

  step('balance-owner-proof-with-sponsor');
  const prepared = await prepareSponsoredClaim(quote, owner.bytes, async (proved) => {
    const tx = ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', proved);
    const balanced = await walletProvider.balanceTx({ version: 'v9', tx });
    assert.equal(balanced.version, 'v9');
    return balanced.tx.serialize();
  });
  const final = ledger.Transaction.deserialize('signature', 'proof', 'binding', prepared.bytes);
  const sponsorInput = [...(final.intents?.values() ?? [])]
    .flatMap((intent) => [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer])
    .filter(Boolean)
    .flatMap((offer) => offer.inputs)[0];
  if (dispatch) {
    assert.ok(sponsorInput, 'Balanced claim needs a sponsor NIGHT input.');
    assert.equal(ledger.addressFromKey(sponsorInput.owner), sponsorPaymentAddress);
  }
  // The dedicated pre-proof lane pins its quote before the naming credential
  // is used. Other lanes retain their historical post-proof dispatch quote.
  const fixtureQuote =
    dispatch &&
    (reviewedQuote ??
      claimQuote({
        ...quote,
        id: prepared.receipt.transaction.sha256,
        night: String(quote.night),
        maximumDust: '100000000000000000',
        expiresAt: Date.now() + 600_000,
      }));
  const acknowledged = fixtureQuote
    ? claimReceipt({ ...prepared.receipt, quoteSha256: await claimQuoteDigest(fixtureQuote) })
    : prepared.receipt;
  const dustSpends = [...(final.intents?.values() ?? [])].reduce(
    (sum, intent) => sum + (intent.dustActions?.spends.length ?? 0),
    0,
  );
  openClaimDispatch(output).retain(prepared.bytes, acknowledged);
  saveIsolationReceipt(join(output, 'claim-handoff.json'), {
    receipt: acknowledged,
    quotedNight: String(quote.night),
    dustSpends,
    dispatches: 0,
    ownerProvedInSeparateProcess: true,
    ...(browserOwner && { ownerCredentialRestored: owner.restored }),
    ...(preproofReview && { reviewedBeforeOwnerProof: owner.reviewedBeforeProof }),
  });
  if (dispatch) {
    const result = await dispatch(
      quote,
      acknowledged,
      fixtureQuote,
      await claimDigest(owner.bytes),
    );
    return {
      ...result,
      ownerCredentialRestored: owner.restored,
      ...(preproofReview && { reviewedBeforeOwnerProof: owner.reviewedBeforeProof }),
    };
  }
  return {
    claimPrepared: true,
    dustSpends,
    claimDispatches: 0,
    ownerProvedInSeparateProcess: true,
    ...(browserOwner && { ownerCredentialRestored: owner.restored }),
  };
}
