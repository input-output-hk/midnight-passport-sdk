import { HttpError } from './http.ts';

/**
 * A first-in, first-out queue that runs one job at a time. A job that rejects does not stop the
 * jobs behind it: each starts once the one before has settled, whichever way it settled.
 *
 * `maxWaiting` bounds the jobs queued behind the running one; a job offered beyond it is refused
 * with HttpError 503. There is no per-job timeout in the prototype: a job that never settles
 * (a proof server that hangs) wedges the queue until the process restarts.
 */
export function serial(
  maxWaiting = Number.POSITIVE_INFINITY,
): <T>(job: () => Promise<T>) => Promise<T> {
  // `tail` only ever fulfils, so a failure is reported to its own caller and to nobody else.
  let tail: Promise<void> = Promise.resolve();
  let pending = 0; // running plus waiting
  return <T>(job: () => Promise<T>): Promise<T> => {
    if (pending > maxWaiting) {
      return Promise.reject(new HttpError(503, 'service busy: too many queued jobs'));
    }
    pending++;
    const next = tail.then(job);
    const settled = (): void => {
      pending--;
    };
    tail = next.then(settled, settled);
    return next;
  };
}
