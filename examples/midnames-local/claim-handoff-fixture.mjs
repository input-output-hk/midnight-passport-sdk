import assert from 'node:assert/strict';
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
  walletProvider,
  ledger,
  rootId,
  parentDomain,
  step,
  dispatch,
  browserOwner = false,
}) {
  const label = 'charlie';
  const { owner_address: registryPayee, payment_config: price } = parentDomain;
  assert.ok(price.buy_enabled);
  assert.ok(price.coin_color.every((byte) => byte === 0));

  step(browserOwner ? 'prove-claim-in-owner-chromium' : 'prove-claim-in-owner-process');
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
    },
    browserOwner,
  );
  const quote = {
    networkId: 'undeployed',
    registryAddress,
    accountAddress,
    name: label + '.night',
    ownerCommitment: owner.ownerCommitment,
    registryPayee: Buffer.from(registryPayee.bytes).toString('hex'),
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
  if (dispatch) assert.ok(sponsorInput, 'Balanced claim needs a sponsor NIGHT input.');
  const reviewedQuote =
    dispatch &&
    claimQuote({
      ...quote,
      id: prepared.receipt.transaction.sha256,
      sponsorAddress: ledger.addressFromKey(sponsorInput.owner),
      night: String(quote.night),
      maximumDust: '100000000000000000',
      expiresAt: Date.now() + 600_000,
    });
  const acknowledged = reviewedQuote
    ? claimReceipt({ ...prepared.receipt, quoteSha256: await claimQuoteDigest(reviewedQuote) })
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
  });
  if (dispatch) {
    const result = await dispatch(
      quote,
      acknowledged,
      reviewedQuote,
      await claimDigest(owner.bytes),
    );
    return { ...result, ownerCredentialRestored: owner.restored };
  }
  return {
    claimPrepared: true,
    dustSpends,
    claimDispatches: 0,
    ownerProvedInSeparateProcess: true,
    ...(browserOwner && { ownerCredentialRestored: owner.restored }),
  };
}
