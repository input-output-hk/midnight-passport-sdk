/** A public NIGHT observation must not wait for unrelated DUST/shielded sync. */
export function walletSyncReady(
  state: {
    unshielded: { progress: { isStrictlyComplete(): boolean } };
    dust: { progress: { isStrictlyComplete(): boolean } };
  },
  part: 'unshielded' | 'dust',
): boolean {
  return state[part].progress.isStrictlyComplete();
}
