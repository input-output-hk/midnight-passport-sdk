import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkConsumerSource,
  checkConsumerTarballs,
  consumerSha256,
} from '../scripts/consumer-inputs.mjs';
import { releasePackageDirectories } from '../scripts/release-package-list.mjs';

test('consumer source pins reject dirty, staged, untracked and ignored source overlays', () => {
  const root = mkdtempSync(join(tmpdir(), 'consumer-source-'));
  const git = (/** @type {string[]} */ args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    git(['init', '-q']);
    git(['config', 'user.name', 'Synthetic consumer']);
    git(['config', 'user.email', 'consumer@example.invalid']);
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/index.ts'), 'export const version = 1;\n');
    writeFileSync(join(root, '.gitignore'), '*.ignored.ts\n');
    git(['add', '.']);
    git(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'synthetic fixture']);
    const revision = git(['rev-parse', 'HEAD']);
    const scope = checkConsumerSource(root, revision, ['src']);
    assert.match(scope.scopeSha256, /^[a-f0-9]{64}$/);
    assert.throws(() => checkConsumerSource(root, 'main', ['src']), /full Git SHA/);
    assert.throws(() => checkConsumerSource(root, 'a'.repeat(40), ['src']), /differs/);
    assert.throws(() => checkConsumerSource(root, revision, ['missing']), /incomplete/);
    writeFileSync(join(root, 'src/index.ts'), 'export const version = 2;\n');
    assert.throws(() => checkConsumerSource(root, revision, ['src']), /tracked edits/);
    git(['add', 'src/index.ts']);
    assert.throws(() => checkConsumerSource(root, revision, ['src']), /tracked edits/);
    git(['restore', '--staged', 'src/index.ts']);
    git(['restore', 'src/index.ts']);
    for (const name of ['overlay.ts', 'overlay.ignored.ts']) {
      writeFileSync(join(root, 'src', name), 'export {};\n');
      assert.throws(() => checkConsumerSource(root, revision, ['src']), /untracked files/);
      rmSync(join(root, 'src', name));
    }
    assert.deepEqual(checkConsumerSource(root, revision, ['src']), scope);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('consumer bundle authenticates all nine files before any package installation', () => {
  const parent = mkdtempSync(join(tmpdir(), 'consumer-bundle-'));
  const root = join(parent, 'bundle');
  mkdirSync(root);
  const version = '0.1.0-test.1';
  const files = releasePackageDirectories.map((name) => {
    const file = name + '.tgz';
    writeFileSync(join(root, file), name);
    return { name: '@input-output-hk/mn-passport-' + name, file, sha256: consumerSha256(name) };
  });
  const manifest = { version, files };
  const write = () => writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  try {
    write();
    const checked = checkConsumerTarballs(root, version);
    assert.equal(Object.keys(checked.dependencies).length, 9);
    assert.equal(checked.manifestSha256, consumerSha256(readFileSync(join(root, 'manifest.json'))));
    assert.throws(() => checkConsumerTarballs(root, '0.1.0-test.2'), /version differs/);
    writeFileSync(join(root, 'account.tgz'), 'corrupted');
    assert.throws(() => checkConsumerTarballs(root, version), /hash mismatch/);
    writeFileSync(join(root, 'account.tgz'), 'account');
    const first = files[0];
    assert.ok(first);
    const original = { ...first };
    for (const file of ['../account.tgz', '/account.tgz']) {
      first.file = file;
      write();
      assert.throws(() => checkConsumerTarballs(root, version), /filename/);
    }
    Object.assign(first, original, { sha256: '' });
    write();
    assert.throws(() => checkConsumerTarballs(root, version), /SHA-256/);
    Object.assign(first, original);
    write();
    rmSync(join(root, 'account.tgz'));
    writeFileSync(join(parent, 'external.tgz'), 'account');
    symlinkSync(join(parent, 'external.tgz'), join(root, 'account.tgz'));
    assert.throws(() => checkConsumerTarballs(root, version), /escapes/);
    files.push({ ...first });
    write();
    assert.throws(() => checkConsumerTarballs(root, version), /incomplete package set/);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
