// One compact-runtime for the Node e2e (Final review C1), offline and in seconds:
//   PASSPORT_CONTRACT_DIR=<fetch-acc.sh output> \
//     node --import tsx --import ./e2e/dedupe-runtime.mjs e2e/runtime-identity.e2e.ts
// It skips when PASSPORT_CONTRACT_DIR is unset, so `pnpm test:apps` stays green without the tree.
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertSingleCompactRuntime } from './runtime-preflight.ts';

const contractDir = process.env.PASSPORT_CONTRACT_DIR;
if (!contractDir) {
  console.log('runtime identity: SKIP (PASSPORT_CONTRACT_DIR is not set)');
  process.exit(0);
}

const RUNTIME = '@midnight-ntwrk/compact-runtime';

/** The real directory of `name` as Node resolves it from `base`. */
const packageDir = (name: string, base: string | URL): string => {
  const manifest = findPackageJSON(name, base);
  assert.ok(manifest, `${name} does not resolve from ${String(base)}`);
  return realpathSync(dirname(manifest));
};
const asUrl = (dir: string): URL => pathToFileURL(`${dir}/`);

// 1. midnight-js's runtime (reached through the adapter) is the dapp's.
const dapp = packageDir(RUNTIME, import.meta.url);
const adapter = packageDir('@midnight-ntwrk/mn-passport-adapter-browser', import.meta.url);
const compactJs = packageDir('@midnight-ntwrk/compact-js', asUrl(adapter));
const contracts = packageDir('@midnight-ntwrk/midnight-js-contracts', asUrl(adapter));
const protocol = packageDir('@midnight-ntwrk/midnight-js-protocol', asUrl(contracts));
assert.equal(packageDir(RUNTIME, asUrl(compactJs)), dapp, 'compact-js uses another runtime');
assert.equal(
  packageDir(RUNTIME, asUrl(protocol)),
  dapp,
  'midnight-js-protocol uses another runtime',
);

// 2. Under the resolve hook, the generated module shares the same classes.
const generated = `${contractDir}/contracts/managed/account/contract/index.js`;
const accModule = (await import(pathToFileURL(generated).href)) as {
  ledger(state: unknown): unknown;
};
assertSingleCompactRuntime(accModule);

console.log(`runtime identity: PASS (one compact-runtime at ${dapp})`);
