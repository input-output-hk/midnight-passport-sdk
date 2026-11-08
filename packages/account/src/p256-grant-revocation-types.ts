/** Checked facts for selective and complete-map P-256 grant revocation. */
import type { FlowOptions, ViewingKeyRotationResult } from '@input-output-hk/mn-passport-protocol';
import type { PassportConnectorError } from './errors.js';
import type { Flow } from './flow.js';
import type { GrantRoster } from './grant-roster.js';
import type { P256Hint } from './p256-device.js';
import type { RotationCallback } from './p256-rotation-types.js';
import type { createP256ViewingRotation } from './p256-viewing-rotation.js';
import type {
  AccBinding,
  AccLedgerView,
  Authoriser,
  Chain,
  GrantDetailSource,
  P256Authorisation,
  PassportPorts,
} from './ports/index.js';

export interface P256GrantRevocationHost {
  readonly ports: Pick<PassportPorts, 'grantDetails' | 'grantRoster' | 'readGrants' | 'holdings'>;
  readonly authoriser: Authoriser;
  readonly network: PassportPorts['network'];
  binding(): Promise<AccBinding>;
  chain(): Promise<Chain>;
  readView(flow: Flow, record: P256Hint): Promise<AccLedgerView>;
  findCounter(flow: Flow, record: P256Hint, view: AccLedgerView): Promise<bigint | undefined>;
  notHeld(record: P256Hint): PassportConnectorError;
  readonly rotate: ReturnType<typeof createP256ViewingRotation>;
  sleep(milliseconds: number): Promise<void>;
}

export interface GrantRevocationOperation {
  readonly host: P256GrantRevocationHost;
  readonly record: P256Hint;
  readonly flow: Flow;
  readonly options: FlowOptions;
}

export interface GrantRotation {
  readonly rotation: ViewingKeyRotationResult | undefined;
  readonly rotated: Parameters<RotationCallback>[0] | undefined;
}

export interface SingleGrantRevocation extends GrantRotation {
  readonly pure: AccBinding['pureCircuits'];
  readonly grantId: string;
  readonly grant: Exclude<Awaited<ReturnType<GrantDetailSource['readGrant']>>, undefined>;
  readonly view: AccLedgerView;
}

export interface AllGrantRevocation extends GrantRotation {
  readonly roster: GrantRoster;
  readonly baseline: string;
  readonly view: AccLedgerView;
}

export interface SignedGrantRevocation {
  readonly counter: bigint;
  readonly signed: P256Authorisation;
}

export interface SignedSingleGrantRevocation extends SignedGrantRevocation {
  readonly id: Uint8Array;
}

export const sameGrantKey = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
