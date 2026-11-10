// Inspect committed lockfiles, including nested workspaces, without npm execution.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { packageName } from './metadata.mjs';

/** @param {string} pair */
export function versionPair(pair) {
  const at = pair.lastIndexOf('@');
  assert.ok(at > 0 && pair.length <= 512);
  assert.equal(/\s/.test(pair), false);
  const name = packageName(pair.slice(0, at)),
    version = pair.slice(at + 1);
  assert.match(
    version,
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?(?:\+[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)?$/,
  );
  const prerelease = version.split('+')[0]?.split('-').slice(1).join('-');
  if (prerelease) assert.ok(prerelease.split('.').every((part) => !/^0\d+$/.test(part)));
  return { name, version, pair: `${name}@${version}` };
}
/** @param {string} file @param {string|null} contents */
export function lockVersions(file, contents) {
  const pairs = new Set();
  if (contents === null) return pairs;
  if (file === 'package-lock.json') {
    const lock = JSON.parse(contents);
    assert.ok(
      [2, 3].includes(lock.lockfileVersion) &&
        lock.packages &&
        typeof lock.packages === 'object' &&
        !Array.isArray(lock.packages),
    );
    for (const [path, entry] of Object.entries(lock.packages)) {
      const value = /** @type {{link?:unknown,version?:unknown,name?:unknown}} */ (entry);
      if (!path || value.link === true) continue;
      const offset = path.lastIndexOf('node_modules/');
      assert.ok(offset >= 0 && typeof value.version === 'string', 'Unsupported npm lock entry');
      const name = value.name === undefined ? path.slice(offset + 13) : value.name;
      assert.ok(typeof name === 'string', 'Unsupported npm package identity');
      pairs.add(versionPair(`${name}@${value.version}`).pair);
    }
  } else {
    assert.equal(file, 'pnpm-lock.yaml');
    assert.match(contents, /^lockfileVersion: ['"]?9(?:\.0)?['"]?\s*$/m);
    const headers = contents.split('\n').filter((line) => /^packages:/.test(line));
    assert.equal(headers.length, 1, 'Exactly one pnpm packages mapping required');
    assert.ok(
      headers[0] === 'packages:' || headers[0] === 'packages: {}',
      'Unsupported packages layout',
    );
    let inPackages = false,
      entries = 0;
    const rawKeys = new Set();
    for (const line of contents.split('\n')) {
      if (/^\S/.test(line)) {
        inPackages = line === 'packages:' || line === 'packages: {}';
        continue;
      }
      if (!inPackages || !line.trim() || line.trim().startsWith('#')) continue;
      assert.notEqual(headers[0], 'packages: {}', 'Inline mapping cannot have nested entries');
      assert.equal(line.includes('\t'), false, 'Unsupported packages indentation');
      if (/^ {4}\S/.test(line)) {
        assert.ok(entries > 0, 'Noncanonical direct package indentation');
        assert.match(
          line,
          /^ {4}(?:resolution|peerDependencies|peerDependenciesMeta|engines|cpu|os|libc|deprecated|hasBin|bundledDependencies|optionalDependencies|dependencies|transitivePeerDependencies|requiresBuild|id|name|version):(?:\s|$)/,
          'Unsupported package metadata layout',
        );
        continue;
      }
      if (/^ {5,}\S/.test(line)) {
        assert.ok(entries > 0, 'Package metadata without a package');
        continue;
      }
      assert.match(line, /^ {2}\S/, 'Noncanonical package indentation');
      const key = line.match(/^ {2}(?:'([^']+)'|"([^"]+)"|([^\s]+)):\s*$/);
      assert.ok(key, 'Unrecognized pnpm package entry');
      const rawKey = key[1] ?? key[2] ?? key[3] ?? '';
      assert.equal(rawKeys.has(rawKey), false, 'Duplicate pnpm package key');
      rawKeys.add(rawKey);
      entries++;
      const pair = rawKey.split('(')[0];
      assert.ok(pair);
      pairs.add(versionPair(pair).pair);
    }
    assert.ok(
      headers[0] === 'packages: {}' || entries > 0,
      'Empty packages must be an explicit mapping',
    );
  }
  return pairs;
}
/** @param {string} repository @param {string[]} args */
function git(repository, args) {
  return execFileSync('git', args, {
    cwd: repository,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 64 * 1024 ** 2,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
/** @param {string} repository @param {string} ref @param {string} path */
function committedFile(repository, ref, path) {
  if (!git(repository, ['ls-tree', '-z', '--name-only', ref, '--', path])) return null;
  return git(repository, ['show', `${ref}:${path}`]);
}
/** @param {string} repository @param {string} base */
export function addedVersions(repository, base) {
  assert.match(base, /^[A-Za-z0-9][A-Za-z0-9_./-]*$/);
  const source = git(repository, ['rev-parse', '--verify', 'HEAD^{commit}']).trim(),
    baseline = git(repository, ['rev-parse', '--verify', `${base}^{commit}`]).trim();
  assert.match(source, /^[a-f0-9]{40}$/);
  assert.match(baseline, /^[a-f0-9]{40}$/);
  const paths = git(repository, ['ls-tree', '-rz', '--name-only', source])
    .split('\0')
    .filter(Boolean);
  const supported = ['pnpm-lock.yaml', 'package-lock.json'];
  const lockfiles = paths.filter((p) => supported.includes(p.split('/').at(-1) ?? ''));
  assert.equal(
    paths.some((p) => ['yarn.lock', 'bun.lock', 'bun.lockb'].includes(p.split('/').at(-1) ?? '')),
    false,
    'Unsupported lockfile: cooldown cannot establish publish age',
  );
  const added = new Set();
  for (const path of lockfiles) {
    const name = path.split('/').at(-1);
    assert.ok(name);
    const before = lockVersions(name, committedFile(repository, baseline, path));
    for (const pair of lockVersions(name, committedFile(repository, source, path)))
      if (!before.has(pair)) added.add(pair);
  }
  return { source, baseline, lockfiles, added: [...added].sort().map(versionPair) };
}
