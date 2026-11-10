// pnpm10 CAS byte verification independent of its timestamp/installation fast paths.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openSync, readSync, closeSync, fstatSync, constants } from 'node:fs';

/** Checks bytes against the content-addressed filename, not lockfile provenance.
 * @param {string} full @param {string} relative */
export function verifyStoreFile(full, relative) {
  const match = relative.match(/^v10\/files\/([a-f0-9]{2})\/([a-f0-9]{126})(?:-exec)?$/);
  if (!relative.startsWith('v10/files/')) return false;
  assert.ok(match, 'Unsupported pnpm CAS filename');
  const fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    assert.ok(stat.isFile() && stat.size <= 128 * 1024 ** 2, 'Unbounded CAS entry refused');
    const hash = createHash('sha512'),
      chunk = Buffer.alloc(64 * 1024);
    let total = 0,
      count;
    while ((count = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      total += count;
      assert.ok(total <= stat.size, 'CAS entry changed during verification');
      hash.update(chunk.subarray(0, count));
    }
    const after = fstatSync(fd);
    assert.equal(total, stat.size);
    assert.equal(after.mtimeMs, stat.mtimeMs);
    assert.equal(after.ctimeMs, stat.ctimeMs);
    assert.equal(
      hash.digest('hex'),
      String(match[1]) + String(match[2]),
      'Corrupt pnpm content-addressed file',
    );
    return true;
  } finally {
    closeSync(fd);
  }
}
