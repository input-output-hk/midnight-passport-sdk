import type {
  FlowOptions,
  PassportDeviceReader,
  AuthScheme,
} from '@input-output-hk/mn-passport-protocol';
import type { AccLedgerView, NetworkConfig, TxResult } from './ports/index.js';

/** Protected continuation data. Never send this document to an event logger or audit endpoint. */
export type MutationValue =
  null | boolean | number | string | MutationValue[] | { [key: string]: MutationValue };
export type MutationIntent =
  | { readonly kind: 'create'; readonly userName: string; readonly retireAuthority: boolean }
  | { readonly kind: 'rotate'; readonly account: string }
  | { readonly kind: 'add-device'; readonly account: string; readonly reader: PassportDeviceReader }
  | { readonly kind: 'remove-device'; readonly account: string; readonly commitmentHex: string };
export interface MutationPins {
  readonly networkId: string;
  readonly bindingId: string;
  readonly manifestSha256: string;
  readonly scheme: AuthScheme;
}
export interface MutationLedger {
  readonly booted: boolean;
  readonly authNonce: bigint;
  readonly deviceEpoch: bigint;
  readonly specVersion: number;
  readonly encKey: Uint8Array;
  readonly inboxEntries: readonly Uint8Array[];
  readonly deviceEntries: readonly Uint8Array[];
  readonly entryCount: number;
}
export interface MutationEffect {
  readonly key: string;
  readonly kind: 'call' | 'deploy';
  readonly digest: string;
  readonly input: unknown;
  readonly before?: MutationLedger;
  readonly after?: MutationLedger;
  readonly address?: string;
}
export interface MutationEntry {
  readonly name: string;
  readonly digest: string;
  readonly phase: 'prepared' | 'running' | 'done';
  readonly result?: unknown;
  readonly effect?: MutationEffect;
}
export interface MutationDocument {
  readonly version: 1;
  readonly id: string;
  readonly revision: number;
  readonly pins: MutationPins;
  readonly intent: MutationIntent;
  /** Only account-local random salt/flow IDs. Never the PRF, reader or ACC viewing secret. */
  readonly randomSeed: Uint8Array;
  readonly phase: 'pending' | 'cancelled' | 'complete';
  readonly entries: readonly MutationEntry[];
  readonly frontier?: { readonly address: string; readonly ledger: MutationLedger };
  readonly result?: unknown;
}
/** Atomic, authenticated, confidential and crash-durable; CAS failure must never overwrite. */
export interface MutationJournal {
  read(id: string): Promise<MutationDocument | undefined>;
  compareAndSwap(
    id: string,
    expectedRevision: number | undefined,
    next: MutationDocument,
  ): Promise<boolean>;
}
/** The host must prove a particular request, not infer absence from an empty/stale ledger read.
 * A no-send outcome also fences every earlier sender: none may subsequently broadcast. */
export type MutationOutcome =
  | { readonly kind: 'unknown' }
  | { readonly kind: 'not-submitted'; readonly digest: string; readonly fenced: true }
  | {
      readonly kind: 'confirmed';
      readonly digest: string;
      readonly result: TxResult | { readonly address: string; readonly txIds: readonly string[] };
    };
export interface MutationOutcomeSource {
  reconcile(
    pins: MutationPins,
    effect: MutationEffect,
    options?: Pick<FlowOptions, 'signal'>,
  ): Promise<MutationOutcome>;
}
/** Explicit approval of the original intent on every process invocation, including resume. */
export interface MutationConsent {
  approve(input: {
    readonly id: string;
    readonly pins: MutationPins;
    readonly intent: MutationIntent;
    readonly resuming: boolean;
  }): Promise<void>;
}
export interface MutationAudit {
  readonly id: string;
  readonly revision: number;
  readonly phase: MutationDocument['phase'];
  readonly completedSteps: number;
  readonly unresolvedEffects: number;
}
export interface MutationRunOptions extends FlowOptions {
  readonly id: string;
}
/** Underlying atomic byte store; encrypted implementations bind bytes to id/revision/pins. */
export interface MutationByteStore {
  read(id: string): Promise<{ readonly revision: number; readonly bytes: Uint8Array } | undefined>;
  compareAndSwap(
    id: string,
    expectedRevision: number | undefined,
    next: { readonly revision: number; readonly bytes: Uint8Array },
  ): Promise<boolean>;
}
export type { AccLedgerView, NetworkConfig };
