import {
  fundingInventory,
  FundingPreflightError,
  json,
  HttpError,
  type FundingInventory,
  type Route,
} from '@input-output-hk/mn-passport-service';
import type { FundingConfig } from './config.ts';

interface InventoryState {
  readonly unshielded: {
    readonly progress: { isStrictlyComplete(): boolean };
    readonly balances: Readonly<Record<string, bigint>>;
  };
}

/** Read one snapshot from the existing wallet, without starting another wallet or waiting on DUST. */
export interface InventoryWallet {
  state(): {
    subscribe(observer: { next(state: InventoryState): void; error(error: unknown): void }): {
      unsubscribe(): void;
    };
  };
}

export function walletInventory(wallet: InventoryWallet): Promise<FundingInventory> {
  return new Promise((resolve, reject) => {
    let subscription: { unsubscribe(): void } | undefined;
    let settled = false;
    const finish = (state?: InventoryState) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      subscription?.unsubscribe();
      try {
        if (!state) throw new Error('No wallet snapshot');
        resolve({
          synced: state.unshielded.progress.isStrictlyComplete(),
          balances: { ...state.unshielded.balances },
        });
      } catch {
        reject(new FundingPreflightError('FundingWalletUnavailable'));
      }
    };
    const deadline = setTimeout(() => finish(), 5000);
    try {
      subscription = wallet.state().subscribe({ next: finish, error: () => finish() });
      // BehaviorSubject may deliver synchronously, before subscribe returns its handle.
      if (settled) subscription.unsubscribe();
    } catch {
      finish();
    }
  });
}

/** Advisory inventory never replaces the queued preflight immediately before a deposit. */
export function inventoryRoute(
  config: Pick<FundingConfig, 'networkId' | 'bindingId' | 'manifestSha256' | 'assets'>,
  read: () => Promise<FundingInventory>,
  authorized: (header: string | undefined) => boolean,
): Route {
  return async (request, response, url) => {
    if (url.pathname !== '/v1/faucet/assets') return false;
    if (request.method !== 'GET') throw new HttpError(405, 'method not allowed');
    if (!authorized(request.headers.authorization))
      throw new HttpError(403, 'funding caller refused');
    const snapshot = await fundingInventory(read).catch(() => undefined);
    json(response, 200, {
      networkId: config.networkId,
      bindingId: config.bindingId,
      manifestSha256: config.manifestSha256,
      assets: config.assets.map((asset) => {
        const amount = asset.maxPerRequest < 10n ? asset.maxPerRequest : 10n;
        return {
          color: asset.color,
          amount: amount.toString(),
          availability: snapshot
            ? (snapshot.balances[asset.color] ?? 0n) >= amount
              ? 'available'
              : 'insufficient'
            : 'unavailable',
        };
      }),
    });
    return true;
  };
}
