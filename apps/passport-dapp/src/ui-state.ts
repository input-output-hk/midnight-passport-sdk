import { EventLog } from './event-log.js';
import { createActivityStore } from '@input-output-hk/mn-passport-account/interaction';
import type {
  PassportAccountState,
  PassportTxResult,
  PassportGrantRoster,
} from '@input-output-hk/mn-passport-protocol';
import type { WalletView } from './wallet/view.js';
import type { DemoFundingAsset } from './funding.js';
import type { ActionId } from './flows.js';
import type { createUiDom } from './ui-dom.js';
export interface EvidenceHeader {
  readonly note: string;
  readonly passkey: string;
  readonly network: string;
  readonly serviceUrl: string;
  readonly pinnedManifestSha256: string;
  readonly apiVersion?: string;
}
export interface AccountView {
  readonly address: string;
  readonly networkId: string;
  readonly bindingId: string;
  readonly state: PassportAccountState;
  readonly lastTx?: PassportTxResult;
}
export type UiDom = ReturnType<typeof createUiDom>;
export interface UiConsent {
  before(action: ActionId): Promise<boolean>;
  after(): void;
  run?(action: ActionId, operation: () => Promise<void>): Promise<void>;
}
export interface UiModel {
  readonly header: EvidenceHeader;
  readonly log: EventLog;
  readonly activity: ReturnType<typeof createActivityStore>;
  ready: boolean;
  account: AccountView | undefined;
  wallet: WalletView;
  externalWalletConnected: boolean;
  fundingAsset: DemoFundingAsset | undefined;
  assetsByColor: Map<string, DemoFundingAsset>;
  accountBalances:
    | { address: string; color: string; night?: string; fundedAsset?: string; error?: string }
    | undefined;
  shieldedHoldings:
    | { address: string; coins: readonly { inboxIndex: number; color: string; value: string }[] }
    | undefined;
  deviceRoster:
    | { address: string; deviceEpoch: bigint; authNonce: bigint; commitments: readonly string[] }
    | undefined;
  grantRoster: { address: string; roster: PassportGrantRoster } | undefined;
}
export function createUiModel(header: EvidenceHeader): UiModel {
  return {
    header,
    log: new EventLog(),
    activity: createActivityStore(),
    ready: true,
    account: undefined,
    wallet: {},
    externalWalletConnected: false,
    fundingAsset: undefined,
    assetsByColor: new Map<string, DemoFundingAsset>(),
    accountBalances: undefined,
    shieldedHoldings: undefined,
    deviceRoster: undefined,
    grantRoster: undefined,
  };
}
