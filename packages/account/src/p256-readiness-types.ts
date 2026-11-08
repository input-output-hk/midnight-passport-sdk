/** Captured factory references and checked facts for P-256 account readiness. */
import type { PassportConnectorError } from './errors.js';
import type { Flow } from './flow.js';
import type { P256Hint, SealedP256Hint } from './p256-device.js';
import type {
  AccBinding,
  AccLedgerView,
  AccountViewingKey,
  Chain,
  PassportPorts,
} from './ports/index.js';

export interface P256ReadinessHost {
  readonly authoriser: PassportPorts['authoriser'];
  readonly credentials: PassportPorts['credentials'];
  readonly directory: PassportPorts['directory'];
  readonly encryptionKey: PassportPorts['encryptionKey'];
  readonly viewingKey: PassportPorts['viewingKey'];
  readonly network: PassportPorts['network'];
  readonly networkId: string;
  /** The original ports object: optional record-store lookup stays dynamic. */
  readonly ports: Pick<PassportPorts, 'records'>;
  binding(): Promise<AccBinding>;
  chain(): Promise<Chain>;
  readView(flow: Flow, record: P256Hint): Promise<AccLedgerView>;
  findCounter(flow: Flow, record: P256Hint, view: AccLedgerView): Promise<bigint | undefined>;
  notHeld(record: P256Hint): PassportConnectorError;
  sleep(milliseconds: number): Promise<void>;
}

export type PendingSealedP256Hint = SealedP256Hint & {
  readonly keyEntries: readonly Uint8Array[];
};

export interface SealedReaderInput {
  readonly keyring: AccountViewingKey;
  readonly devicePublicKeyHex: () => Promise<string>;
  readonly encKey: Uint8Array;
  readonly entries: readonly Uint8Array[];
  /** Keep the record, not its property value: batch/publication lookup retains its original timing. */
  readonly pendingRecord: PendingSealedP256Hint | undefined;
}

export const readinessEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
