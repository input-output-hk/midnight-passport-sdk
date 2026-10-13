// One compact-runtime for the packaged generated module and midnight-js (Final review C1).
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSingleCompactRuntime } from './runtime-preflight.ts';

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
const browser = packageDir('@input-output-hk/mn-passport-adapter-browser', import.meta.url);
const adapter = packageDir('@input-output-hk/mn-passport-adapter-midnight-js', asUrl(browser));
const compactJs = packageDir('@midnight-ntwrk/compact-js', asUrl(adapter));
const contracts = packageDir('@midnight-ntwrk/midnight-js-contracts', asUrl(adapter));
const protocol = packageDir('@midnight-ntwrk/midnight-js-protocol', asUrl(contracts));
assert.equal(packageDir(RUNTIME, asUrl(compactJs)), dapp, 'compact-js uses another runtime');
assert.equal(
  packageDir(RUNTIME, asUrl(protocol)),
  dapp,
  'midnight-js-protocol uses another runtime',
);

// 2. The generated module in the contract package resolves that same runtime.
const generated = new URL(import.meta.resolve('#acc'));
assert.equal(
  packageDir(RUNTIME, generated),
  dapp,
  `the generated module at ${fileURLToPath(generated)} resolves another runtime`,
);
const accModule = await import('#acc');
assertSingleCompactRuntime(accModule);

console.log(`runtime identity: PASS (one compact-runtime at ${dapp})`);
