/**
 * A first-in, first-out queue that runs one job at a time. A job that rejects does not stop the
 * jobs behind it: each starts once the one before has settled, whichever way it settled.
 */
export function serial(): <T>(job: () => Promise<T>) => Promise<T> {
  // `tail` only ever fulfils, so a failure is reported to its own caller and to nobody else.
  let tail: Promise<void> = Promise.resolve();
  return <T>(job: () => Promise<T>): Promise<T> => {
    const next = tail.then(job);
    tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}
