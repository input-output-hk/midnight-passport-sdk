// Reuse the installed archive audit; add physical resolution and input-drift checks.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditInstalledBundle } from './installed-inputs.mjs';
import { checkMidnightRuntimeIdentity } from '../check-midnight-runtime-identity.mjs';
import { releasePackageDirectories } from '../release-package-list.mjs';

export const sdkPrefix = '@input-output-hk/mn-passport-';
/** @param {string|Uint8Array} value */
export const qualityHash = (value) => createHash('sha256').update(value).digest('hex');
/** @param {string} root @param {string} file */
export const inside = (root, file) => file === root || file.startsWith(root + sep);
/** @param {string} file */
export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** @typedef {{name:string,root:string,exports:unknown}} InstalledRoot */
/** @typedef {{consumer:string,repository:string,version:string,manifestSha256:string,lockSha256:string,roots:InstalledRoot[]}} InstalledQualityContext */

/** @param {string} value @param {string} label */
function pin(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw Error(`installed quality requires ${label} SHA-256`);
}

/** A prepared application is required; this runner never installs or changes its lock.
 * @param {{consumer:string,repository:string,version:string,manifestSha256:string,lockSha256:string}} options
 * @returns {InstalledQualityContext}
 */
export function installedQualityContext(options) {
  const consumer = realpathSync(options.consumer),
    repository = realpathSync(options.repository);
  if (inside(repository, consumer) || inside(consumer, repository))
    throw Error('installed consumer overlaps repository');
  pin(options.manifestSha256, 'manifest');
  pin(options.lockSha256, 'lock');
  const context = { ...options, consumer, repository, roots: [] };
  const prepared = readJson(join(consumer, 'qualification-inputs.json'));
  if (
    prepared.schemaVersion !== 1 ||
    prepared.version !== options.version ||
    prepared.manifestSha256 !== options.manifestSha256 ||
    prepared.lockSha256 !== options.lockSha256
  )
    throw Error('prepared consumer differs from external pins');
  const audited = auditInstalledBundle(consumer, join(consumer, 'bundle'), options.version);
  if (
    audited.manifestSha256 !== options.manifestSha256 ||
    JSON.stringify(audited) !== JSON.stringify(prepared.installed)
  )
    throw Error('prepared installed SDK differs');
  const roots = audited.packages.map(({ name }) => {
    const root = realpathSync(join(consumer, 'node_modules', name));
    return { name, root, exports: readJson(join(root, 'package.json')).exports };
  });
  return { ...context, roots };
}

/** A pnpm package-root link is valid only when its physical target is the audited package.
 * @param {readonly InstalledRoot[]} roots @param {string} specifier @param {string} file
 */
export function assertInstalledSdkResolution(roots, specifier, file) {
  if (!specifier.startsWith(sdkPrefix)) return;
  const name = specifier.split('/').slice(0, 2).join('/');
  const expected = roots.find((entry) => entry.name === name);
  if (!expected || !inside(expected.root, realpathSync(file)))
    throw Error(`SDK resolution escapes audited installed package: ${specifier}`);
}

/** Fingerprint all real files and links without following directory links or cycles.
 * @param {string} root @param {readonly InstalledRoot[]} [sdkRoots]
 */
export function qualityTree(root, sdkRoots = []) {
  /** @type {Array<[string,string,number,string]>} */ const files = [];
  const canonical = realpathSync(root);
  /** @param {string} folder */
  function walk(folder) {
    for (const name of readdirSync(folder).sort()) {
      const file = join(folder, name),
        stat = lstatSync(file),
        path = relative(canonical, file);
      if (stat.isSymbolicLink()) {
        const target = realpathSync(file);
        if (!inside(canonical, target)) throw Error('installed input link escapes its tree');
        files.push([path, 'link', 0, target]);
      } else if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) {
        const bytes = readFileSync(file);
        if (sdkRoots.length && name === 'package.json') {
          const pkg = JSON.parse(bytes.toString('utf8'));
          if (
            typeof pkg.name === 'string' &&
            pkg.name.startsWith(sdkPrefix) &&
            !sdkRoots.some((entry) => entry.name === pkg.name && entry.root === folder)
          )
            throw Error('unaudited SDK copy in installed dependency graph');
        }
        files.push([path, 'file', bytes.length, qualityHash(bytes)]);
      } else throw Error('installed input contains special file');
    }
  }
  walk(canonical);
  return {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + file[2], 0),
    sha256: qualityHash(JSON.stringify(files)),
  };
}

/** @param {string} file */
export function qualityFile(file) {
  const path = realpathSync(file),
    bytes = readFileSync(path);
  return { path, bytes: bytes.length, sha256: qualityHash(bytes) };
}

/** Shared scripts and actual compiler/Node code are part of the evidence inputs. */
function tools() {
  const require = createRequire(import.meta.url);
  const files = [
    process.execPath,
    require.resolve('typescript'),
    require.resolve('typescript/package.json'),
    ...[
      'installed-quality.mjs',
      'installed-quality-inputs.mjs',
      'installed-quality-types.mjs',
      'installed-quality-runtime.mjs',
      'installed-inputs.mjs',
      'quality-contracts.mjs',
      'preview-quality.mjs',
      '../consumer-inputs.mjs',
      '../release-package-list.mjs',
      '../check-midnight-runtime-identity.mjs',
      '../docs/snippets.mjs',
    ].map((file) => fileURLToPath(new URL(file, import.meta.url))),
  ];
  return files.map(qualityFile);
}

/** @param {InstalledQualityContext} context */
export function captureInstalledQuality(context) {
  const { consumer, repository, roots, version, manifestSha256, lockSha256 } = context;
  const prepared = readJson(join(consumer, 'qualification-inputs.json'));
  const lock = qualityFile(join(consumer, 'pnpm-lock.yaml'));
  const pkg = qualityFile(join(consumer, 'package.json'));
  const installed = auditInstalledBundle(consumer, join(consumer, 'bundle'), version);
  if (
    lock.sha256 !== lockSha256 ||
    pkg.sha256 !== prepared.packageJsonSha256 ||
    installed.manifestSha256 !== manifestSha256 ||
    prepared.nodeVersion !== process.version
  )
    throw Error('installed consumer lock, manifest or runtime changed');
  const runtime = checkMidnightRuntimeIdentity(
    consumer,
    roots.map(({ name }) => name),
  );
  if (JSON.stringify(Object.keys(runtime).sort()) !== JSON.stringify(prepared.runtimeIdentity))
    throw Error('prepared Midnight runtime identity differs');
  return {
    installed,
    lock,
    package: pkg,
    prepared: qualityFile(join(consumer, 'qualification-inputs.json')),
    modules: qualityTree(join(consumer, 'node_modules'), roots),
    source: releasePackageDirectories.map((directory) => ({
      directory,
      manifest: qualityFile(join(repository, 'packages', directory, 'package.json')),
      source: qualityTree(join(repository, 'packages', directory, 'src')),
    })),
    docs: ['docs/site', 'docs/examples'].map((path) => ({
      path,
      ...qualityTree(join(repository, path)),
    })),
    runtime,
    tools: tools(),
  };
}

/** @param {unknown} before @param {unknown} after */
export function assertQualityUnchanged(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw Error('installed quality inputs changed during checks');
}

/** Select only real public runtime exports; declarations are never executed.
 * @param {readonly InstalledRoot[]} roots
 */
export function installedRuntimeExports(roots) {
  return roots.flatMap((pkg) => {
    if (!pkg.exports || typeof pkg.exports !== 'object' || Array.isArray(pkg.exports))
      throw Error('installed package lacks named exports');
    return Object.entries(pkg.exports).map(([subpath, declaration]) => {
      if (!(subpath === '.' || /^\.\/[a-zA-Z0-9./_-]+$/.test(subpath)) || subpath.includes('..'))
        throw Error('unsupported installed export subpath');
      const target = typeof declaration === 'string' ? declaration : declaration?.default;
      if (
        typeof target !== 'string' ||
        !target.startsWith('./') ||
        target.split('/').some((part) => part === '..' || part === 'src') ||
        !/\.(?:m?js|json)$/.test(target)
      )
        throw Error('unsupported installed runtime export');
      const file = resolve(pkg.root, target);
      assertInstalledSdkResolution(roots, pkg.name, file);
      return {
        specifier: pkg.name + (subpath === '.' ? '' : subpath.slice(1)),
        file: realpathSync(file),
        json: target.endsWith('.json'),
      };
    });
  });
}
