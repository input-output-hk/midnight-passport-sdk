/** Checked facts shared by the P-256 viewing-key transition phases. */
import type {
  DeviceRemovalResult,
  FlowOptions,
  ViewingKeyRotationResult,
} from '@input-output-hk/mn-passport-protocol';
import type { PassportConnectorError } from './errors.js';
import type { Flow } from './flow.js';
import type { DeviceInboxLedgerView } from './inbox-view.js';
import type { ReaderResolution } from './jubjub-readers.js';
import type { P256Hint, SealedP256Hint } from './p256-device.js';
import type { PreparedReadGrantDeliveries } from './read-grant-deliveries.js';
import type {
  AccBinding,
  AccLedgerView,
  AccountKeyring,
  AccountKeys,
  AccountViewingKey,
  Authoriser,
  Chain,
  LiveDeviceReader,
  OpenedInboxEntry,
  PassportPorts,
} from './ports/index.js';

export interface P256RotationContext {
  readonly ports: Pick<
    PassportPorts,
    'authoriser' | 'viewingKey' | 'network' | 'holdings' | 'readGrants'
  >;
  binding(): Promise<AccBinding>;
  chain(): Promise<Chain>;
  run<T>(options: FlowOptions, body: (flow: Flow) => Promise<T>): Promise<T>;
  findCounter(flow: Flow, record: P256Hint, view: AccLedgerView): Promise<bigint | undefined>;
  notHeld(record: P256Hint): PassportConnectorError;
  sealedKeyring(
    record: SealedP256Hint,
    view: AccLedgerView,
    pending: boolean,
    inOwnerSession: boolean,
  ): Promise<unknown>;
  appendP256(
    flow: Flow,
    record: SealedP256Hint,
    entry: Uint8Array,
    view: AccLedgerView,
  ): Promise<AccLedgerView>;
  awaitSealedView(
    record: SealedP256Hint,
    ready: (view: AccLedgerView) => boolean,
  ): Promise<AccLedgerView>;
  random(length: number): Uint8Array;
  sleep(ms: number): Promise<void>;
}

/** These references have always belonged to factory construction, not an individual phase. */
export interface P256RotationHost extends P256RotationContext {
  readonly authoriser: Authoriser;
  readonly viewingKey: AccountViewingKey | undefined;
  readonly networkId: string;
}

export interface RotationControls {
  readonly inOwnerSession?: boolean;
  readonly rotateRosterForEnrollment?: boolean;
}
export type RotationCallback = (state: {
  readonly encKey: Uint8Array;
  readonly authNonce: bigint;
}) => void;
export type RotationResult = ViewingKeyRotationResult | DeviceRemovalResult;
export type RotationIntent =
  | { readonly kind: 'rotate' }
  | {
      readonly kind: 'remove';
      readonly target: Uint8Array;
      readonly challenge: NonNullable<
        AccBinding['pureCircuits']['challenge_remove_device_with_p256']
      >;
    };
export interface RotationCapabilities {
  readonly keyring: AccountViewingKey;
  readonly reencrypt: NonNullable<AccountViewingKey['reencryptInbox']>;
  readonly decodeJubjub: NonNullable<AccountViewingKey['decodeDevicePublicKey']>;
  readonly decodeP256: NonNullable<AccountViewingKey['decodeP256DevicePublicKey']>;
  readonly deriveJubjub: NonNullable<AccBinding['pureCircuits']['derive_device_entry_with_jubjub']>;
}
export interface RotationOperation {
  readonly host: P256RotationHost;
  readonly record: SealedP256Hint;
  readonly flow: Flow;
  readonly pure: AccBinding['pureCircuits'];
  readonly capabilities: RotationCapabilities;
  readonly intent: RotationIntent;
  readonly excludedGrant: string | undefined;
  readonly controls: RotationControls;
}
export interface OpenedRotation {
  readonly view: DeviceInboxLedgerView;
  readonly counter: bigint;
  readonly oldEntries: readonly Uint8Array[];
  readonly oldKeyring: AccountKeyring;
  readonly opened: readonly (OpenedInboxEntry | null)[];
  readonly ownerReader: string;
  readonly ownerDevice: string;
  readonly roster: ReaderResolution;
  readonly removedReader: LiveDeviceReader | undefined;
}
export interface RotationMaterial {
  readonly keys: AccountKeys;
  readonly reencrypted: readonly Uint8Array[];
  readonly deliveries: PreparedReadGrantDeliveries;
  readonly appended: readonly Uint8Array[];
}
export interface PublishedRotation {
  readonly view: DeviceInboxLedgerView;
  readonly counter: bigint;
  readonly grantNonce: bigint;
}

export const rotationEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
