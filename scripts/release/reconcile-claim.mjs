// Exclusive, retained recovery claim. A second operator cannot race the first.
import assert from 'node:assert/strict';
import { mkdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { put, syncDirectory, privateDirectory } from './files.mjs';
import { readPrivate } from './process-files.mjs';

/** @param {string} root @param {string} expected @param {{dev:number,ino:number,sha256:string}} lease @param {import('./process-identity.mjs').ProcessIdentity} controller */
export function claimReconciliation(root, expected, lease, controller) {
  const path = join(root, 'reconciliation');
  mkdirSync(path, { mode: 0o700 });
  syncDirectory(root);
  put(
    join(path, 'claim.json'),
    JSON.stringify(
      { schema: 1, originalJournalSha256: expected, originalLease: lease, controller },
      null,
      2,
    ) + '\n',
  );
  syncDirectory(path);
  const directory = lstatSync(path),
    file = readPrivate(join(path, 'claim.json'));
  return {
    path,
    verify() {
      privateDirectory(path);
      const current = lstatSync(path),
        content = readPrivate(join(path, 'claim.json'));
      assert.equal(current.dev, directory.dev);
      assert.equal(current.ino, directory.ino);
      assert.equal(content.dev, file.dev);
      assert.equal(content.ino, file.ino);
      assert.equal(content.sha256, file.sha256);
    },
  };
}
