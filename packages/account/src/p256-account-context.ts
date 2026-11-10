/** Captured P-256 factory references; optional ports retain live lookup timing. */
import type { FlowOptions, PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type { Flow } from './flow.js';
import type { P256Hint, SealedP256Hint } from './p256-device.js';
import type { P256ReadinessHost } from './p256-readiness-types.js';
import type { AccLedgerView, PassportPorts } from './ports/index.js';
import type { createP256ViewingRotation } from './p256-viewing-rotation.js';
import type { createP256DeviceEnrollment } from './p256-device-enrollment.js';

export interface P256AccountContext extends P256ReadinessHost {
  readonly ports: PassportPorts;
  run<T>(options: FlowOptions, work: (flow: Flow) => Promise<T>): Promise<T>;
  random(length: number): Uint8Array;
  readAccount(record: P256Hint): Promise<AccLedgerView>;
  useCounter(flow: Flow, record: P256Hint): Promise<{ counter: bigint; authNonce: bigint }>;
  sealedKeyring(
    record: SealedP256Hint,
    view: AccLedgerView,
    pending: boolean,
    inOwnerSession?: boolean,
  ): Promise<unknown>;
  readonly rotateP256ViewingKey: ReturnType<typeof createP256ViewingRotation>;
  readonly addP256Device: ReturnType<typeof createP256DeviceEnrollment>;
}
type Operation =
  | 'withdrawUnshielded'
  | 'withdrawShielded'
  | 'readShieldedHoldings'
  | 'rotateEncryptionKey'
  | 'issueGrant'
  | 'recoverPendingGrants';
export type P256MethodArgs<K extends Operation> = Parameters<NonNullable<PassportAccount[K]>>;
