// One flow's progress events (design §3.4, #17) and its abort checks. Every step started here ends
// with exactly one `end` or `error` of the same id; events carry no secret.
import type {
  CreateAccountStep,
  FlowOptions,
  PassportEvent,
  PassportStep,
} from '@midnight-ntwrk/mn-passport-protocol';
import { toHex } from './codec.js';
import { PassportConnectorError, toPassportError } from './errors.js';

export interface Flow {
  /** What ports that take them get: the caller's `signal`, and an `onEvent` that stamps this flow. */
  readonly ports: FlowOptions;
  /**
   * Runs `work` as one step. Refuses to start once aborted, unless `always`: a step that records
   * what the chain already holds runs even then, so no record is left half-written.
   */
  step<T>(step: PassportStep, work: () => Promise<T>, always?: 'always'): Promise<T>;
  /** Throws `Aborted` once the caller's signal has aborted. */
  checkpoint(): void;
  /** The flow's error: `Aborted` once aborted, else `e` in the error codes, at the failed port step. */
  fail(e: unknown): PassportConnectorError;
}

export function startFlow(
  { signal, onEvent: listener }: FlowOptions,
  random: (length: number) => Uint8Array,
  /** @deprecated since 1.0.0: the prototype's progress steps, derived from the events. */
  onProgress?: (step: CreateAccountStep) => void,
  now: () => number = Date.now,
): Flow {
  const progress = onProgress && progressFromEvents(onProgress);
  const onEvent = (event: PassportEvent) => {
    listener?.(event);
    progress?.(event);
  };
  const flowId = toHex(random(8));
  let count = 0;
  /** The step a port last reported failing; the core's error names it in place of the outer step. */
  let portFailed: PassportStep | undefined;
  const emit = (event: PassportEvent) => {
    try {
      onEvent(event);
    } catch {
      // A listener's fault never fails the flow.
    }
  };
  const fail = (e: unknown, step?: PassportStep): PassportConnectorError =>
    signal?.aborted && (e as { code?: unknown } | undefined)?.code !== 'Aborted'
      ? new PassportConnectorError('Aborted', 'The flow was aborted.', {
          cause: signal.reason ?? e,
          ...(step !== undefined && { step }),
        })
      : toPassportError(e, step);
  const checkpoint = () => {
    if (signal?.aborted) throw fail(undefined);
  };
  return {
    ports: {
      ...(signal && { signal }),
      onEvent: (event) => {
        if (event.phase === 'error') portFailed = event.step;
        emit({ ...event, flowId });
      },
    },
    async step(step, work, always) {
      if (!always) checkpoint();
      const id = `${flowId}.${++count}`;
      const at = now();
      emit({ id, flowId, step, phase: 'start', at, clock: 'client' });
      portFailed = undefined;
      try {
        const value = await work();
        const end = now();
        emit({ id, flowId, step, phase: 'end', at: end, clock: 'client', durationMs: end - at });
        return value;
      } catch (e) {
        const error = fail(e, portFailed ?? step);
        const end = now();
        emit({
          ...{ id, flowId, step, phase: 'error', at: end, clock: 'client', durationMs: end - at },
          error: { code: error.code, message: error.message },
        });
        throw error;
      }
    },
    checkpoint,
    fail: (e) => fail(e, portFailed),
  };
}

/**
 * @deprecated since 1.0.0: the prototype's five `onProgress` steps, derived from the create flow's
 * events. Use `onEvent`. Removed in 2.0.0.
 */
export function progressFromEvents(
  onProgress: (step: CreateAccountStep) => void,
): (event: PassportEvent) => void {
  let activated = false;
  return ({ step, phase }) => {
    if (phase === 'start' && step === 'deploy') onProgress('deploying');
    if (phase === 'start' && step === 'activate') onProgress('activating');
    if (phase !== 'end') return;
    if (step === 'passkey.create') onProgress('passkey-created');
    if (step === 'activate') activated = true;
    if (step === 'directory.write') onProgress(activated ? 'active' : 'deployed');
  };
}
