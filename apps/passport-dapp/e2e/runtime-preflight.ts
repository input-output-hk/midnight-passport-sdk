import { ChargedState, StateValue } from '@midnight-ntwrk/compact-runtime';

/**
 * Fails fast when the generated contract module and midnight-js see two different copies of
 * compact-runtime (Final review C1). It projects an empty ledger state built with this package's
 * runtime through the generated `ledger()`: with one copy the call succeeds, with two it throws
 * "expected instance of ChargedState". Costs milliseconds, against a 10-wave deploy that would
 * otherwise run before the first ledger read fails.
 */
export function assertSingleCompactRuntime(module: { ledger(state: unknown): unknown }): void {
  try {
    module.ledger(new ChargedState(StateValue.newNull()));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/expected instance of/.test(message)) {
      throw new Error(
        'two compact-runtime copies are loaded: run under `--import ./e2e/dedupe-runtime.mjs` ' +
          `(the generated module's runtime is not midnight-js's: ${message})`,
        { cause: e },
      );
    }
    throw new Error(`the generated ledger() refused an empty state: ${message}`, { cause: e });
  }
}
