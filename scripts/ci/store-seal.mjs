// Seal all public cache metadata as well as CAS bytes. Cache scope remains the trust root.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  realpathSync,
  readdirSync,
  lstatSync,
  openSync,
  readSync,
  fstatSync,
  closeSync,
  constants,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'node:fs';
import { join, relative } from 'node:path';

const MANIFEST = '.passport-downloads-v2.json';
/** @param {string} root */
function catalog(root) {
  assert.equal(realpathSync(root), root);
  /** @type {{path:string,bytes:number,sha256:string}[]} */ const files = [];
  let bytes = 0,
    entries = 0;
  const walk = (/** @type {string} */ directory) => {
    for (const name of readdirSync(directory).sort()) {
      const full = join(directory, name),
        path = relative(root, full);
      if (path === MANIFEST) continue;
      assert.ok(++entries <= 200_000);
      const stat = lstatSync(full);
      assert.equal(stat.isSymbolicLink(), false);
      if (path === 'v10/projects') {
        assert.ok(stat.isDirectory());
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      assert.ok(stat.isFile() && stat.size <= 128 * 1024 ** 2);
      bytes += stat.size;
      assert.ok(bytes <= 2 * 1024 ** 3);
      const fd = openSync(full, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = fstatSync(fd),
          hash = createHash('sha256'),
          chunk = Buffer.alloc(65536);
        assert.equal(before.ino, stat.ino);
        assert.equal(before.dev, stat.dev);
        let count,
          total = 0;
        while ((count = readSync(fd, chunk, 0, chunk.length, null)) > 0) {
          total += count;
          assert.ok(total <= stat.size);
          hash.update(chunk.subarray(0, count));
        }
        const after = fstatSync(fd);
        assert.equal(total, stat.size);
        assert.equal(after.ctimeMs, before.ctimeMs);
        assert.equal(after.mtimeMs, before.mtimeMs);
        files.push({ path, bytes: total, sha256: hash.digest('hex') });
      } finally {
        closeSync(fd);
      }
    }
  };
  walk(root);
  assert.ok(files.length > 0);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** Only after a fresh frozen install or previously admitted restore; not an authenticity signature.
 * @param {string} root */
export function sealStore(root) {
  const files = catalog(root),
    path = join(root, MANIFEST),
    temporary = path + '.next';
  const payload = JSON.stringify({ schema: 2, kind: 'public-pnpm-download-catalog', files }) + '\n';
  assert.ok(
    Buffer.byteLength(payload) <= 32 * 1024 ** 2,
    'Cache catalog exceeds restore admission bound',
  );
  writeFileSync(temporary, payload, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
  return {
    sealedFiles: files.length,
    provenance: 'trusted workflow cache scope; not a cryptographic publisher signature',
  };
}

/** Detect metadata substitution as well as corrupted content before installing.
 * @param {string} root */
export function admitStoreSeal(root) {
  const path = join(root, MANIFEST);
  assert.ok(existsSync(path), 'Unsealed/legacy cache cannot be consumed');
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32 * 1024 ** 2);
  const input = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(input.schema, 2);
  assert.equal(input.kind, 'public-pnpm-download-catalog');
  assert.deepEqual(input.files, catalog(root), 'Download cache catalog/metadata mismatch');
  return { sealedFiles: input.files.length, metadataAndContentUnchanged: true };
}
