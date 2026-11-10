// Private single-writer process records; original launch intent is never replaced.
import assert from 'node:assert/strict';
import {
  constants,
  openSync,
  fstatSync,
  closeSync,
  readFileSync,
  realpathSync,
  renameSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { put, sha256, privateDirectory, syncDirectory } from './files.mjs';

/** @param {string} path @param {number} [maximum] */
export function readPrivate(path, maximum = 128 * 1024) {
  assert.equal(realpathSync(dirname(path)), dirname(path));
  privateDirectory(dirname(path));
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    assert.ok(
      stat.isFile() &&
        stat.nlink === 1 &&
        stat.size > 0 &&
        stat.size <= maximum &&
        (stat.mode & 0o077) === 0,
    );
    if (process.getuid) assert.equal(stat.uid, process.getuid());
    const bytes = readFileSync(fd);
    assert.equal(bytes.length, stat.size);
    return { bytes, sha256: sha256(bytes), dev: stat.dev, ino: stat.ino };
  } finally {
    closeSync(fd);
  }
}
/** @param {string} directory @param {unknown} value */
export function saveProcessRecord(directory, value) {
  privateDirectory(directory);
  const next = join(directory, 'record.next');
  put(next, JSON.stringify(value, null, 2) + '\n');
  renameSync(next, join(directory, 'record.json'));
  syncDirectory(directory);
}
