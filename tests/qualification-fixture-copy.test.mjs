import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  copyQualificationFixture,
  requireRegularFixtureTree,
} from '../scripts/qualification/fixture-copy.mjs';

test('fixture copies are independent and refuse nested/root aliases before workers start', async () => {
  const root = await mkdtemp(join(tmpdir(), 'passport-fixture-copy-'));
  try {
    const source = join(root, 'source'),
      copy = join(root, 'copy');
    await mkdir(join(source, 'store'), { recursive: true });
    await writeFile(join(source, 'store', 'record'), 'original');
    await copyQualificationFixture(source, copy);
    await writeFile(join(copy, 'store', 'record'), 'copy-only');
    assert.equal(await readFile(join(source, 'store', 'record'), 'utf8'), 'original');
    await assert.rejects(copyQualificationFixture(source, copy), /exist/i);
    await symlink(join(source, 'store', 'record'), join(source, 'store', 'alias'));
    await assert.rejects(copyQualificationFixture(source, join(root, 'refused')), /regular files/);
    await assert.rejects(lstat(join(root, 'refused')), { code: 'ENOENT' });
    await rm(join(source, 'store', 'alias'));
    await symlink(source, join(root, 'alias-root'));
    await assert.rejects(requireRegularFixtureTree(join(root, 'alias-root')), /regular files/);
    await symlink(join(source, 'store'), join(source, 'directory-alias'));
    await assert.rejects(requireRegularFixtureTree(source), /regular files/);
    assert.equal(await readFile(join(source, 'store', 'record'), 'utf8'), 'original');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
