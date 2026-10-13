#!/usr/bin/env node
// Build or collect the first release ACC from its pinned source export. The compiler invocation is
// relative to the contract directory because its source map is part of the manifest hash.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(
  process.env.PASSPORT_ACC_SOURCE_ROOT ??
    join(root, 'experiments/acc-0.35/work/acc-6458ed5/contract'),
);
const artefact = join(sourceRoot, 'contracts/managed/account');
const output = join(root, 'packages/contract/acc-binding-v2.generated.json');
const revision = '6458ed5fe6a4843912328bbf11112b97e33abf45';
const bindingId = 'acc-s3r1.1';
const sourceHashes = {
  'contracts/account.compact': 'a5a05eef67399856dc9d25ae9989a3972b4695f1f2fe6a25bfd68ee51669d3d5',
  'contracts/account-p256.compact':
    '50aca789d611fab99292725a64a8231e0a6509ca726fdb1e23babf96e0ad9fd4',
};
const args = process.argv.slice(2);
const mode = args[0];
if (!mode || args.length !== 1 || !['--check-source', '--compile', '--collect'].includes(mode)) {
  throw new Error('usage: build-acc-binding-v2.mjs --check-source|--compile|--collect');
}

/** @param {string} path */
async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

const recordedRevision = readFileSync(join(dirname(sourceRoot), 'REVISION'), 'utf8').trim();
if (recordedRevision !== revision) throw new Error('ACC source export has the wrong revision');
for (const [path, expected] of Object.entries(sourceHashes)) {
  if ((await sha256(join(sourceRoot, path))) !== expected)
    throw new Error(`ACC source differs from the pinned revision: ${path}`);
}
if (mode === '--check-source') {
  console.log(`${bindingId}: source revision and imported Compact files verified`);
  process.exit(0);
}

if (mode === '--compile') {
  execFileSync(
    'compact',
    [
      'compile',
      '+0.35.0',
      '--feature-zkir-v3',
      'contracts/account.compact',
      'contracts/managed/account',
    ],
    { cwd: sourceRoot, stdio: 'inherit' },
  );
}

const manifestPath = join(artefact, 'compiler/contract-manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (
  manifest['manifest-version'] !== '1' ||
  manifest['compiler-version'] !== '0.35.0' ||
  manifest['compiler-commit'] !== 'debb05f9414b9d1e176741c2be289bb32233f0fc' ||
  manifest['language-version'] !== '0.27.0' ||
  manifest['runtime-version'] !== '0.20.0'
) {
  throw new Error('ACC compiler manifest has an unexpected toolchain');
}

/** @type {Array<{path: string, hash: string, size: number}>} */
const files = [];
/** @param {Record<string, unknown>} directory @param {string} prefix */
function visit(directory, prefix) {
  if (directory.type !== 'directory') throw new Error(`invalid manifest directory: ${prefix}`);
  for (const [name, value] of Object.entries(directory)) {
    if (name === 'type') continue;
    if (name === '.' || name === '..' || name.includes('/') || name.includes('\\'))
      throw new Error(`unsafe manifest entry: ${prefix}${name}`);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`invalid manifest entry: ${prefix}${name}`);
    const entry = /** @type {Record<string, unknown>} */ (value);
    const path = `${prefix}${name}`;
    if (entry.type === 'directory') visit(entry, `${path}/`);
    else if (
      entry.type === 'file' &&
      typeof entry.hash === 'string' &&
      /^[a-f0-9]{64}$/.test(entry.hash) &&
      Number.isSafeInteger(entry.size)
    ) {
      if (files.some((file) => file.path === path))
        throw new Error(`duplicate manifest entry: ${path}`);
      files.push({ path, hash: entry.hash, size: /** @type {number} */ (entry.size) });
    } else throw new Error(`invalid manifest file: ${path}`);
  }
}
for (const name of ['compiler', 'contract', 'zkir', 'keys']) visit(manifest[name], `${name}/`);
const byPath = new Map(files.map((file) => [file.path, file]));
for (const file of files) {
  const path = join(artefact, file.path);
  if (statSync(path).size !== file.size || (await sha256(path)) !== file.hash)
    throw new Error(`ACC artefact differs from the compiler manifest: ${file.path}`);
}
const info = /** @type {{circuits: Array<{name: string, pure: boolean, proof: boolean}>}} */ (
  JSON.parse(readFileSync(join(artefact, 'compiler/contract-info.json'), 'utf8'))
);
if (!Array.isArray(info.circuits)) throw new Error('ACC contract info has no circuits');
/** @param {string} path */
function pinnedFile(path) {
  const file = byPath.get(path);
  if (!file) throw new Error(`ACC manifest has no ${path}`);
  return { sha256: file.hash, size: file.size };
}
const roster = info.circuits
  .filter((circuit) => circuit.proof)
  .map((circuit) => {
    const name = circuit.name;
    return {
      name,
      zkir: pinnedFile(`zkir/${name}.zkir`),
      bzkir: pinnedFile(`zkir/${name}.bzkir`),
      verifier: pinnedFile(`keys/${name}.verifier`),
      prover: pinnedFile(`keys/${name}.prover`),
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
const binding = {
  schemaVersion: 2,
  id: bindingId,
  source: { revision, files: sourceHashes },
  toolchain: {
    compiler: manifest['compiler-version'],
    compilerCommit: manifest['compiler-commit'],
    language: manifest['language-version'],
    runtime: manifest['runtime-version'],
    flags: ['--feature-zkir-v3'],
    command:
      'compact compile +0.35.0 --feature-zkir-v3 contracts/account.compact contracts/managed/account',
    regeneration: {
      command: 'zkir-v3 compile <circuit>.zkir <circuit>.prover <circuit>.verifier',
      compactRecipe: 'nix/packages/compact.nix',
      compactRecipeSha256: await sha256(join(root, 'nix/packages/compact.nix')),
      flakeLockSha256: await sha256(join(root, 'flake.lock')),
    },
  },
  manifestSha256: await sha256(manifestPath),
  schema: { specVersion: 3, recoveryVersion: 1 },
  module: {
    js: pinnedFile('contract/index.js'),
    types: pinnedFile('contract/index.d.ts'),
    sourceMap: pinnedFile('contract/index.js.map'),
    contractInfo: pinnedFile('compiler/contract-info.json'),
  },
  roster,
  pureCircuits: info.circuits
    .filter((circuit) => circuit.pure)
    .map((circuit) => circuit.name)
    .sort(),
};
const formatted = execFileSync('pnpm', ['exec', 'prettier', '--stdin-filepath', output], {
  cwd: root,
  encoding: 'utf8',
  input: JSON.stringify(binding, null, 2) + '\n',
});
writeFileSync(output, formatted);
console.log(`${bindingId}: verified ${files.length} files; wrote ${output}`);
