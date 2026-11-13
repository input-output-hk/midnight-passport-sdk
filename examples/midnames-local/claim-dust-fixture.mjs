import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

async function observe(read, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (result !== undefined) return result;
    await delay(1000);
  }
  throw new Error('Timed out observing synthetic DUST inputs.');
}

/** Delegate two differently sized synthetic NIGHT outputs to the fixture sponsor. */
export async function delegateClaimDust({ wallet, walletModule, providers, ledger, get, step }) {
  const funding = await walletModule.createWallet(randomBytes(32).toString('hex'));
  const sponsor = wallet.wallet;
  const source = funding.wallet;
  try {
    await walletModule.syncWallet(funding, 'isolated NIGHT funding wallet');
    const [{ firstValueFrom }, { UnshieldedAddress }] = await Promise.all([
      get('rxjs'),
      get('@midnightntwrk/wallet-sdk-address-format'),
    ]);
    const recipient = funding.unshieldedKeystore
      .getBech32Address()
      .decode(UnshieldedAddress, 'undeployed');
    const values = [100_000_000n, 20_000_000_000_000n];
    const submit = async (facade, recipe) => {
      const finalized = await facade.finalizeRecipe(recipe);
      const tx = ledger.Transaction.deserialize(
        'signature',
        'proof',
        'binding',
        finalized.serialize(),
      );
      await providers.midnightProvider.submitTx({ version: 'v9', tx });
    };
    step('submit-sponsor-night-split');
    const transfer = await sponsor.transferTransaction(
      [
        {
          type: 'unshielded',
          outputs: values.map((amount) => ({
            type: '00'.repeat(32),
            receiverAddress: recipient,
            amount,
          })),
        },
      ],
      { ttl: new Date(Date.now() + 60_000) },
    );
    await submit(
      sponsor,
      await sponsor.signRecipe(transfer, (bytes) => wallet.unshieldedKeystore.signDataAsync(bytes)),
    );
    const coins = await observe(async () => {
      const { unshielded } = await firstValueFrom(source.state());
      const selected = values.map((amount) =>
        unshielded.availableCoins.find((coin) => coin.utxo.value === amount),
      );
      return selected.every(Boolean) ? selected : undefined;
    }, 60_000);
    assert.ok(coins.every(({ meta }) => !meta.registeredForDustGeneration));
    const { fee } = await source.estimateRegistration(coins);
    await observe(async () => {
      const { dust } = await firstValueFrom(source.state());
      const projected = dust.estimateDustGeneration(
        coins.map(({ utxo, meta }) => ({ ...utxo, ...meta })),
        new Date(),
      );
      return projected.some(({ dust }) => dust.generatedNow >= fee) ? true : undefined;
    }, 100_000);
    step('submit-sponsor-dust-registration');
    await submit(
      source,
      await source.registerNightUtxosForDustGeneration(
        coins,
        funding.unshieldedKeystore.getPublicKey(),
        (bytes) => funding.unshieldedKeystore.signDataAsync(bytes),
        await sponsor.dust.getAddress(),
      ),
    );
    return await observe(async () => {
      const view = await firstValueFrom(sponsor.state());
      const count = view.dust.availableCoins.length;
      return view.isSynced && count >= 2 ? count : undefined;
    }, 90_000);
  } finally {
    await source.stop();
  }
}
