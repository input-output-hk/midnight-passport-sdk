// Shared preconditions for source and packed-package qualification. No registry writes.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { assertReleasePackageSet } from './release-package-list.mjs';

/** @param {Uint8Array | string} value */
export const consumerSha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Read a complete reviewed Git object, refusing tracked edits and untracked source overlays.
 * A caller supplies the revision out of band; private consumer pins need not enter public Git.
 * @param {string} checkout @param {string} revision @param {string[]} paths
 */
export function checkConsumerSource(checkout, revision, paths) {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('consumer revision must be a full Git SHA');
  if (!paths.length || paths.some((path) => path.startsWith('-') || path.includes('..')))
    throw new Error('invalid consumer source scope');
  const cwd = realpathSync(checkout);
  const git = (/** @type {string[]} */ args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();
  if (git(['rev-parse', 'HEAD']) !== revision)
    throw new Error('consumer revision differs from HEAD');
  if (
    git(['status', '--porcelain', '--untracked-files=all', '--', ...paths]) ||
    git(['ls-files', '--others', '--', ...paths])
  )
    throw new Error('consumer source scope has tracked edits or untracked files');
  const tree = git(['ls-tree', '-r', '--full-tree', revision, '--', ...paths]);
  if (
    !tree ||
    paths.some(
      (path) =>
        !tree.split('\n').some((line) => {
          const name = line.split('\t')[1];
          return name === path || name?.startsWith(path + '/');
        }),
    )
  )
    throw new Error('consumer source scope is incomplete');
  return { revision, scopeSha256: consumerSha256(tree + '\n') };
}

/** Authenticate every local tarball before executing package-manager code. Paths cannot escape
 * the bundle directory; duplicate files and symlink escapes are refused. This authenticates the
 * supplied manifest relationship, not the publisher (release signatures are a separate gate).
 * @param {string} directory @param {string} version
 */
export function checkConsumerTarballs(directory, version) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version))
    throw new Error('consumer requires an exact SDK version');
  const root = realpathSync(directory);
  const bytes = readFileSync(join(root, 'manifest.json'));
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest.version !== version) throw new Error('consumer manifest version differs');
  assertReleasePackageSet(manifest.files);
  const files = /** @type {Array<{name:string,file:string,sha256:string}>} */ (manifest.files);
  const names = new Set();
  const dependencies = Object.fromEntries(
    files.map(({ name, file, sha256 }) => {
      if (
        typeof file !== 'string' ||
        basename(file) !== file ||
        !file.endsWith('.tgz') ||
        names.has(file)
      )
        throw new Error('consumer tarball filename is unsafe or duplicated');
      names.add(file);
      if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256))
        throw new Error('consumer tarball SHA-256 is missing or malformed');
      const path = realpathSync(resolve(root, file));
      if (!path.startsWith(root + sep) || !statSync(path).isFile())
        throw new Error('consumer tarball escapes its bundle directory');
      if (consumerSha256(readFileSync(path)) !== sha256)
        throw new Error(`consumer tarball hash mismatch: ${file}`);
      return [name, `file:${path}`];
    }),
  );
  return { version, files, dependencies, manifestSha256: consumerSha256(bytes) };
}
