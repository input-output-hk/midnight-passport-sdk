/** Fence both failed and successful reads by account identity and invocation order. */
export function fundingReadGuard<T extends { readonly address: string }>(
  current: () => T | undefined,
) {
  let generation = 0;
  return (address: string) => {
    const original = current();
    const revision = ++generation;
    return () =>
      original !== undefined &&
      original.address === address &&
      original === current() &&
      revision === generation;
  };
}
