/** Each independent local key disposal must run even if another cleanup or observer fails. */
export function completeLocalCleanup(steps: readonly (() => void)[]): boolean {
  let complete = true;
  for (const step of steps) {
    try {
      step();
    } catch {
      complete = false;
    }
  }
  return complete;
}
