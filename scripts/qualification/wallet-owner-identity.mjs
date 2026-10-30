// Read-only synthetic fixture pinning; never a passkey provider or ACC-seed recovery API.
import assert from 'node:assert/strict';
import { readFileSync, lstatSync } from 'node:fs';
import { isAbsolute, dirname, basename } from 'node:path';
import { decodeMutationValue } from '../../packages/account/dist/index.js';
/** @param {string} path */
export function readSyntheticOwnerWalletSeed(path) {
  assert.ok(isAbsolute(path));
  assert.equal(basename(path), 'fixture.json');
  /** @param {string} p @param {boolean} directory */
  const check = (p, directory) => {
    const s = lstatSync(p);
    assert.equal(s.isSymbolicLink(), false);
    assert.equal(directory ? s.isDirectory() : s.isFile(), true);
    assert.equal(s.mode & 0o077, 0);
    if (process.getuid) assert.equal(s.uid, process.getuid());
    if (!directory) assert.ok(s.size < 65536);
  };
  check(dirname(path), true);
  check(path, false);
  const f = /** @type {any} */ (decodeMutationValue(JSON.parse(readFileSync(path, 'utf8'))));
  const seed = f?.participants?.owner?.seed;
  assert.ok(seed instanceof Uint8Array && [32, 64].includes(seed.length));
  assert.ok(seed.some((/** @type {number} */ b) => b !== 0));
  const result = seed.slice();
  seed.fill(0);
  return result;
}
