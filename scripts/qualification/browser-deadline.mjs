/** Bound an async browser action; context shutdown cancels any remaining page work.
 * @template T @param {()=>Promise<T>} operation @param {number} [timeoutMs] @param {AbortSignal} [signal]
 */
export async function browserDeadline(operation, timeoutMs = 30000, signal) {
  /** @type {NodeJS.Timeout|undefined} */ let timer;
  /** @type {(()=>void)|undefined} */ let onAbort;
  try {
    if (signal?.aborted) throw Error('Browser qualification interrupted');
    return await Promise.race([
      operation(),
      new Promise((_, reject) => {
        onAbort = () => reject(Error('Browser qualification interrupted'));
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Browser case deadline exceeded')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}
