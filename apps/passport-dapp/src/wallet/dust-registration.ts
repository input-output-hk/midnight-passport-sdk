import { Transaction } from '@midnightntwrk/ledger-v9';
import type { FacadeState, WalletFacade } from '@midnightntwrk/wallet-sdk-facade';
import type { NightSendLeg } from '../midnames/night-send.js';

const ADDRESS = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-f0-9]{66}$/;

/** A wallet-held NIGHT output must be designated before it produces usable DUST. */
export function deviceDustRegistration(
  facade: WalletFacade,
  verifyingKey: Parameters<WalletFacade['registerNightUtxosForDustGeneration']>[1],
  sign: Parameters<WalletFacade['registerNightUtxosForDustGeneration']>[2],
  ready: () => Promise<FacadeState>,
) {
  let prepared:
    | { original: NightSendLeg; finalized: Awaited<ReturnType<WalletFacade['finalizeRecipe']>> }
    | undefined;
  let submitting = false;
  return {
    async prepare(): Promise<NightSendLeg> {
      if (prepared || submitting) throw new Error('A DUST registration is already prepared.');
      const state = await ready();
      const coins = state.unshielded.availableCoins.filter(
        (coin) => !coin.meta.registeredForDustGeneration,
      );
      if (coins.length === 0)
        throw new Error('No unregistered wallet NIGHT output is available for DUST generation.');
      if (coins.length > 32) throw new Error('Register wallet NIGHT outputs in a smaller batch.');
      const { fee } = await facade.estimateRegistration(coins);
      await facade.waitForGeneratedDust(coins, fee, { timeoutMs: 120_000 });
      const recipe = await facade.registerNightUtxosForDustGeneration(
        coins,
        verifyingKey,
        sign,
        await facade.dust.getAddress(),
      );
      const finalized = await facade.finalizeRecipe(recipe);
      const transaction = Transaction.deserialize(
        'signature',
        'proof',
        'binding',
        finalized.serialize(),
      );
      const original = {
        hash: transaction.transactionHash(),
        identifiers: transaction.identifiers(),
      };
      if (
        !ADDRESS.test(original.hash) ||
        original.identifiers.length === 0 ||
        original.identifiers.length > 32 ||
        original.identifiers.some((id) => !IDENTIFIER.test(id))
      )
        throw new Error('DUST registration has no valid Ledger 9 identity.');
      prepared = { original, finalized };
      return original;
    },
    async submit(original: NightSendLeg): Promise<string> {
      if (
        submitting ||
        !prepared ||
        original.hash !== prepared.original.hash ||
        JSON.stringify(original.identifiers) !== JSON.stringify(prepared.original.identifiers)
      )
        throw new Error('The prepared DUST registration identity changed.');
      submitting = true;
      const { finalized } = prepared;
      prepared = undefined;
      return String(await facade.submitTransaction(finalized));
    },
  };
}
