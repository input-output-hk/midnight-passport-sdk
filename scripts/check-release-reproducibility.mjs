#!/usr/bin/env node
// Build and pack tracked source twice in distinct directories. The release workflow runs this
// before attesting; a publisher can repeat it with the same source commit and compare SHA-256.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const version = process.env.RELEASE_VERSION ?? '0.0.0-dev.repro';
const tag = process.env.DIST_TAG ?? 'dev';
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(Boolean);
if (!tracked.length) throw new Error('reproducibility check needs tracked source files');

/** @param {string} directory */
function copySource(directory) {
  for (const name of tracked) {
    const target = join(directory, name);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, name), target);
  }
}

/** @param {string} directory */
function buildAndPack(directory) {
  copySource(directory);
  /** @param {string} bin @param {string[]} args */
  const run = (bin, args) => execFileSync(bin, args, { cwd: directory, stdio: 'inherit' });
  run('pnpm', ['install', '--frozen-lockfile']);
  run('pnpm', ['run', 'build']);
  execFileSync('node', ['scripts/release-packages.mjs', 'pack'], {
    cwd: directory,
    stdio: 'inherit',
    env: {
      ...process.env,
      RELEASE_VERSION: version,
      DIST_TAG: tag,
      RELEASE_TARBALL_DIR: join(directory, 'release-tarballs'),
    },
  });
  /** @type {{version: string, tag: string, files: Array<{name: string, sha256: string}>}} */
  const manifest = JSON.parse(
    readFileSync(join(directory, 'release-tarballs', 'manifest.json'), 'utf8'),
  );
  if (manifest.version !== version || manifest.tag !== tag || manifest.files?.length !== 9)
    throw new Error('reproducibility check got an incomplete release manifest');
  return manifest.files.map(({ name, sha256 }) => ({ name, sha256 }));
}

const first = mkdtempSync(join(tmpdir(), 'mn-passport-repro-a-'));
const second = mkdtempSync(join(tmpdir(), 'mn-passport-repro-b-'));
try {
  const a = buildAndPack(first);
  const b = buildAndPack(second);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    for (const [index, item] of a.entries()) {
      if (item.name !== b[index]?.name || item.sha256 !== b[index]?.sha256)
        console.error(`${item.name}: ${item.sha256} != ${b[index]?.sha256 ?? 'missing'}`);
    }
    throw new Error('release tarballs differ across clean build directories');
  }
  console.log(`release: ${a.length} tarball SHA-256 digests match across clean builds`);
} finally {
  rmSync(first, { recursive: true, force: true });
  rmSync(second, { recursive: true, force: true });
}
