// Nix replaces TMPDIR per shell. A shared localnet lease must use a stable user path.
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/** home is injectable for isolated filesystem/process tests, never a CLI override.
 * @param {string} [home]
 */
export function nativeLeasePath(home = homedir()) {
  assert.ok(isAbsolute(home));
  const directory = join(realpathSync(home), '.midnight-passport-native-qualification');
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
  }
  const stat = lstatSync(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Lease directory must not be a link');
  assert.equal(stat.mode & 0o077, 0, 'Lease directory must be private');
  if (process.getuid) assert.equal(stat.uid, process.getuid(), 'Lease directory owner differs');
  return join(directory, 'mn-passport-qual-20261023-published-native.lock');
}
