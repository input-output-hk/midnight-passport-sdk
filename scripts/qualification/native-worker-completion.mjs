// Observed child completion: private-log I/O failures remain failures, including early exits.
/** @template T
 * @param {import('node:child_process').ChildProcess} child
 * @param {(code:number|null,signal:NodeJS.Signals|null)=>T|Promise<T>} complete
 * @returns {Promise<T>} */
export function observeNativeCompletion(child, complete) {
  /** @type {Promise<T>} */
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      // EventEmitter does not observe an async listener's rejection.
      Promise.resolve()
        .then(() => complete(code, signal))
        .then(resolve, reject);
    });
  });
  // host() may await readiness before finished() consumes this original promise.
  done.catch(() => {});
  return done;
}
