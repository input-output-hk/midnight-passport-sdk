import assert from 'node:assert/strict';
import {
  mkdtempSync,
  chmodSync,
  lstatSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadOrCreateOwnerSecret } from '../examples/midnames-local/owner-secret.mjs';

test('naming authority is private, stable, and cannot be replaced by a link', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'passport-owner-secret-')));
  chmodSync(root, 0o700);
  try {
    const path = join(root, 'owner.private.bin');
    const first = loadOrCreateOwnerSecret(path);
    assert.equal(first.created, true);
    assert.equal(first.secret.length, 32);
    assert.equal(lstatSync(path).mode & 0o077, 0);
    const second = loadOrCreateOwnerSecret(path);
    assert.equal(second.created, false);
    assert.deepEqual(second.secret, first.secret);
    assert.deepEqual(readFileSync(path), Buffer.from(first.secret));
    first.secret.fill(0);
    second.secret.fill(0);

    chmodSync(path, 0o644);
    assert.throws(() => loadOrCreateOwnerSecret(path), /mode 0600/);
    chmodSync(path, 0o600);
    const link = join(root, 'linked.private.bin');
    symlinkSync(path, link);
    assert.throws(() => loadOrCreateOwnerSecret(link));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
