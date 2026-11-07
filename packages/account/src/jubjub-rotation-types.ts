/** Internal facts passed between the JubJub viewing-key transition phases. */
import type {
  DeviceEnrollmentResult,
  FlowOptions,
  PassportDeviceReader,
} from '@input-output-hk/mn-passport-protocol';
import type { Flow } from './flow.js';
import type { DeviceInboxLedgerView, InboxLedgerView } from './inbox-view.js';
import type { RevokeJubjubGrantPure } from './jubjub-grant-revoke.js';
import type { ReaderResolution } from './jubjub-readers.js';
import type { PreparedReadGrantDeliveries } from './read-grant-deliveries.js';
import type {
  AccBinding,
  AccountHint,
  AccountKeyring,
  AccountKeys,
  AccountRecordStore,
  AccountViewingKey,
  ActiveReadGrantTarget,
  ActiveReadGrantTargetSource,
  Authoriser,
  Chain,
  DeviceReader,
  GrantDetailSource,
  JubjubPureCircuits,
  LiveDeviceReader,
  OpenedInboxEntry,
  PassportPorts,
  VerifiedHoldingSource,
} from './ports/index.js';

export type JubjubHint = AccountHint & {
  readonly scheme: 'jubjub-schnorr';
  readonly credentialId: Uint8Array;
};

export interface EnrollmentContext {
  readonly reader: PassportDeviceReader;
  readonly entry: Uint8Array;
  readonly initial: DeviceInboxLedgerView;
  readonly grants: readonly ActiveReadGrantTarget[];
}

export interface JubjubRotationContext {
  readonly ports: Pick<
    PassportPorts,
    'network' | 'holdings' | 'readGrants' | 'records' | 'grantDetails'
  >;
  readonly authoriser: Authoriser;
  readonly viewingKey: AccountViewingKey;
  withOwnerSession: NonNullable<Authoriser['withKeySession']>;
  ownerPublicKeyHex(): Promise<string>;
  resolveBinding(record: JubjubHint): Promise<{ binding: AccBinding; pure: JubjubPureCircuits }>;
  revocationPure(): Promise<RevokeJubjubGrantPure>;
  read(record: JubjubHint): Promise<DeviceInboxLedgerView>;
  chain(): Promise<Chain>;
  findCounter(record: JubjubHint, view: InboxLedgerView): bigint | undefined;
  keyring(record: JubjubHint, view: InboxLedgerView, pending: boolean): Promise<void>;
  append(
    flow: Flow,
    record: JubjubHint,
    entry: Uint8Array,
    view: InboxLedgerView,
  ): Promise<InboxLedgerView>;
  advanced(record: JubjubHint, nonce: bigint): Promise<InboxLedgerView>;
  completeEnrollment(
    flow: Flow,
    record: JubjubHint,
    pure: JubjubPureCircuits,
    view: InboxLedgerView,
    reader: PassportDeviceReader,
    entry: Uint8Array,
    grants: readonly ActiveReadGrantTarget[],
  ): Promise<DeviceEnrollmentResult>;
  conflictsWithReader(registered: DeviceReader, joining: PassportDeviceReader): boolean;
  run<T>(options: FlowOptions, work: (flow: Flow) => Promise<T>): Promise<T>;
  random(length: number): Uint8Array;
  sleep(ms: number): Promise<void>;
}

export interface RotationCapabilities {
  readonly holdings: VerifiedHoldingSource;
  readonly reencrypt: NonNullable<AccountViewingKey['reencryptInbox']>;
  readonly decode: NonNullable<AccountViewingKey['decodeDevicePublicKey']>;
  readonly readGrants: ActiveReadGrantTargetSource;
}

export interface RotationRevocation {
  readonly grantId: string;
  readonly records: AccountRecordStore;
  readonly grants: GrantDetailSource;
}

/** Every authority-changing branch carries the initial state approved by its owner scope. */
export type RotationIntent =
  | { readonly kind: 'rotate' }
  | {
      readonly kind: 'remove';
      readonly target: Uint8Array;
      readonly initial: DeviceInboxLedgerView;
    }
  | {
      readonly kind: 'enroll';
      readonly enrollment: EnrollmentContext;
      readonly initial: DeviceInboxLedgerView;
    }
  | {
      readonly kind: 'revoke';
      readonly revocation: RotationRevocation;
      readonly initial: DeviceInboxLedgerView;
    }
  | { readonly kind: 'revoke-all'; readonly initial: DeviceInboxLedgerView };

export interface RotationOperation {
  readonly context: JubjubRotationContext;
  readonly record: JubjubHint;
  readonly flow: Flow;
  readonly capabilities: RotationCapabilities;
  readonly binding: AccBinding;
  readonly pure: JubjubPureCircuits;
  readonly intent: RotationIntent;
}

export interface OpenRotation {
  readonly view: DeviceInboxLedgerView;
  readonly oldEntries: readonly Uint8Array[];
  readonly oldKeyring: AccountKeyring;
  readonly opened: readonly (OpenedInboxEntry | null)[];
  readonly ownEntry: Uint8Array;
  readonly reader: string;
  readonly device: string;
  readonly roster: ReaderResolution;
  readonly removedReader: LiveDeviceReader | undefined;
}

export interface RotationMaterial {
  readonly keys: AccountKeys;
  readonly reencrypted: readonly Uint8Array[];
  readonly deliveries: PreparedReadGrantDeliveries;
  readonly deliveryEntries: readonly Uint8Array[];
}

export const rotationEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);
