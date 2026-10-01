#!/usr/bin/env node
// X4 — consume the packed ACC artefact the way an SDK consumer would:
// unpack the npm tarball, load every proving circuit's ZKIR and verifier key
// through midnight-js 5's NodeZkConfigProvider with the compiler manifest
// pinned by hash, import the generated module, and check that tampering is
// refused.
//
//   node experiments/acc-0.35/consume.mjs <tarball> <work-dir> <deps-dir>
//
// <deps-dir> is a directory whose node_modules holds the midnight-js 5 and
// compact-runtime versions the contract was built against.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [tarball, work, depsDir] = process.argv.slice(2);
if (!tarball || !work || !depsDir) {
  console.error('usage: consume.mjs <tarball> <work-dir> <deps-dir>');
  process.exit(2);
}

const req = createRequire(join(depsDir, 'package.json'));
/** @param {string} id */
const load = async (id) => import(pathToFileURL(req.resolve(id)).href);

// Unpack inside <deps-dir> so the generated module's bare import of
// @midnight-ntwrk/compact-runtime resolves to the pinned runtime.
const root = join(depsDir, work);
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
execFileSync('tar', ['-xzf', tarball, '-C', root]);
const dir = join(root, 'package/artefact/v');

const manifestBytes = readFileSync(join(dir, 'compiler/contract-manifest.json'));
const manifestHash = createHash('sha256').update(manifestBytes).digest('hex');
const info = JSON.parse(readFileSync(join(dir, 'compiler/contract-info.json'), 'utf8'));
const proving = info.circuits.filter((/** @type {any} */ c) => c.proof).map((/** @type {any} */ c) => c.name);

const { NodeZkConfigProvider } = await load('@midnight-ntwrk/midnight-js-node-zk-config-provider');
const results = { manifestHash, runtime: '', circuits: proving.length, loaded: 0, proverKeyAbsent: '', tamper: '', wrongPin: '', module: {} };

const provider = new NodeZkConfigProvider(dir, { verify: 'require', expectedManifestHash: manifestHash });
results.runtime = await provider.getArtifactRuntimeVersion();
for (const c of proving) {
  const [zkir, vk] = await Promise.all([provider.getZKIR(c), provider.getVerifierKey(c)]);
  if (!(zkir.length > 0 && vk.length > 0)) throw new Error(`empty artefact for ${c}`);
  results.loaded += 1;
}

// Prover keys are deliberately not in the package: the request must fail.
try {
  await provider.getProverKey(proving[0]);
  results.proverKeyAbsent = 'UNEXPECTED: prover key loaded';
} catch (e) {
  results.proverKeyAbsent = `${/** @type {Error} */ (e).name}: ${String(/** @type {Error} */ (e).message).slice(0, 120)}`;
}

// A flipped verifier-key byte must be refused under the pinned manifest.
const tampered = join(root, 'tampered');
cpSync(dir, tampered, { recursive: true });
const victim = join(tampered, `keys/${proving[0]}.verifier`);
const bytes = readFileSync(victim);
bytes[bytes.length - 1] ^= 0xff;
writeFileSync(victim, bytes);
try {
  await new NodeZkConfigProvider(tampered, { verify: 'require', expectedManifestHash: manifestHash }).getVerifierKey(proving[0]);
  results.tamper = 'UNEXPECTED: tampered key accepted';
} catch (e) {
  results.tamper = `${/** @type {Error} */ (e).name}: ${String(/** @type {Error} */ (e).message).slice(0, 120)}`;
}

// A wrong manifest pin must be refused even with untouched files.
try {
  await new NodeZkConfigProvider(dir, { verify: 'require', expectedManifestHash: '0'.repeat(64) }).getZKIR(proving[0]);
  results.wrongPin = 'UNEXPECTED: wrong pin accepted';
} catch (e) {
  results.wrongPin = `${/** @type {Error} */ (e).name}: ${String(/** @type {Error} */ (e).message).slice(0, 120)}`;
}

// The generated module: its runtime tables and pure circuits.
const mod = await import(pathToFileURL(join(dir, 'contract/index.js')).href);
results.module = {
  exports: Object.keys(mod).sort(),
  pureCircuits: Object.keys(mod.pureCircuits ?? {}).length,
  circuitSignatures: Object.keys(mod.circuitSignatures ?? {}).length,
  declaredInterfaces: Object.keys(mod.declaredInterfaces ?? {}).length,
  contractClass: typeof mod.Contract,
};

console.log(JSON.stringify(results, null, 2));
