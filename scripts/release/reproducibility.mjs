// Two independent builds of the pinned signed SDK object; failed copies are never removed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkConsumerTarballs } from '../consumer-inputs.mjs';
import { command, loggedCommand, probeEnvironment } from './process.mjs';
import { put } from './files.mjs';

/** @param {Array<{name:string,sha256:string}>} a @param {Array<{name:string,sha256:string}>} b */
export function samePlatformArchives(a, b) {
  assert.deepEqual(
    a.map(({ name, sha256 }) => ({ name, sha256 })),
    b.map(({ name, sha256 }) => ({ name, sha256 })),
    'Same-platform archive bytes are not reproducible',
  );
}
/** @param {string} repository @param {string} source @param {string} target */
function copySignedTree(repository, source, target) {
  mkdirSync(target, { mode: 0o700 });
  const listing = command('git', ['ls-tree', '-r', '-z', source], { cwd: repository }).stdout;
  for (const line of listing.split('\0').filter(Boolean)) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t([^\r\n]+)$/.exec(line);
    assert.ok(match && match[1] && match[2] && match[3], 'Source special entries refused');
    const path = match[3];
    assert.ok(!path.split('/').some((part) => part === '..' || part === '.' || !part));
    const destination = join(target, path);
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
    const bytes = execFileSync('git', ['cat-file', 'blob', match[2]], {
      cwd: repository,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 10_000,
    });
    put(destination, bytes);
    chmodSync(destination, match[1] === '100755' ? 0o700 : 0o600);
  }
}
/** @param {string} repository @param {import('./registry.mjs').RegistryPlan} plan @param {string} root */
export function acceptReproducibility(repository, plan, root) {
  const builds = ['repro-a', 'repro-b'].map((name) => {
    const target = join(root, name);
    copySignedTree(repository, plan.source, target);
    const env = {
      ...probeEnvironment(),
      RELEASE_VERSION: plan.version,
      DIST_TAG: 'next',
      RELEASE_TARBALL_DIR: join(target, 'release-tarballs'),
    };
    loggedCommand(target, 'install.private.log', 'pnpm', ['install', '--frozen-lockfile'], {
      cwd: target,
      env,
      timeout: 300_000,
    });
    loggedCommand(target, 'build.private.log', 'pnpm', ['run', 'build'], {
      cwd: target,
      env,
      timeout: 300_000,
    });
    loggedCommand(
      target,
      'pack.private.log',
      process.execPath,
      ['scripts/release-packages.mjs', 'pack'],
      { cwd: target, env, timeout: 180_000 },
    );
    return checkConsumerTarballs(join(target, 'release-tarballs'), plan.version).files;
  });
  assert.ok(builds[0] && builds[1]);
  samePlatformArchives(builds[0], builds[1]);
  return {
    kind: 'two-fresh-signed-source-builds',
    source: plan.source,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    packages: builds[0],
    exactArchiveEquality: true,
    failedCopiesRetained: true,
  };
}
