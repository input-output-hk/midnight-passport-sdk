import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planKeyCache, verifyKeyCache } from '../scripts/ci-key-cache.mjs';

test('cache identity separates platform and profile and caps the full prover set', async () => {
  const linux = await planKeyCache({ platform: 'linux', arch: 'x64' });
  const mac = await planKeyCache({ platform: 'darwin', arch: 'arm64' });
  assert.notEqual(linux.cacheKey, mac.cacheKey);
  assert.equal(linux.circuits.length, 10);
  assert.equal(linux.bytes, 529293067);
  await assert.rejects(planKeyCache({ profile: 'all' }), /exceeds.*CI cache budget/);
});

test('a cache hit cannot bless corrupt, incomplete, extra or symlinked keys', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'passport-ci-cache-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('verified public artifact');
  const filename = 'deposit_unshielded.prover';
  const file = join(directory, filename);
  const base = await planKeyCache();
  const plan = {
    ...base,
    bytes: bytes.length,
    files: {
      [filename]: {
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    },
  };
  await assert.rejects(verifyKeyCache(plan, directory), /exact selected key set/);
  await writeFile(file, bytes);
  assert.equal((await verifyKeyCache(plan, directory)).verified, 1);
  await writeFile(file, Buffer.alloc(bytes.length));
  await assert.rejects(verifyKeyCache(plan, directory), /hash mismatch/);
  await writeFile(file, bytes);
  await writeFile(join(directory, 'unexpected'), 'must not be cached');
  await assert.rejects(verifyKeyCache(plan, directory), /exact selected key set/);
  await rm(join(directory, 'unexpected'));
  await rm(file);
  const target = join(directory, '..', `${directory.split('/').at(-1)}-target`);
  t.after(() => rm(target, { force: true }));
  await writeFile(target, bytes);
  await symlink(target, file);
  await assert.rejects(verifyKeyCache(plan, directory), /invalid cached key/);
});
