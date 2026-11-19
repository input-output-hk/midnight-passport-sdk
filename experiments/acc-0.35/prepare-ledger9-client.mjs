// Align the generated Compact 0.35 reference client with the release node's
// Ledger 9.1.0.2 fee calculations without changing its compiled contract.
// Run inside this repository's Nix shell, against an idle exported contract.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../..');
const contract = process.argv[2];
assert.ok(contract && isAbsolute(contract), 'Pass an absolute exported contract directory.');
assert.ok(!lstatSync(contract).isSymbolicLink(), 'Contract directory must not be a symlink.');
const dir = realpathSync(contract);
assert.ok(lstatSync(dir).isDirectory(), 'Contract export must be a directory.');
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
const lockPath = join(dir, 'package-lock.json');
for (const file of [packagePath, lockPath]) {
  const stat = lstatSync(file);
  assert.ok(
    stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
    `${file} must be an unshared regular file.`,
  );
}
const modules = join(dir, 'node_modules');
function physicalLedgerVersions() {
  let stat;
  try {
    stat = lstatSync(modules);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'node_modules must be a real directory.');
  const stack = [modules];
  const versions = [];
  const linkedFiles = new Map();
  let entries = 0;
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      assert.ok(++entries <= 300_000, 'Dependency tree exceeds the inspection bound.');
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        const target = realpathSync(path);
        const inside = relative(dir, target);
        assert.ok(
          basename(current) === '.bin' &&
            inside !== '..' &&
            !inside.startsWith(`..${sep}`) &&
            !isAbsolute(inside),
          `Refusing a dependency symlink outside the npm bin directory: ${path}`,
        );
      } else if (entry.isDirectory()) {
        if (
          entry.name === 'ledger-v9' &&
          basename(current) === '@midnightntwrk' &&
          basename(dirname(current)) === 'node_modules'
        ) {
          versions.push(JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')).version);
        }
        stack.push(path);
      } else if (entry.isFile()) {
        const file = lstatSync(path);
        if (file.nlink > 1) {
          const key = `${file.dev}:${file.ino}`;
          const seen = linkedFiles.get(key) ?? { count: 0, links: file.nlink };
          seen.count++;
          linkedFiles.set(key, seen);
        }
      }
    }
  }
  for (const { count, links } of linkedFiles.values())
    assert.equal(count, links, 'Dependency file has a hardlink outside this export.');
  return versions;
}
physicalLedgerVersions();
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
  const physical = physicalLedgerVersions();
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    if (lock.packages?.['']?.dependencies?.['@midnightntwrk/ledger-v9'] !== '1.0.2')
      return undefined;
    const versions = Object.entries(lock.packages)
      .filter(([name]) => name.endsWith('node_modules/@midnightntwrk/ledger-v9'))
      .map(([, entry]) => entry.version);
    return versions.length &&
      versions.every((version) => version === '1.0.2') &&
      physical.length &&
      physical.every((version) => version === '1.0.2')
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
