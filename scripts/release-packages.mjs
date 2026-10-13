#!/usr/bin/env node
// Local preflight and the manual GitHub Packages workflow share these checks.
// Publishing is deliberately impossible while prototype manifests or gates remain.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const mode = process.argv[2];
const version = process.env.RELEASE_VERSION;
const tag = process.env.DIST_TAG;
const root = resolve(import.meta.dirname, '..');
const output = join(root, 'release-tarballs');
const registry = 'https://npm.pkg.github.com';
/** @param {string} message @returns {never} */
const fail = (message) => {
  throw new Error(`release: ${message}`);
};
/** @param {string} bin @param {string[]} args @param {string} [cwd] */
const run = (bin, args, cwd = root) => execFileSync(bin, args, { cwd, stdio: 'inherit' });
/** @param {string} path */
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
/** @param {string} path */
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

if (!mode || !['pack', 'publish'].includes(mode)) fail('expected pack or publish');
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
  fail('set RELEASE_VERSION to exact semver');
if (!tag || !['dev', 'next', 'latest'].includes(tag)) fail('set DIST_TAG to dev, next or latest');
if (tag === 'latest' && version.includes('-')) fail('a prerelease cannot use the latest tag');
if (tag !== 'latest' && !version.includes('-')) fail('dev/next requires a prerelease version');

const workspace = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
const npmrc = readFileSync(join(root, '.npmrc'), 'utf8');
const prChecks = readFileSync(join(root, '.github/workflows/pr-checks.yml'), 'utf8');
if (
  !/^minimumReleaseAge:\s*10080\s*$/m.test(workspace) ||
  !/^min-release-age\s*=\s*7\s*$/m.test(npmrc)
)
  fail('restore the seven-day dependency cooldown before release');
if (!/^\s+pull_request:\s*$/m.test(prChecks))
  fail('restore active pull-request checks before release');

const names = readdirSync(join(root, 'packages'), { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() && existsSync(join(root, 'packages', entry.name, 'package.json')),
  )
  .map((entry) => entry.name)
  .sort();
if (names.length === 0) fail('no packages found');
const packages = names.map((directory) => {
  const path = join(root, 'packages', directory, 'package.json');
  const data = read(path);
  if (data.name !== `@input-output-hk/mn-passport-${directory}` || data.private !== false)
    fail(`${directory} is not a public @input-output-hk package`);
  if (
    data.publishConfig?.registry !== registry ||
    !data.repository?.url?.includes('input-output-hk/midnight-passport-sdk')
  )
    fail(`${directory} lacks the fork registry or repository metadata`);
  if (!data.files?.includes('dist') || !existsSync(join(root, 'packages', directory, 'dist')))
    fail(`${directory} lacks built dist files`);
  return { directory, path, data };
});
const byName = new Map(packages.map((item) => [item.data.name, item]));
for (const item of packages) {
  for (const name of Object.keys({ ...item.data.dependencies, ...item.data.peerDependencies })) {
    if (name.startsWith('@midnight-ntwrk/mn-passport-'))
      fail(`${item.directory} still depends on the development scope`);
    if (name.startsWith('@input-output-hk/mn-passport-') && !byName.has(name))
      fail(`${item.directory} depends on missing ${name}`);
  }
}
/** @type {typeof packages} */
const ordered = [];
const visited = new Set();
const visiting = new Set();
/** @param {(typeof packages)[number]} item */
function visit(item) {
  if (visited.has(item.data.name)) return;
  if (visiting.has(item.data.name)) fail('package dependency cycle');
  visiting.add(item.data.name);
  for (const name of Object.keys(item.data.dependencies ?? {})) {
    const dependency = byName.get(name);
    if (dependency) visit(dependency);
  }
  visiting.delete(item.data.name);
  visited.add(item.data.name);
  ordered.push(item);
}
packages.forEach(visit);

if (mode === 'pack') {
  mkdirSync(output, { recursive: true });
  if (readdirSync(output).length) fail('release-tarballs must be empty before packing');
  const originals = new Map(packages.map((item) => [item.path, readFileSync(item.path, 'utf8')]));
  try {
    for (const item of packages) {
      const dependencies = { ...item.data.dependencies };
      const peerDependencies = { ...item.data.peerDependencies };
      for (const records of [dependencies, peerDependencies]) {
        for (const name of Object.keys(records)) {
          if (byName.has(name)) records[name] = version;
        }
      }
      writeFileSync(
        item.path,
        JSON.stringify({ ...item.data, version, dependencies, peerDependencies }, null, 2) + '\n',
      );
    }
    const files = [];
    for (const item of ordered) {
      const before = new Set(readdirSync(output));
      run('pnpm', ['pack', '--pack-destination', output], join(root, 'packages', item.directory));
      const added = readdirSync(output).filter((name) => !before.has(name));
      const addedFile = added[0];
      if (added.length !== 1 || !addedFile || !addedFile.endsWith('.tgz'))
        fail(`unexpected pack output for ${item.directory}`);
      const file = join(output, addedFile);
      if (statSync(file).size >= 256_000_000)
        fail(`${item.directory} exceeds the GitHub Packages tarball limit`);
      const entries = execFileSync('tar', ['-tzf', file], { encoding: 'utf8' }).trim().split('\n');
      if (entries.some((entry) => entry.endsWith('.prover')))
        fail(`${item.directory} contains a prover key; inspect artefact packaging`);
      for (const entry of entries.filter((name) => name.endsWith('.zkir.json.gz'))) {
        const archive = execFileSync('tar', ['-xOzf', file, entry]);
        const bundle = JSON.parse(gunzipSync(archive).toString('utf8'));
        if (Object.keys(bundle.files ?? {}).some((name) => name.endsWith('.prover')))
          fail(`${item.directory} contains a bundled prover key`);
      }
      const packed = JSON.parse(
        execFileSync('tar', ['-xOzf', file, 'package/package.json'], { encoding: 'utf8' }),
      );
      if (packed.name !== item.data.name || packed.version !== version)
        fail(`wrong packed identity for ${item.directory}`);
      if (JSON.stringify(packed.dependencies ?? {}).includes('workspace:'))
        fail(`${item.directory} has unresolved workspace dependencies`);
      files.push({ name: packed.name, file: addedFile, sha256: sha256(file) });
    }
    writeFileSync(
      join(output, 'manifest.json'),
      JSON.stringify({ version, tag, files }, null, 2) + '\n',
    );
    console.log(
      `release: packed ${files.length} packages at ${version} (${tag}); no registry write`,
    );
  } finally {
    for (const [path, contents] of originals) writeFileSync(path, contents);
  }
} else {
  if (process.env.GITHUB_REPOSITORY !== 'input-output-hk/midnight-passport-sdk')
    fail('publish is fork-only');
  if (!process.env.NODE_AUTH_TOKEN) fail('NODE_AUTH_TOKEN is required');
  const manifest = read(join(output, 'manifest.json'));
  if (
    manifest.version !== version ||
    manifest.tag !== tag ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== ordered.length
  )
    fail('packed manifest does not match the requested release');
  for (const [index, { name, file, sha256: expectedSha256 }] of manifest.files.entries()) {
    if (
      name !== ordered[index]?.data.name ||
      !/^[a-z0-9@_.-]+\.tgz$/.test(file) ||
      !/^[a-f0-9]{64}$/.test(expectedSha256)
    )
      fail('packed manifest has a missing, duplicate or out-of-order package');
    const tarball = join(output, file);
    if (!existsSync(tarball)) fail(`missing tarball for ${name}`);
    if (sha256(tarball) !== expectedSha256)
      fail(`tarball checksum differs from manifest for ${name}`);
    const packed = JSON.parse(
      execFileSync('tar', ['-xOzf', tarball, 'package/package.json'], { encoding: 'utf8' }),
    );
    if (packed.name !== name || packed.version !== version)
      fail(`tarball identity differs from the packed manifest for ${name}`);
  }
  for (const { file } of manifest.files) {
    run('npm', ['publish', join(output, file), '--registry', registry, '--tag', tag]);
  }
}
