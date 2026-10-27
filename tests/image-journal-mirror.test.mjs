import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeJobHash } from '../scripts/qualification/native-job-evidence.mjs';
import {
  imageStateNames,
  mirrorImageJournals,
  nativeWorkerStopped,
} from '../scripts/qualification/image-journal-mirror.mjs';

const name = 'a'.repeat(32) + '.r0.json';
const bytes = Buffer.from('synthetic ciphertext, never a real authority');
const entry = { name, size: bytes.length, sha256: nativeJobHash(bytes) };
const manifest = () => ({ 'host-journal': [{ ...entry }], 'job-journal': [] });
/** @param {import('node:test').TestContext} t */
const fixture = async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'passport-image-mirror-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};

test('image mirror copies immutable bytes once and rechecks existing history on every observation', async (t) => {
  const root = await fixture(t);
  let copies = 0;
  /** @param {string} _journal @param {string} _name @param {string} destination */
  const copy = async (_journal, _name, destination) => {
    copies++;
    await writeFile(destination, bytes, { mode: 0o600 });
  };
  await mirrorImageJournals(root, manifest(), copy);
  await mirrorImageJournals(root, manifest(), copy);
  assert.equal(copies, 1);
  const path = join(root, 'host-journal', name);
  assert.deepEqual(await readFile(path), bytes);
  await writeFile(path, Buffer.alloc(bytes.length));
  await assert.rejects(mirrorImageJournals(root, manifest(), copy));
  assert.equal(copies, 1, 'An observed revision must never be silently replaced.');
});

test('image mirror refuses removal of previously observed Linux history', async (t) => {
  const root = await fixture(t);
  await mirrorImageJournals(root, manifest(), async (_j, _n, p) =>
    writeFile(p, bytes, { mode: 0o600 }),
  );
  await assert.rejects(
    mirrorImageJournals(root, { 'host-journal': [], 'job-journal': [] }, async () =>
      assert.fail('No copy permitted.'),
    ),
  );
});

test('image mirror rejects path traversal, oversized files, duplicate slots and arbitrary plaintext fields before copying', async (t) => {
  for (const bad of [
    { ...entry, name: '../fixture.json' },
    { ...entry, size: 32 * 1024 * 1024 },
    { ...entry, secret: 'must never be exported' },
    { ...entry, sha256: 'invalid' },
  ]) {
    const root = await fixture(t);
    await assert.rejects(
      mirrorImageJournals(root, { 'host-journal': [bad], 'job-journal': [] }, async () =>
        assert.fail('Unsafe manifest must not invoke Docker copy.'),
      ),
    );
  }
  const root = await fixture(t);
  await assert.rejects(
    mirrorImageJournals(
      root,
      { 'host-journal': [entry, entry], 'job-journal': [] },
      async (_j, _n, p) => writeFile(p, bytes, { mode: 0o600 }),
    ),
  );
});

test('image mirror refuses corrupted copied bytes and symbolic links', async (t) => {
  const corrupt = await fixture(t);
  await assert.rejects(
    mirrorImageJournals(corrupt, manifest(), async (_j, _n, p) =>
      writeFile(p, Buffer.alloc(bytes.length), { mode: 0o600 }),
    ),
  );
  const linked = await fixture(t);
  const source = join(linked, 'source');
  await writeFile(source, bytes, { mode: 0o600 });
  await assert.rejects(
    mirrorImageJournals(linked, manifest(), async (_j, _n, p) => symlink(source, p)),
  );
});

test('image resource names reject old roots, foreign schemes and shell syntax', () => {
  assert.equal(
    imageStateNames('image-v2', 'jubjub').volume,
    'mn-passport-hostjobs-20261027-image-v2-jubjub-state',
  );
  for (const label of ['image-v0', 'image-v1000', '../image-v2', 'source-v3', 'image-v2;true'])
    assert.throws(() => imageStateNames(label, 'jubjub'));
  assert.throws(() => imageStateNames('image-v2', 'foreign'));
});

test('signal-only worker termination ends a boundary wait immediately', () => {
  assert.equal(nativeWorkerStopped({ exitCode: null, signalCode: null }), false);
  assert.equal(nativeWorkerStopped({ exitCode: 0, signalCode: null }), true);
  assert.equal(nativeWorkerStopped({ exitCode: null, signalCode: 'SIGKILL' }), true);
});
