#!/usr/bin/env node
// Copies the ACC's generated contract module into the dapp, at src/acc/generated/ (git-ignored).
//
// Why a copy: the generated index.js imports `@midnight-ntwrk/compact-runtime`. Left in
// PASSPORT_CONTRACT_DIR, outside the workspace, Node and Vite resolve that import from the contract
// tree's own node_modules (onchain-runtime rc.3), while midnight-js and our packages get the
// workspace copy (rc.4). Two runtime instances split its wasm classes, and the first ledger read
// throws "expected instance of ChargedState". Inside the dapp, the import resolves the dapp's own
// runtime, the one midnight-js uses, with no resolve hook or dedupe.
//
// Only the module itself is copied (index.js, index.d.ts and the source map); prover keys and
// ZKIR stay with the service.
//
//   node scripts/sync-acc.mjs             fails without PASSPORT_CONTRACT_DIR
//   node scripts/sync-acc.mjs --optional  skips without it (pnpm test, which then skips the check)
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILES = ['index.js', 'index.d.ts', 'index.js.map'];
const REQUIRED = new Set(['index.js', 'index.d.ts']);
const target = fileURLToPath(new URL('../src/acc/generated/', import.meta.url));

const contractDir = process.env.PASSPORT_CONTRACT_DIR;
if (!contractDir) {
  if (process.argv.includes('--optional')) {
    console.log('sync-acc: SKIP (PASSPORT_CONTRACT_DIR is not set)');
    process.exit(0);
  }
  console.error(
    'sync-acc: set PASSPORT_CONTRACT_DIR to the pinned artefact build (the directory holding contracts/managed).',
  );
  process.exit(1);
}

const source = join(contractDir, 'contracts/managed/account/contract');
for (const file of REQUIRED) {
  if (!existsSync(join(source, file))) {
    console.error(`sync-acc: ${join(source, file)} is missing; compile the ACC first.`);
    process.exit(1);
  }
}
// Start clean, so a source map from an earlier build never outlives its module.
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const copied = FILES.filter((file) => existsSync(join(source, file)));
for (const file of copied) copyFileSync(join(source, file), join(target, file));
console.log(`sync-acc: ${copied.join(', ')} from ${source}`);
