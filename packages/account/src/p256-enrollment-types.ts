/** Internal checked inputs and live-state facts for P-256-owned device enrollment. */
import type {
  DeviceRemovalResult,
  FlowOptions,
  JubjubDeviceReader,
  P256DeviceReader,
  ViewingKeyRotationResult,
} from '@input-output-hk/mn-passport-protocol';
import type { PassportConnectorError } from './errors.js';
import type { Flow } from './flow.js';
import type { DeviceInboxLedgerView } from './inbox-view.js';
import type { P256Hint, SealedP256Hint } from './p256-device.js';
import type {
  AccBinding,
  AccLedgerView,
  AccountViewingKey,
  ActiveReadGrantSnapshot,
  ActiveReadGrantTargetSource,
  Authoriser,
  Chain,
  CurvePoint,
  P256PublicKey,
  PassportPorts,
} from './ports/index.js';

export interface P256EnrollmentContext {
  readonly ports: Pick<PassportPorts, 'authoriser' | 'viewingKey' | 'readGrants' | 'network'>;
  binding(): Promise<AccBinding>;
  chain(): Promise<Chain>;
  run<T>(options: FlowOptions, body: (flow: Flow) => Promise<T>): Promise<T>;
  withOwnerSession: NonNullable<Authoriser['withKeySession']>;
  ownerBinding: NonNullable<Authoriser['deviceBinding']>;
  findCounter(flow: Flow, record: P256Hint, view: AccLedgerView): Promise<bigint | undefined>;
  notHeld(record: P256Hint): PassportConnectorError;
  sealedKeyring(
    record: SealedP256Hint,
    view: AccLedgerView,
    pending: boolean,
    inOwnerSession: boolean,
  ): Promise<unknown>;
  append(
    flow: Flow,
    record: SealedP256Hint,
    entry: Uint8Array,
    view: AccLedgerView,
  ): Promise<AccLedgerView>;
  /** Existing helper retains its own run/Flow, inside this enrollment's owner key scope. */
  rotate(
    record: P256Hint,
    options: FlowOptions,
  ): Promise<ViewingKeyRotationResult | DeviceRemovalResult>;
  sleep(ms: number): Promise<void>;
}

export type EnrollmentJoiner =
  | { readonly kind: 'p256'; readonly reader: P256DeviceReader; readonly point: P256PublicKey }
  | { readonly kind: 'jubjub'; readonly reader: JubjubDeviceReader; readonly point: CurvePoint };

export interface EnrollmentCapabilities {
  readonly keyring: AccountViewingKey;
  readonly readGrants: ActiveReadGrantTargetSource;
  readonly addChallenge: NonNullable<AccBinding['pureCircuits']['challenge_add_device_with_p256']>;
  readonly deriveJubjub: NonNullable<AccBinding['pureCircuits']['derive_device_entry_with_jubjub']>;
}

export interface EnrollmentOperation {
  readonly context: P256EnrollmentContext;
  readonly flow: Flow;
  readonly record: SealedP256Hint;
  readonly pure: AccBinding['pureCircuits'];
  readonly capabilities: EnrollmentCapabilities;
  readonly joiner: EnrollmentJoiner;
}

export interface EnrollmentBaseline {
  readonly view: DeviceInboxLedgerView;
  readonly counter: bigint;
  /** Sorted non-owner commitments retain duplicate occurrence counts. */
  readonly otherDevices: readonly string[];
  readonly grants: ActiveReadGrantSnapshot;
}

export interface EnrollmentPlan {
  readonly operation: EnrollmentOperation;
  readonly target: Uint8Array;
  readonly baseline: EnrollmentBaseline;
}

export interface EnrollmentReady {
  readonly view: DeviceInboxLedgerView;
  readonly counter: bigint;
}

export const enrollmentEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);
