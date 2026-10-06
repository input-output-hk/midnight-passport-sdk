// Resolve hook for the Node e2e (Final review C1).
//
// The generated contract module is imported by absolute path from PASSPORT_CONTRACT_DIR, which
// sits outside the workspace, so Node would resolve its `@midnight-ntwrk/compact-runtime` from the
// contract tree's own node_modules. That is a second wasm-bindgen instance: its classes never match
// the ones midnight-js (through the adapter) builds, and the first ledger read throws
// "expected instance of ChargedState". Resolving the shared runtime as if the dapp imported it
// gives every importer the one copy midnight-js already uses.

/** The dapp's manifest: resolving from here finds the dapp's (and midnight-js's) runtime. */
const DAPP = new URL('../package.json', import.meta.url).href;

/** Packages whose classes cross between the generated module and midnight-js. */
const SHARED = new Set(['@midnight-ntwrk/compact-runtime']);

/**
 * @param {string} specifier
 * @param {{ parentURL?: string; conditions: string[]; importAttributes: Record<string, string> }} context
 * @param {(specifier: string, context?: object) => Promise<{ url: string }>} next
 */
export async function resolve(specifier, context, next) {
  return SHARED.has(specifier)
    ? next(specifier, { ...context, parentURL: DAPP })
    : next(specifier, context);
}
