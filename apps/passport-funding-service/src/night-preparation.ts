import { UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';

const NIGHT = '00'.repeat(32);

/** Minimal reference-wallet surface used for the localnet's exact-value NIGHT input. */
export interface NightWallet {
  transferTransaction(
    outputs: readonly [
      {
        type: 'unshielded';
        outputs: readonly [{ type: string; receiverAddress: UnshieldedAddress; amount: bigint }];
      },
    ],
    options: { ttl: Date },
  ): Promise<unknown>;
  signRecipe(recipe: unknown, sign: (payload: Uint8Array) => Promise<unknown>): Promise<unknown>;
  finalizeRecipe(recipe: unknown): Promise<unknown>;
  submitTransaction(transaction: unknown): Promise<string>;
}

/**
 * The pinned localnet rejects a NIGHT ACC call when wallet balancing creates a change output.
 * Split the sponsor's large NIGHT coin into an exact deposit UTXO first. The wallet then selects
 * that UTXO for deposit_unshielded; the node-backed run confirms both transactions and ACC credit.
 */
export async function prepareLocalnetNight(
  wallet: NightWallet,
  ownerAddressBytes: Uint8Array,
  sign: (payload: Uint8Array) => Promise<unknown>,
  color: Uint8Array,
  amount: bigint,
): Promise<string | undefined> {
  if (Buffer.from(color).toString('hex') !== NIGHT) return undefined;
  const recipient = new UnshieldedAddress(Buffer.from(ownerAddressBytes));
  const recipe = await wallet.transferTransaction(
    [{ type: 'unshielded', outputs: [{ type: NIGHT, receiverAddress: recipient, amount }] }],
    { ttl: new Date(Date.now() + 60_000) },
  );
  const signed = await wallet.signRecipe(recipe, sign);
  const transaction = await wallet.finalizeRecipe(signed);
  return wallet.submitTransaction(transaction);
}
