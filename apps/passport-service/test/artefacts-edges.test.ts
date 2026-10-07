// Edges of src/artefacts.ts: verification fails closed on every way a tree can differ from its
// pinned manifest, and bindingCircuits reads only what the manifest lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bindingCircuits, verifyArtefacts } from '../src/artefacts.ts';
import { fakeArtefacts } from './fixtures.ts';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** Writes a manifest of the given shape and returns its hash, so the pin matches it. */
function withManifest(dir: string, tree: Record<string, unknown>): string {
  const manifest = JSON.stringify(tree);
  mkdirSync(join(dir, 'compiler'), { recursive: true });
  writeFileSync(join(dir, 'compiler/contract-manifest.json'), manifest);
  return sha256(manifest);
}

const file = (size = 0) => ({ type: 'file', size, hash: '0'.repeat(64) });

test('a file changed to the same size still fails, by its hash', () => {
  const { dir, manifestSha256 } = fakeArtefacts();
  verifyArtefacts(dir, manifestSha256);
  writeFileSync(join(dir, 'keys/c.prover'), Uint8Array.of(4, 5, 7)); // was 4, 5, 6
  assert.throws(() => verifyArtefacts(dir, manifestSha256), /keys\/c\.prover does not match/);
});

test('a file that grew or shrank fails, and a file that is gone fails closed', () => {
  const { dir, manifestSha256 } = fakeArtefacts();
  writeFileSync(join(dir, 'zkir/c.bzkir'), Uint8Array.of(1, 2, 3));
  assert.throws(() => verifyArtefacts(dir, manifestSha256), /zkir\/c\.bzkir/);
  const gone = fakeArtefacts();
  rmSync(join(gone.dir, 'keys/c.verifier'));
  assert.throws(() => verifyArtefacts(gone.dir, gone.manifestSha256));
});

test('the manifest itself must match the pin, byte for byte', () => {
  const { dir, manifestSha256 } = fakeArtefacts();
  assert.throws(() => verifyArtefacts(dir, manifestSha256.toUpperCase()), /manifest hash/);
  assert.throws(() => verifyArtefacts(dir, ''), /manifest hash/);
  const other = fakeArtefacts();
  assert.throws(
    () => verifyArtefacts(dir, other.manifestSha256.replace(/^./, '0')),
    /manifest hash/,
  );
});

test('a missing manifest is an error, not an empty tree', () => {
  const { dir, manifestSha256 } = fakeArtefacts();
  rmSync(join(dir, 'compiler/contract-manifest.json'));
  assert.throws(() => verifyArtefacts(dir, manifestSha256));
});

test('files in the tree that the manifest does not list are not part of what is verified', () => {
  const { dir, manifestSha256 } = fakeArtefacts();
  writeFileSync(join(dir, 'keys/extra.prover'), 'unlisted');
  verifyArtefacts(dir, manifestSha256);
});

test('verification descends into nested directories and fails on a file deep inside one', () => {
  const dir = fakeArtefacts().dir;
  const bytes = 'nested';
  mkdirSync(join(dir, 'a/b'), { recursive: true });
  writeFileSync(join(dir, 'a/b/f'), bytes);
  const pin = withManifest(dir, {
    a: {
      type: 'directory',
      b: { type: 'directory', f: { type: 'file', size: bytes.length, hash: sha256(bytes) } },
    },
  });
  verifyArtefacts(dir, pin);
  writeFileSync(join(dir, 'a/b/f'), 'NESTED');
  assert.throws(() => verifyArtefacts(dir, pin), /a\/b\/f does not match/);
});

test('bindingCircuits needs both a prover key and a compiled ZKIR, and strips only the suffix', () => {
  const dir = fakeArtefacts().dir;
  withManifest(dir, {
    keys: {
      type: 'directory',
      'both.prover': file(),
      'both.verifier': file(),
      'only-key.prover': file(),
      'dotted.name.prover': file(),
    },
    zkir: {
      type: 'directory',
      'both.bzkir': file(),
      'only-zkir.bzkir': file(),
      'dotted.name.bzkir': file(),
    },
  });
  assert.deepEqual([...bindingCircuits(dir)].sort(), ['both', 'dotted.name']);
});

test('bindingCircuits ignores directories, other suffixes, and a manifest without the folders', () => {
  const dir = fakeArtefacts().dir;
  withManifest(dir, {
    keys: { type: 'directory', 'c.prover': { type: 'directory' }, 'c.verifier': file() },
    zkir: { type: 'directory', 'c.bzkir': file(), 'c.json': file() },
  });
  assert.deepEqual([...bindingCircuits(dir)], [], 'a directory named c.prover is no key');
  withManifest(dir, { 'manifest-version': '1' });
  assert.deepEqual([...bindingCircuits(dir)], []);
  withManifest(dir, { keys: 'not a node', zkir: null });
  assert.deepEqual([...bindingCircuits(dir)], []);
});
