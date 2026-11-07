import type { DevWalletConnectedApi } from './dev-wallet.js';

export interface NightSnapshot {
  readonly unshieldedBalances: Readonly<Record<string, bigint>>;
  readonly balanceUpdatedAt: string;
}
export type DustObservation =
  | { readonly status: 'syncing' | 'unavailable'; readonly revision: number }
  | {
      readonly status: 'ready';
      readonly revision: number;
      readonly dust: { readonly balance: bigint; readonly cap: bigint };
      readonly updatedAt: string;
    };

/** Single-writer read model: NIGHT resolves independently; stale DUST never replaces newer UI. */
export function createWalletBalanceReader(options: {
  onDust(observation: DustObservation): void;
  now?: () => number;
}) {
  let revision = 0;
  let pending:
    | {
        wallet: Pick<DevWalletConnectedApi, 'getDustBalance'>;
        promise: Promise<{ balance: bigint; cap: bigint }>;
      }
    | undefined;
  const notify = (observation: DustObservation) => {
    try {
      options.onDust(Object.freeze(observation));
    } catch {
      /* An observer cannot fail an independent balance read. */
    }
  };
  const timestamp = () => new Date((options.now ?? Date.now)()).toISOString();
  return {
    invalidate() {
      revision++;
      pending = undefined;
    },
    async refresh(
      wallet: Pick<DevWalletConnectedApi, 'getUnshieldedBalances' | 'getDustBalance'>,
    ): Promise<NightSnapshot> {
      const own = ++revision;
      notify({ status: 'syncing', revision: own });
      if (!pending || pending.wallet !== wallet) {
        const request = { wallet, promise: Promise.resolve().then(() => wallet.getDustBalance()) };
        pending = request;
        const clear = () => {
          if (pending === request) pending = undefined;
        };
        void request.promise.then(clear, clear);
      }
      void pending.promise
        .then(
          (dust) => {
            if (own === revision)
              notify({
                status: 'ready',
                revision: own,
                dust: Object.freeze({ ...dust }),
                updatedAt: timestamp(),
              });
          },
          () => {
            if (own === revision) notify({ status: 'unavailable', revision: own });
          },
        )
        .catch(() => {
          /* Observer/clock failures cannot produce an unhandled task rejection. */
        });
      const balances = await wallet.getUnshieldedBalances();
      if (own !== revision) throw new Error('This wallet balance read was replaced.');
      return Object.freeze({
        unshieldedBalances: Object.freeze({ ...balances }),
        balanceUpdatedAt: timestamp(),
      });
    },
  };
}
