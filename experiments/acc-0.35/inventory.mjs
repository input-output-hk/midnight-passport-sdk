#!/usr/bin/env node
// Inventory of one compiled ACC output directory: per-circuit ZKIR, binary
// ZKIR, verifier and prover key sizes, the compiler's own manifest, and
// whether every file on disk matches that manifest.
//
//   node experiments/acc-0.35/inventory.mjs <out-dir> [--json <file>]
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const [dir, flag, jsonOut] = process.argv.slice(2);
if (!dir) {
  console.error('usage: inventory.mjs <out-dir> [--json <file>]');
  process.exit(2);
}

/** @param {string} root @returns {string[]} */
function walk(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(root, e.name)) : [join(root, e.name)],
  );
}

const sha256 = (/** @type {string} */ p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const size = (/** @type {string} */ p) => statSync(p).size;

const info = JSON.parse(readFileSync(join(dir, 'compiler/contract-info.json'), 'utf8'));
const manifestPath = join(dir, 'compiler/contract-manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;

// Flatten the compiler manifest's nested directory tree into path → {size, hash}.
/** @type {Record<string, {size: number, hash: string}>} */
const listed = {};
/** @param {Record<string, any>} node @param {string} prefix */
function flatten(node, prefix) {
  for (const [name, value] of Object.entries(node)) {
    if (value && typeof value === 'object' && value.type === 'file') {
      listed[prefix + name] = { size: value.size, hash: value.hash };
    } else if (value && typeof value === 'object' && value.type === 'directory') {
      flatten(value, `${prefix}${name}/`);
    }
  }
}
if (manifest) flatten(manifest, '');

const files = walk(dir).map((p) => relative(dir, p)).sort();
const mismatches = [];
const unlisted = [];
for (const f of files) {
  if (f === 'compiler/contract-manifest.json') continue;
  const entry = listed[f];
  if (!entry) {
    unlisted.push(f);
    continue;
  }
  const p = join(dir, f);
  if (entry.size !== size(p) || entry.hash !== sha256(p)) mismatches.push(f);
}
const missing = Object.keys(listed).filter((f) => !files.includes(f));

const circuits = info.circuits.map((/** @type {any} */ c) => {
  const part = (/** @type {string} */ rel) => (existsSync(join(dir, rel)) ? size(join(dir, rel)) : null);
  return {
    name: c.name,
    pure: c.pure,
    proof: c.proof,
    zkir: part(`zkir/${c.name}.zkir`),
    bzkir: part(`zkir/${c.name}.bzkir`),
    verifier: part(`keys/${c.name}.verifier`),
    prover: part(`keys/${c.name}.prover`),
  };
});
const proving = circuits.filter((/** @type {any} */ c) => c.proof);
const sum = (/** @type {string} */ k) => proving.reduce((a, /** @type {any} */ c) => a + (c[k] ?? 0), 0);
const moduleBytes = ['contract/index.js', 'contract/index.d.ts', 'compiler/contract-info.json']
  .filter((f) => existsSync(join(dir, f)))
  .reduce((a, f) => a + size(join(dir, f)), 0);

const report = {
  dir,
  compiler: {
    version: info['compiler-version'],
    language: info['language-version'],
    runtime: info['runtime-version'],
    commit: manifest?.['compiler-commit'] ?? null,
  },
  circuits: { total: circuits.length, proving: proving.length, pure: circuits.length - proving.length },
  bytes: {
    module: moduleBytes,
    zkir: sum('zkir'),
    bzkir: sum('bzkir'),
    verifier: sum('verifier'),
    prover: sum('prover'),
    largestProver: Math.max(0, ...proving.map((/** @type {any} */ c) => c.prover ?? 0)),
  },
  manifest: manifest
    ? {
        present: true,
        sha256: sha256(manifestPath),
        listedFiles: Object.keys(listed).length,
        listsKeys: Object.keys(listed).some((f) => f.startsWith('keys/')),
        mismatches,
        unlisted,
        missing,
      }
    : { present: false },
  perCircuit: circuits,
};

const mb = (/** @type {number} */ n) => (n / 1e6).toFixed(1);
console.log(
  `compiler ${report.compiler.version} (${report.compiler.commit?.slice(0, 9) ?? '-'}), language ${report.compiler.language}, runtime ${report.compiler.runtime}`,
);
console.log(`circuits: ${report.circuits.total} (${report.circuits.proving} proving, ${report.circuits.pure} pure)`);
console.log(
  `bytes: module ${mb(report.bytes.module)} MB, zkir ${mb(report.bytes.zkir)} MB, bzkir ${mb(report.bytes.bzkir)} MB, verifier ${(report.bytes.verifier / 1e3).toFixed(1)} KB, prover ${mb(report.bytes.prover)} MB (largest ${mb(report.bytes.largestProver)} MB)`,
);
if (manifest) {
  console.log(
    `manifest: ${report.manifest.listedFiles} files, lists keys: ${report.manifest.listsKeys}, mismatches: ${mismatches.length}, unlisted: ${unlisted.length}, missing: ${missing.length}`,
  );
} else {
  console.log('manifest: absent');
}
if (flag === '--json' && jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 2) + '\n');
