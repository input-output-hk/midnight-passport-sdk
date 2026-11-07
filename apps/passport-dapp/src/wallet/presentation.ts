import type { DevWalletConnectedApi } from './contracts.js';
import type { WalletView } from './view.js';
import { createWalletBalanceReader } from './balances.js';

/** Demo wiring only. SDK packages do not depend on these labels, UI effects or audit sink. */
export function createWalletPresentation(options: {
  network: string;
  showWallet(view: WalletView): void;
  record(name: string, data: Record<string, unknown>): void;
  status(message: string): void;
  trace(kind: string, details: Record<string, unknown>): void;
}) {
  const { network, showWallet, record, status, trace } = options;
  const reader = createWalletBalanceReader({
    onDust(observation) {
      if (observation.status === 'ready') {
        showWallet({
          dust: observation.dust,
          dustStatus: 'ready',
          dustUpdatedAt: observation.updatedAt,
        });
        const details = {
          networkId: network,
          revision: observation.revision,
          balance: observation.dust.balance.toString(),
          cap: observation.dust.cap.toString(),
          updatedAt: observation.updatedAt,
        };
        trace('wallet.dust.balances', details);
      } else {
        showWallet({ dust: undefined, dustStatus: observation.status, dustUpdatedAt: undefined });
        if (observation.status === 'unavailable')
          trace('wallet.dust.unavailable', { networkId: network, revision: observation.revision });
      }
    },
  });
  let revision = 0;
  const invalidate = () => {
    revision++;
    reader.invalidate();
  };
  return {
    invalidate,
    async refresh(wallet: DevWalletConnectedApi, action: 'connect' | 'refresh') {
      const own = ++revision;
      try {
        const [snapshot, shielded] = await Promise.all([
          reader.refresh(wallet),
          wallet.getShieldedAddresses(),
        ]);
        if (own !== revision) throw new Error('This wallet observation was replaced.');
        showWallet({
          shieldedAddress: shielded.shieldedAddress,
          ...snapshot,
          balanceError: undefined,
        });
        record('balances', { shielded, ...snapshot });
        trace('wallet.balances', {
          networkId: network,
          shieldedAddress: shielded.shieldedAddress,
          unshieldedBalances: Object.fromEntries(
            Object.entries(snapshot.unshieldedBalances).map(([color, value]) => [
              color,
              value.toString(),
            ]),
          ),
          balanceUpdatedAt: snapshot.balanceUpdatedAt,
        });
        status(
          action === 'connect'
            ? 'Built-in wallet connected through the DApp Connector API; NIGHT balance read. DUST syncs independently. Refresh after receiving funds.'
            : 'Built-in wallet balance snapshot refreshed. DUST syncs independently; refresh again if incoming funds are not yet observed.',
        );
        return snapshot;
      } catch (error) {
        if (own === revision) {
          // Failed NIGHT does not erase an independently observed DUST snapshot.
          showWallet({
            unshieldedBalances: undefined,
            balanceUpdatedAt: undefined,
            balanceError: 'See the event log; retry Refresh wallet balance.',
          });
          status(
            action === 'connect'
              ? 'Built-in wallet connected, but its NIGHT balance could not be read (see the event log).'
              : 'Wallet balance refresh failed; the wallet remains connected. See the event log and retry.',
          );
        }
        throw error;
      }
    },
  };
}
