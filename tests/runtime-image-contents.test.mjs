import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkRuntimeImage } from '../scripts/check-runtime-image.mjs';

test('runtime content admission accepts shipped app/package roots and rejects each known dev path', () => {
  const root = mkdtempSync(join(tmpdir(), 'passport-image-content-'));
  try {
    mkdirSync(join(root, 'apps/passport-service/src'), { recursive: true });
    mkdirSync(join(root, 'packages/account/dist/testing'), { recursive: true });
    assert.equal(checkRuntimeImage(root).status, 'passed');
    for (const path of [
      'review',
      'tests',
      'docs',
      '.git',
      '.github',
      '.mn-passport-skills',
      'coverage',
      '.nyc_output',
      'apps/passport-service/test',
      'apps/passport-service/qualification',
      'apps/passport-funding-service/test',
      'packages/account/tests',
    ]) {
      mkdirSync(join(root, path), { recursive: true });
      assert.throws(() => checkRuntimeImage(root), /Development\/private path/);
      rmSync(join(root, path), { recursive: true });
      assert.equal(checkRuntimeImage(root).status, 'passed');
    }
    symlinkSync('/no-such-passport-review', join(root, 'review'));
    assert.throws(() => checkRuntimeImage(root), /Development\/private path/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
