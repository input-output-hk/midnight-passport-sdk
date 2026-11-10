/** Reference-app state and injected controller dependencies; not SDK policy. */
/** Reference-app state and injected controller dependencies; not SDK policy. */
import type {
  PassportAccount,
  PassportConnectorAPI,
  PassportTxResult,
  PassportEvent,
} from '@input-output-hk/mn-passport-protocol';
import type { createUi } from './ui.js';
import type { DevWallet } from './wallet/dev-wallet.js';
import type { createDemoSession } from './session.js';
import type { createFundingBalanceReader } from './funding-balances.js';
import type { createOwnerReview } from './owner-review.js';
import type { createWalletPresentation } from './wallet/presentation.js';

export interface DemoAppState {
  api: PassportConnectorAPI | undefined;
  devWallet: DevWallet | undefined;
  account: PassportAccount | undefined;
  primaryAccount: PassportAccount | undefined;
  authenticatedAccount: PassportAccount | undefined;
  balanceAssetColor: string | undefined;
  sessionUsesRoutine: boolean;
  receiptStorageFailed: boolean;
  reviewedRoutineMinutes: number;
}
export const createDemoAppState = (): DemoAppState => ({
  api: undefined,
  devWallet: undefined,
  account: undefined,
  primaryAccount: undefined,
  authenticatedAccount: undefined,
  balanceAssetColor: undefined,
  sessionUsesRoutine: false,
  receiptStorageFailed: false,
  reviewedRoutineMinutes: 15,
});
export interface DemoActionHost {
  readonly state: DemoAppState;
  readonly network: string;
  readonly ui: ReturnType<typeof createUi>;
  readonly session: ReturnType<typeof createDemoSession>;
  readonly ownerReview: ReturnType<typeof createOwnerReview>;
  readonly fundingUrl: URL;
  readonly walletPresentation: ReturnType<typeof createWalletPresentation>;
  readonly stage: ReturnType<typeof createUi>['stage'];
  readonly record: ReturnType<typeof createUi>['record'];
  readonly status: ReturnType<typeof createUi>['status'];
  onEvent(event: PassportEvent): void;
  connector(): Promise<PassportConnectorAPI>;
  opened(account: PassportAccount, how: string, lastTx?: PassportTxResult): Promise<void>;
  refreshAccountBalances: ReturnType<typeof createFundingBalanceReader>;
  refreshAfterReceipt<T>(
    receipt: {
      action: string;
      accountAddress: string;
      txHash?: string;
      txIds?: readonly string[];
      grantId?: string;
    },
    read: () => Promise<T>,
  ): Promise<T | undefined>;
  sessionUse(): boolean;
  ownerAuthorization(): string;
  lockAllLocalKeys(): boolean;
}
