// Private operator evidence. No SDK runtime dependency or implicit publication.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, normalize } from 'node:path';

export const sha256 = (/** @type {string|Uint8Array} */ bytes) =>
  createHash('sha256').update(bytes).digest('hex');
export const json = (/** @type {string} */ path) => JSON.parse(readFileSync(path, 'utf8'));
/** @param {unknown} value @returns {Record<string,unknown>} */
export function object(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), 'Expected object');
  return Object.fromEntries(Object.entries(value));
}
/** @param {unknown} value @param {RegExp} pattern */
export function text(value, pattern) {
  assert.equal(typeof value, 'string');
  assert.match(String(value), pattern);
  return String(value);
}
/** @param {Record<string,unknown>} value @param {string[]} keys */
export function exact(value, keys) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'Unexpected configuration fields');
}
/** Refuse aliases and parent symlinks before claiming a brand new evidence directory.
 * @param {string} path */
export function freshRoot(path) {
  assert.ok(isAbsolute(path) && normalize(path) === path && path !== '/');
  assert.equal(realpathSync(dirname(path)), dirname(path), 'Evidence parent must be canonical');
  mkdirSync(path, { mode: 0o700 });
  syncDirectory(dirname(path));
  return path;
}
/** @param {string} path @param {string|Uint8Array} bytes */
export function put(path, bytes) {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
/** @param {string} path */
export function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
/** Atomic private journal; a crash leaves the last dispatch intent intact.
 * @param {string} root @param {unknown} value */
export function saveJournal(root, value) {
  const temp = join(root, 'journal.next');
  put(temp, JSON.stringify(value, null, 2) + '\n');
  renameSync(temp, join(root, 'journal.json'));
  syncDirectory(root);
}
/** @param {string} root */
export function privateDirectory(root) {
  const stat = lstatSync(root);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  assert.equal(stat.mode & 0o077, 0, 'Private directory required');
  if (process.getuid) assert.equal(stat.uid, process.getuid());
}
