// Progress events (design §3.4, #17): a typed event with three phases over a closed list of steps.
import type { PassportErrorCode } from './errors.js';

export const PASSPORT_STEPS = Object.freeze([
  'passkey.create',
  'passkey.probe',
  'passkey.prf',
  'passkey.identify',
  'passkey.sign',
  'service.config',
  'deploy',
  'deploy.wave',
  'deploy.retire',
  'activate',
  'prove',
  'prove.queue',
  'sponsor.balance',
  'sponsor.submit',
  'chain.finality',
  'chain.read',
  'counter.scan',
  'directory.read',
  'directory.write',
] as const);

/** A minor release may add steps; consumers ignore the ones they do not know. */
export type PassportStep = (typeof PASSPORT_STEPS)[number];

export const PASSPORT_EVENT_PHASES = Object.freeze(['start', 'end', 'error'] as const);
export type PassportEventPhase = (typeof PASSPORT_EVENT_PHASES)[number];

/**
 * One step instance starts, ends or fails. Every `start` has exactly one `end` or `error` with the
 * same `id`, and no event carries a secret.
 */
export interface PassportEvent {
  readonly id: string;
  readonly flowId: string;
  readonly step: PassportStep;
  readonly phase: PassportEventPhase;
  /** Milliseconds since the epoch. */
  readonly at: number;
  /** Which side stamped it; the client re-emits the service's events with `'service'`. */
  readonly clock: 'client' | 'service';
  /** On `end` and `error`. */
  readonly durationMs?: number;
  readonly detail?: {
    readonly wave?: number;
    readonly of?: number;
    readonly queuePosition?: number;
    readonly circuit?: string;
    readonly txId?: string;
  };
  readonly error?: { readonly code: PassportErrorCode; readonly message: string };
}

/**
 * @deprecated since 1.0.0: the prototype's five coarse steps, reported through `onProgress`. Use
 * {@link PassportEvent} through `onEvent`. Removed in 2.0.0.
 */
export type CreateAccountStep =
  'passkey-created' | 'deploying' | 'deployed' | 'activating' | 'active';
