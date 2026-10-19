import type { DevWalletConnectedApi } from './dev-wallet.js';

/** Read a fresh synced snapshot using the existing connection; no seed or passkey is needed. */
export async function readWalletBalances(
  wallet: Pick<DevWalletConnectedApi, 'getUnshieldedBalances' | 'getDustBalance'>,
) {
  const [unshieldedBalances, dust] = await Promise.all([
    wallet.getUnshieldedBalances(),
    wallet.getDustBalance(),
  ]);
  return { unshieldedBalances, dust, balanceUpdatedAt: new Date().toISOString() };
}
