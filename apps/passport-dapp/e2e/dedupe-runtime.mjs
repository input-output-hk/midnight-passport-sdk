// The Node twin of vite.config.ts `resolve.dedupe`. Load it after tsx:
//   node --import tsx --import ./e2e/dedupe-runtime.mjs e2e/<script>.ts
// It registers dedupe-runtime-hooks.mjs, which sends every import of the shared runtime to the
// dapp's own copy (Final review C1).
import { register } from 'node:module';

register('./dedupe-runtime-hooks.mjs', import.meta.url);
