// Installed SDK bytes must match the supplied local bundle, independently of import success.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { checkConsumerTarballs, consumerSha256 } from '../consumer-inputs.mjs';

const MAX_ARCHIVE = 256 * 1024 * 1024;
/** Parse regular npm tar files without extracting untrusted paths or following links.
 * PAX path/size records are supported; links, global overrides and duplicate files are refused.
 * @param {Uint8Array} compressed
 */
export function packageArchive(compressed) {
  const bytes = gunzipSync(compressed, { maxOutputLength: MAX_ARCHIVE });
  /** @type {Map<string, Buffer>} */ const files = new Map();
  /** @type {Record<string,string>} */ let pax = Object.create(null);
  let ended = false;
  for (let offset = 0; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) {
      if (bytes.subarray(offset).some((b) => b !== 0)) throw Error('trailing tar content');
      ended = true;
      break;
    }
    const text = (/** @type {number} */ start, /** @type {number} */ length) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .replace(/\0.*$/s, '');
    const octal = (/** @type {string} */ value) => {
      const stripped = value.trim();
      if (!/^[0-7]+$/.test(stripped)) throw Error('invalid tar number');
      return Number.parseInt(stripped, 8);
    };
    const checksum = [...header].reduce((sum, b, i) => sum + (i >= 148 && i < 156 ? 32 : b), 0);
    if (checksum !== octal(text(148, 8))) throw Error('invalid tar checksum');
    const size = octal(text(124, 12));
    if (!Number.isSafeInteger(size) || offset + 512 + size > bytes.length)
      throw Error('truncated tar entry');
    const data = bytes.subarray(offset + 512, offset + 512 + size);
    const type = text(156, 1);
    const rawName = (text(345, 155) ? text(345, 155) + '/' : '') + text(0, 100);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      if (Object.keys(pax).length) throw Error('stacked tar overrides');
      for (let at = 0; at < data.length;) {
        const space = data.indexOf(32, at);
        const lengthText = data.subarray(at, space).toString();
        const length = Number(lengthText);
        if (
          space < at ||
          !/^[1-9][0-9]*$/.test(lengthText) ||
          length <= space - at + 1 ||
          at + length > data.length ||
          data[at + length - 1] !== 10
        )
          throw Error('invalid tar extended record');
        const record = data.subarray(space + 1, at + length - 1).toString('utf8');
        const equal = record.indexOf('=');
        if (equal < 1) throw Error('invalid tar extended record');
        const key = record.slice(0, equal);
        if (Object.hasOwn(pax, key) || key === 'linkpath') throw Error('unsafe tar override');
        pax[key] = record.slice(equal + 1);
        at += length;
      }
      continue;
    }
    const name = pax.path ?? rawName;
    if (pax.size !== undefined && pax.size !== String(size)) throw Error('tar size override');
    pax = Object.create(null);
    if (!['', '0', '5'].includes(type)) throw Error('tar links or special entries refused');
    if (type === '5' && name.replace(/\/$/, '') === 'package') continue;
    const parts = name.replace(/\/$/, '').split('/');
    if (
      parts.shift() !== 'package' ||
      !parts.length ||
      parts.some((part) => !part || part === '.' || part === '..' || part.includes('\\'))
    )
      throw Error('unsafe tar package path');
    if (type === '5') continue;
    const key = parts.join('/');
    if (files.has(key)) throw Error('duplicate tar file');
    files.set(key, data);
  }
  if (!ended || Object.keys(pax).length || !files.has('package.json'))
    throw Error('incomplete npm tar archive');
  return files;
}

/** @param {string} root @param {string} bundle @param {string} version */
export function auditInstalledBundle(root, bundle, version) {
  const consumer = realpathSync(root),
    modules = join(consumer, 'node_modules');
  const manifest = checkConsumerTarballs(bundle, version);
  const packages = manifest.files.map(({ name, file, sha256 }) => {
    const folder = realpathSync(join(modules, name));
    if (!folder.startsWith(modules + sep)) throw Error('installed SDK escapes consumer');
    const expected = packageArchive(readFileSync(join(bundle, file)));
    const pkg = JSON.parse(/** @type {Buffer} */ (expected.get('package.json')).toString());
    if (pkg.name !== name || pkg.version !== version)
      throw Error('tarball package identity differs');
    /** @type {string[]} */ const actual = [];
    const walk = (/** @type {string} */ directory) => {
      for (const entry of readdirSync(directory)) {
        if (directory === folder && entry === 'node_modules') continue;
        const path = join(directory, entry),
          stat = lstatSync(path);
        if (stat.isSymbolicLink()) throw Error('installed SDK contains a symlink');
        if (stat.isDirectory()) walk(path);
        else if (stat.isFile()) actual.push(relative(folder, path).split(sep).join('/'));
        else throw Error('installed SDK contains a special file');
      }
    };
    walk(folder);
    actual.sort();
    if (JSON.stringify(actual) !== JSON.stringify([...expected.keys()].sort()))
      throw Error('installed SDK file set differs from tarball');
    const hash = createHash('sha256');
    for (const path of actual) {
      const bytes = readFileSync(join(folder, path));
      if (!bytes.equals(/** @type {Buffer} */ (expected.get(path))))
        throw Error('installed SDK bytes differ from tarball');
      hash.update(JSON.stringify([path, consumerSha256(bytes)]) + '\n');
    }
    return {
      name,
      version,
      tarballSha256: sha256,
      files: actual.length,
      filesSha256: hash.digest('hex'),
    };
  });
  return { version, manifestSha256: manifest.manifestSha256, packages };
}
