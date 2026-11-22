#!/usr/bin/env node
// Materialise the separately pinned Ledger 9 key profile from a complete
// offline generation receipt. Prover bytes stay outside the repository.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const inventoryFile = process.argv[2] && resolve(process.argv[2]);
const verifierDir = process.argv[3] && resolve(process.argv[3]);
if (!inventoryFile || !verifierDir || process.argv.length !== 4)
  throw new Error('usage: build-acc-0361-key-profile.mjs <complete-inventory> <verifier-dir>');

/** @param {Uint8Array | string} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** @param {unknown} value */
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const old = JSON.parse(
  readFileSync(join(root, 'packages/contract/resources/acc-s3r1.1.key-manifest.json'), 'utf8'),
);
const inventory = JSON.parse(readFileSync(inventoryFile, 'utf8'));
const names = Object.keys(old.circuits).sort();
if (
  old.bindingId !== 'acc-s3r1.1' ||
  old.compilerManifestSha256 !==
    '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f' ||
  names.length !== 52 ||
  inventory.status !== 'complete' ||
  inventory.tool !== 'zkir-v3 3.2.0 (Compact toolchain 0.36.1 release unpack)' ||
  inventory.inputCompilerManifestSha256 !== old.compilerManifestSha256 ||
  JSON.stringify(Object.keys(inventory.circuits).sort()) !== JSON.stringify(names)
)
  throw new Error('incomplete or unpinned ACC key inventory');

/** @type {Record<string, typeof old.circuits[string]>} */
const circuits = {};
/** @type {Record<string, {newProverSha256: string, newVerifierSha256: string, newProverBytes: number, newVerifierBytes: number}>} */
const publicCircuits = {};
for (const name of names) {
  const prior = old.circuits[name];
  const row = inventory.circuits[name];
  if (
    row.zkirSha256 !== prior.zkir.sha256 ||
    row.oldProverSha256 !== prior.prover.sha256 ||
    row.oldVerifierSha256 !== prior.verifier.sha256 ||
    !hash(row.newProverSha256) ||
    !hash(row.newVerifierSha256) ||
    !Number.isSafeInteger(row.newProverBytes) ||
    row.newProverBytes <= 0 ||
    !Number.isSafeInteger(row.newVerifierBytes) ||
    row.newVerifierBytes <= 0
  )
    throw new Error(`${name}: key inventory differs from the compiler profile`);
  const verifier = join(verifierDir, `${name}.verifier`);
  if (!existsSync(verifier) || !lstatSync(verifier).isFile())
    throw new Error(`${name}: generated verifier is missing or not a regular file`);
  const bytes = readFileSync(verifier);
  if (bytes.length !== row.newVerifierBytes || sha256(bytes) !== row.newVerifierSha256)
    throw new Error(`${name}: generated verifier differs from the inventory`);
  circuits[name] = {
    zkir: prior.zkir,
    bzkir: prior.bzkir,
    prover: { size: row.newProverBytes, sha256: row.newProverSha256 },
    verifier: { size: row.newVerifierBytes, sha256: row.newVerifierSha256 },
  };
  publicCircuits[name] = {
    newProverSha256: row.newProverSha256,
    newVerifierSha256: row.newVerifierSha256,
    newProverBytes: row.newProverBytes,
    newVerifierBytes: row.newVerifierBytes,
  };
}

const manifest = {
  schemaVersion: 1,
  bindingId: 'acc-s3r1.1-zkir036',
  compilerManifestSha256: old.compilerManifestSha256,
  compiler: old.compiler,
  regeneration: {
    tool: 'zkir-v3',
    command: 'zkir-v3 compile <circuit>.zkir <circuit>.prover <circuit>.verifier',
    toolchainVersion: '0.36.1',
    nix: {
      command: 'nix develop',
      compactRecipe: 'nix/packages/compact.nix',
      compactRecipeSha256: sha256(readFileSync(join(root, 'nix/packages/compact.nix'))),
      flakeLockSha256: sha256(readFileSync(join(root, 'flake.lock'))),
    },
  },
  circuits,
};
const manifestBytes = JSON.stringify(manifest, null, 2) + '\n';
const publicInventory = {
  schemaVersion: 1,
  profile: manifest.bindingId,
  compilerManifestSha256: old.compilerManifestSha256,
  keyGenerator: 'Compact 0.36.1 / zkir-v3 3.2.0',
  keyManifestSha256: sha256(manifestBytes),
  circuits: publicCircuits,
};
/** @type {[string, string][]} */
const outputs = [
  [join(root, 'packages/contract/resources/acc-s3r1.1-zkir036.key-manifest.json'), manifestBytes],
  [
    join(root, 'examples/midnames-local/evidence/compact0361-acc-key-inventory-20261122.json'),
    JSON.stringify(publicInventory, null, 2) + '\n',
  ],
];
for (const [file, bytes] of outputs) {
  if (existsSync(file)) {
    if (readFileSync(file, 'utf8') !== bytes) throw new Error(`${file}: existing bytes differ`);
  } else {
    writeFileSync(file, bytes, { flag: 'wx' });
  }
  console.log(`${file}: ${sha256(bytes)}`);
}
