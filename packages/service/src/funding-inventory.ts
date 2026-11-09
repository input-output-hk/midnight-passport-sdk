/** A host-owned, current observation of spendable unshielded wallet balances. */
export interface FundingInventory {
  readonly synced: boolean;
  readonly balances: Readonly<Record<string, bigint>>;
}

export type FundingPreflightCode = 'FundingAssetUnavailable' | 'FundingWalletUnavailable';

/** Fixed diagnostics only: never copy a wallet exception, witness or secret into this error. */
export class FundingPreflightError extends Error {
  readonly code: FundingPreflightCode;

  constructor(code: FundingPreflightCode) {
    super(
      code === 'FundingAssetUnavailable'
        ? 'The funding wallet does not hold enough of this asset.'
        : 'The funding wallet inventory is unavailable or not synchronized.',
    );
    this.name = 'FundingPreflightError';
    this.code = code;
  }
}

/** Validate the host observation; an unreadable or unsynchronized wallet is never zero. */
export async function fundingInventory(
  read: () => Promise<FundingInventory>,
): Promise<FundingInventory> {
  try {
    const snapshot = await read();
    if (
      !snapshot ||
      snapshot.synced !== true ||
      !snapshot.balances ||
      typeof snapshot.balances !== 'object' ||
      Array.isArray(snapshot.balances)
    )
      throw new FundingPreflightError('FundingWalletUnavailable');
    const balances: Record<string, bigint> = Object.create(null);
    for (const [color, amount] of Object.entries(snapshot.balances)) {
      if (!/^[0-9a-f]{64}$/.test(color) || typeof amount !== 'bigint' || amount < 0n)
        throw new FundingPreflightError('FundingWalletUnavailable');
      balances[color] = amount;
    }
    return { synced: true, balances: Object.freeze(balances) };
  } catch {
    throw new FundingPreflightError('FundingWalletUnavailable');
  }
}
