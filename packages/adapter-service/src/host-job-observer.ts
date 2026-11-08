import type { AbortSignalLike } from '@input-output-hk/mn-passport-protocol';
import type { RemoteHostJobOptions, RemoteHostJobSnapshot } from './host-jobs.js';
import { fail } from './host-job-identity.js';

/** Observe a public copy within the caller's budget. Timeout/cancel never reaches durable work.
 * Promise.race retains rejection handlers even when a late observer ignores cancellation. */
export async function observeHostJobSnapshot(
  snapshot: RemoteHostJobSnapshot,
  observer: RemoteHostJobOptions['onSnapshot'],
  deadline: number,
  signal?: AbortSignalLike,
): Promise<void> {
  const check = () => {
    if (signal?.aborted || performance.now() >= deadline) return fail();
  };
  check();
  if (!observer) return;
  let timer: ReturnType<typeof setTimeout> | undefined,
    removeAbort = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    const abort = () => reject(Error('host observation interrupted'));
    timer = setTimeout(abort, Math.max(1, deadline - performance.now()));
    signal?.addEventListener('abort', abort);
    removeAbort = () => signal?.removeEventListener('abort', abort);
    if (signal?.aborted) abort();
  });
  const work = Promise.resolve().then(() => observer(structuredClone(snapshot)));
  try {
    await Promise.race([work, interrupted]);
    check();
  } catch {
    return fail();
  } finally {
    clearTimeout(timer);
    removeAbort();
  }
}

export function pauseHostJob(ms: number, signal?: AbortSignalLike): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(Error('aborted'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
  });
}
