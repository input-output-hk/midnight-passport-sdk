import type { AbortSignalLike } from '@input-output-hk/mn-passport-protocol';

export const MAX_TIMER_MS = 2_147_483_647;
export const validTimer = (value: number, minimum: number): boolean =>
  Number.isSafeInteger(value) && value >= minimum && value <= MAX_TIMER_MS;

/** Internal interruption discriminator; public adapters retain their own error taxonomy. */
export class TransportInterrupted extends Error {
  constructor(readonly reason: 'aborted' | 'deadline') {
    super(`Transport observation ${reason}`);
  }
}

/** One monotonic invocation budget, including uncooperative host promises and polling pauses.
 * Arbitrary synchronous host code cannot be preempted; check again after calling it. */
export function transportLifetime(deadline: number, signal?: AbortSignalLike) {
  const controller = new AbortController();
  let stopped: TransportInterrupted | undefined;
  let closed = false;
  let rejectInterrupted: (error: TransportInterrupted) => void = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectInterrupted = reject;
  });
  // Registration can synchronously abort; observe rejection even before the first race.
  void interrupted.catch(() => undefined);
  const stop = (reason: 'aborted' | 'deadline') => {
    if (closed || stopped) return;
    stopped = new TransportInterrupted(reason);
    rejectInterrupted(stopped);
    controller.abort();
  };
  const abort = () => stop('aborted');
  const detach = () => {
    try {
      const result: unknown = signal?.removeEventListener('abort', abort);
      void Promise.resolve(result).catch(() => undefined);
    } catch {
      // A custom signal may fail cleanup; preserve the receipt or primary error.
    }
  };
  const check = () => {
    if (signal?.aborted) stop('aborted');
    else if (performance.now() >= deadline) stop('deadline');
    if (stopped) throw stopped;
  };
  const timer = setTimeout(() => stop('deadline'), Math.max(1, deadline - performance.now()));
  try {
    signal?.addEventListener('abort', abort);
    check();
  } catch (error) {
    closed = true;
    clearTimeout(timer);
    detach();
    throw error;
  }
  return {
    signal: controller.signal,
    check,
    remaining: () => Math.max(0, deadline - performance.now()),
    async observe<T>(work: Promise<T>): Promise<T> {
      const value = await Promise.race([work, interrupted]);
      check();
      return value;
    },
    async pause(milliseconds: number): Promise<void> {
      check();
      if (milliseconds === 0) return;
      let pauseTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await this.observe(
          new Promise<void>((resolve) => {
            pauseTimer = setTimeout(resolve, Math.min(milliseconds, this.remaining()));
          }),
        );
      } finally {
        clearTimeout(pauseTimer);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      detach();
    },
  };
}
export type TransportLifetime = ReturnType<typeof transportLifetime>;
