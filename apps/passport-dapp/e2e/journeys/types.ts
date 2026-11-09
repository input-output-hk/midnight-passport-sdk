import type { BrowserContext, Page } from 'playwright-core';
import type { JourneyArm } from '../journey-arms.js';
export interface FixtureState {
  ownerPublicKey?: string;
  nonce: number;
  epoch: number;
  entries: string[];
  night: number;
  wallet: number;
  txHash: string;
  grant?: { id: string; active: boolean; scope: Record<string, unknown>; spent: number };
}
export interface JourneyFlags {
  unknownFunding: boolean;
  emptyFunding?: boolean;
  multipleFundingAssets?: boolean;
  customFundingUnavailable?: boolean;
  rejectFundingPreflight?: boolean;
  unknownWithdrawal: boolean;
  unsettledGrantSpend: boolean;
  unknownSession: boolean;
  unknownRevocation: boolean;
  holdSessionSpend: (() => Promise<void>) | undefined;
  heldOwnerAction: string | undefined;
  holdOwnerReceipt: (() => Promise<void>) | undefined;
  receiptReadUnavailable: boolean;
  serviceUnavailable: boolean;
  staleOwnerReads: boolean;
  staleReadCount: number;
  rejectNextDialog: boolean;
}
export interface JourneyEvidence {
  failures: string[];
  pageErrors: string[];
  credentialFailureCodes: string[];
  archivedPurposes: Record<string, string[]>;
  closingContexts: WeakSet<BrowserContext>;
}
export interface JourneyHarness extends JourneyEvidence {
  arm: JourneyArm;
  state: FixtureState;
  flags: JourneyFlags;
  calls: string[];
  fundingIds: string[];
  fundedIds: Map<string, number>;
  contexts: BrowserContext[];
  newPage(existing?: BrowserContext, reactExample?: boolean, fragment?: string): Promise<Page>;
  done(id: string): void;
  waitStatus(page: Page, expected: RegExp, expectedError?: RegExp): Promise<void>;
  archiveObservations(page: Page, arm: string): Promise<void>;
}
