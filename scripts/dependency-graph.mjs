// The architecture §4.4 and design §1.2 dependency graph — the single source both
// enforcement layers consume: scripts/lint-boundaries.mjs (import level)
// and tests/dependency-rules.test.mjs (manifest and tsconfig level).
export const SCOPE = '@midnight-ntwrk/mn-passport-';

/** @type {Record<string, string[]>} */
export const ALLOWED = {
  protocol: [],
  contract: [],
  core: ['contract', 'protocol'],
  connect: ['protocol', 'contract'],
  'adapter-signer-managed': ['core'],
  'adapter-signer-local': ['core'],
  'adapter-prover-remote': ['core'],
  account: ['protocol'],
  'adapter-browser': ['account', 'contract', 'protocol'],
};

/** An adapter takes `account` through its types-only `./ports` subpath, never the root (D-2). */
export const ACCOUNT_PORTS = 'account/ports';
/**
 * Composition roots wire the flows, so they may import the account root (design §1.1).
 * adapter-browser also takes the account's runtime helpers from it until T5 to T9 split it.
 */
export const COMPOSITION_ROOTS = ['adapter-browser'];
/** The only sources that import a Midnight package statically (D-6); T8 retires adapter-browser's. */
export const MIDNIGHT_ENTRY_POINTS = [
  'packages/contract/src/bindings/',
  'packages/adapter-midnight-js/src/',
  'packages/service/src/midnight/',
  'packages/adapter-browser/src/',
];
