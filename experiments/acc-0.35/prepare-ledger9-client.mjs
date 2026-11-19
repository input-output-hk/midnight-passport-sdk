// Align the generated Compact 0.35 reference client with the release node's
// Ledger 9.1.0.2 fee calculations without changing its compiled contract.
// Run inside this repository's Nix shell, against an idle exported contract.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const contract = process.argv[2];
assert.ok(contract && isAbsolute(contract), 'Pass an absolute exported contract directory.');
assert.ok(!lstatSync(contract).isSymbolicLink(), 'Contract directory must not be a symlink.');
const dir = realpathSync(contract);
execFileSync(join(here, 'guard.sh'), [], { cwd: root, stdio: 'inherit' });

const binding = JSON.parse(
  readFileSync(join(root, 'packages/contract/acc-binding-v2.generated.json'), 'utf8'),
);
const manifest = readFileSync(
  join(dir, 'contracts/managed/account/compiler/contract-manifest.json'),
);
assert.equal(
  createHash('sha256').update(manifest).digest('hex'),
  binding.manifestSha256,
  'Refusing an export outside the pinned ACC binding.',
);
const packagePath = join(dir, 'package.json');
const packageSource = readFileSync(packagePath, 'utf8');
const pkg = JSON.parse(packageSource);
assert.equal(pkg.name, 'midnight-account-custody');
assert.equal(pkg.dependencies?.['@midnight-ntwrk/compact-runtime'], '0.20.0');
assert.equal(pkg.dependencies?.['@midnight-ntwrk/compact-js'], '3.0.0-rc.3');
assert.equal(pkg.dependencies?.['@midnight-ntwrk/midnight-js-contracts'], '5.0.0-rc.2');
assert.ok(
  ['1.0.0-rc.5', '1.0.2'].includes(pkg.dependencies?.['@midnightntwrk/ledger-v9']),
);
assert.ok(
  pkg.overrides?.['@midnightntwrk/ledger-v9'] === undefined ||
    pkg.overrides['@midnightntwrk/ledger-v9'] === '1.0.2',
);
pkg.dependencies['@midnightntwrk/ledger-v9'] = '1.0.2';
pkg.overrides = { ...pkg.overrides, '@midnightntwrk/ledger-v9': '1.0.2' };
const nextSource = JSON.stringify(pkg, null, 2) + '\n';
function installedVersions() {
  try {
    const lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
    if (lock.packages?.['']?.dependencies?.['@midnightntwrk/ledger-v9'] !== '1.0.2')
      return undefined;
    const versions = Object.entries(lock.packages)
      .filter(([name]) => name.endsWith('node_modules/@midnightntwrk/ledger-v9'))
      .map(([, entry]) => entry.version);
    const installed = JSON.parse(
      readFileSync(join(dir, 'node_modules/@midnightntwrk/ledger-v9/package.json'), 'utf8'),
    );
    return versions.length && versions.every((version) => version === '1.0.2') &&
      installed.version === '1.0.2'
      ? versions
      : undefined;
  } catch {
    return undefined;
  }
}
const ready = nextSource === packageSource && installedVersions();
if (ready) {
  console.log(`Reusing pinned ACC client with Ledger 9 ${ready[0]}.`);
  process.exit(0);
}
if (nextSource !== packageSource) writeFileSync(packagePath, nextSource);

try {
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: dir,
    stdio: 'inherit',
  });
} catch (error) {
  if (nextSource !== packageSource) writeFileSync(packagePath, packageSource);
  throw error;
}
const versions = installedVersions();
assert.ok(versions, 'Mixed or missing Ledger 9 versions remain.');
console.log(`Prepared pinned ACC export with Ledger 9 ${versions[0]} across ${versions.length} lock entries.`);
