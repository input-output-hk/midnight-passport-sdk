// Partner export admission. This scans allowlisted content; it never rewrites history or publishes.
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { checkConsumerTarballs } from '../consumer-inputs.mjs';
import { packageArchive } from '../consumer/installed-inputs.mjs';

const privateMarkers = [
  /\/(?:Users|home)\/[^\s/<>"']+\//,
  /[A-Za-z]:[\\/]Users[\\/][^\s\\/<>"']+[\\/]/,
  /Initiatives\/07 Midnight Passport ACC\/SDK milestones/i,
  /(?:Claude|Codex)\s+is\s+quota-limited/i,
  /\.mn-passport-skills\//,
];
const forbiddenParts = new Set(['AGENTS.md', 'CLAUDE.md', '.git', '.env', '.mn-passport-skills']);
const hash = (/** @type {Uint8Array} */ bytes) => createHash('sha256').update(bytes).digest('hex');

/** @param {string} path */
export function admitHandoverPath(path) {
  const parts = path.split('/');
  if (
    !path ||
    isAbsolute(path) ||
    /^[A-Za-z]:/.test(path) ||
    path.includes('\\') ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        forbiddenParts.has(part) ||
        part.startsWith('.env.'),
    ) ||
    parts.includes('review') ||
    (['apps', 'packages'].includes(parts[0] ?? '') && parts.includes('qualification'))
  )
    throw Error(`Unapproved handover path: ${path}`);
}

/** The error names a path, never the matched potentially private content.
 * @param {string} path @param {Uint8Array} bytes
 */
export function scanHandoverText(path, bytes) {
  const text = Buffer.from(bytes).toString('utf8');
  if (privateMarkers.some((pattern) => pattern.test(text)))
    throw Error(`Private process detail in handover content: ${path}`);
}

/** Follow no links, require a bounded actual file, retain only relative hashes in the receipt.
 * @param {string} root @param {string} prefix @param {number} limit @param {readonly string[]} [excluded]
 */
export function inspectHandoverTree(root, prefix, limit, excluded = []) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw Error('Invalid handover byte limit');
  if (lstatSync(root).isSymbolicLink()) throw Error('Handover root symlink refused');
  const canonical = realpathSync(root);
  /** @type {{path:string,bytes:number,sha256:string}[]} */ const files = [];
  /** @param {string} directory */
  function walk(directory) {
    for (const name of readdirSync(directory).sort()) {
      const file = join(directory, name),
        stat = lstatSync(file);
      const path = relative(canonical, file).split(sep).join('/');
      const selected = prefix + '/' + path;
      if (excluded.includes(selected)) continue;
      admitHandoverPath(path);
      if (stat.isSymbolicLink()) throw Error(`Handover symlink refused: ${path}`);
      if (stat.isDirectory()) walk(file);
      else {
        if (!stat.isFile() || stat.size > limit) throw Error(`Unsupported handover file: ${path}`);
        const bytes = readFileSync(file);
        if (bytes.length > limit) throw Error(`Oversized handover read: ${path}`);
        scanHandoverText(path, bytes);
        files.push({ path: prefix + '/' + path, bytes: bytes.length, sha256: hash(bytes) });
      }
    }
  }
  walk(canonical);
  if (!files.length) throw Error('Empty handover tree');
  return files;
}

/** Check internal identity as well as content; an outer manifest cannot relabel another package.
 * @param {Buffer} bytes @param {{name:string,version:string}} expected @param {number} limit
 */
export function inspectHandoverArchive(bytes, expected, limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw Error('Invalid handover byte limit');
  const archive = packageArchive(bytes);
  const declaration = archive.get('package.json');
  if (!declaration || declaration.length > limit)
    throw Error('Missing or oversized handover package manifest');
  let pkg;
  try {
    pkg = JSON.parse(declaration.toString('utf8'));
  } catch {
    throw Error('Unreadable handover package manifest');
  }
  if (!pkg || pkg.name !== expected.name || pkg.version !== expected.version)
    throw Error('Handover archive package identity differs from candidate manifest');
  for (const [path, file] of archive) {
    admitHandoverPath(path);
    if (file.length > limit) throw Error(`Oversized handover archive file: ${path}`);
    scanHandoverText(path, file);
  }
  return { name: expected.name, version: expected.version, files: archive.size };
}

/** @param {{repository:string,rendered?:string,tarballs?:string,version?:string}} options */
export function checkPartnerHandover(options) {
  const policy = JSON.parse(
    readFileSync(join(options.repository, 'docs/partner-handover-policy.json'), 'utf8'),
  );
  if (policy.schemaVersion !== 1) throw Error('Unsupported handover policy');
  /** @type {ReturnType<typeof inspectHandoverTree>} */ const files = [];
  for (const root of policy.sourceRoots) {
    admitHandoverPath(root);
    if (
      policy.excludedRoots.some(
        (/** @type {string} */ excluded) => root === excluded || root.startsWith(excluded + '/'),
      )
    )
      throw Error('Handover root overlaps excluded material');
    const source = realpathSync(join(options.repository, root));
    if (!source.startsWith(realpathSync(options.repository) + sep))
      throw Error('Handover source escapes repository');
    files.push(
      ...inspectHandoverTree(
        join(options.repository, root),
        root,
        policy.maximumFileBytes,
        policy.excludedRoots,
      ),
    );
  }
  if (options.rendered)
    files.push(...inspectHandoverTree(options.rendered, 'rendered', policy.maximumFileBytes));
  if (options.tarballs) {
    if (!options.version) throw Error('Tarball inspection needs the exact candidate version');
    const manifest = checkConsumerTarballs(options.tarballs, options.version);
    for (const item of manifest.files) {
      inspectHandoverArchive(
        readFileSync(join(options.tarballs, item.file)),
        { name: item.name, version: options.version },
        policy.maximumFileBytes,
      );
      files.push({
        path: 'tarballs/' + item.file,
        bytes: lstatSync(join(options.tarballs, item.file)).size,
        sha256: item.sha256,
      });
    }
  }
  return {
    schemaVersion: 1,
    kind: 'partner-handover-content',
    outcome: 'passed',
    files,
    claims:
      'Allowlisted source/content and supplied rendered/archive policy only; no history sanitisation, render provenance, secret audit, runtime or publication claim.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const names = new Set(['--output', '--site', '--tarballs', '--version']);
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i],
      value = args[i + 1];
    if (!name || !names.has(name) || options.has(name) || !value || value.startsWith('--'))
      throw Error(
        'Usage: check-handover.mjs --output fresh.json [--site directory] [--tarballs directory --version exact]',
      );
    options.set(name, value);
  }
  if (!options.has('--output')) throw Error('Supply a fresh --output receipt');
  const receipt = checkPartnerHandover({
    repository: resolve(import.meta.dirname, '../..'),
    ...(options.has('--site') && { rendered: resolve(options.get('--site')) }),
    ...(options.has('--tarballs') && { tarballs: resolve(options.get('--tarballs')) }),
    ...(options.has('--version') && { version: options.get('--version') }),
  });
  writeFileSync(options.get('--output'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ outcome: receipt.outcome, files: receipt.files.length }));
}
