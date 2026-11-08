/** Exact scenario process-group shutdown. Closing the owned child cancels escalation. */
/** @typedef {{pid?:number|undefined,once:(event:string,callback:()=>void)=>unknown,removeListener:(event:string,callback:()=>void)=>unknown}} OwnedChild */

/** @param {OwnedChild} child @param {number} graceMs
 * @param {(pid:number, signal:'SIGTERM'|'SIGKILL')=>unknown} [kill]
 */
export function createOwnedProcessStopper(child, graceMs, kill = process.kill) {
  if (!Number.isSafeInteger(graceMs) || graceMs < 1 || graceMs > 180_000)
    throw new Error('Invalid scenario termination grace');
  const pid = child.pid;
  let closed = false,
    stopping = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let escalation;
  const onClose = () => {
    closed = true;
    clearTimeout(escalation);
  };
  child.once('close', onClose);
  return {
    stop() {
      if (closed || stopping || !pid) return;
      stopping = true;
      try {
        kill(-pid, 'SIGTERM');
      } catch {
        return;
      }
      if (closed) return;
      escalation = setTimeout(() => {
        if (!closed)
          try {
            kill(-pid, 'SIGKILL');
          } catch {
            /* Owned group already exited. */
          }
      }, graceMs);
      escalation.unref();
    },
    dispose() {
      clearTimeout(escalation);
      child.removeListener('close', onClose);
    },
  };
}
