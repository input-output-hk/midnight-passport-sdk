import type { Lazy } from './ports/index.js';

/** Pin one successful adapter instance. Concurrent callers share a load; failure permits retry. */
export function lazyPort<T>(value: Lazy<T>): () => Promise<T> {
  if (typeof value !== 'function') return () => Promise.resolve(value);
  const load = value as () => Promise<T>;
  let pending: Promise<T> | undefined;
  return () =>
    (pending ??= Promise.resolve()
      .then(load)
      .catch((error: unknown) => {
        pending = undefined;
        throw error;
      }));
}
