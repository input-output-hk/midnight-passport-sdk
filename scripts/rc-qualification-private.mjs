// Optional synthetic owner capture for standalone qualification, never a credential API.
import assert from 'node:assert/strict';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, basename } from 'node:path';
import { privateDirectory } from './release/files.mjs';

/** Admit every destination before network/transaction dispatch; no public evidence may alias secrets.
 * @param {string} output @param {string|undefined} fixture */
export function admitSyntheticFixture(output, fixture) {
  if (!fixture) return;
  const canonical = (/** @type {string} */ path) => {
    assert.ok(isAbsolute(path));
    const parent = realpathSync(dirname(path));
    privateDirectory(parent);
    return join(parent, basename(path));
  };
  const paths = [
    output,
    output + '.tmp',
    output + `.pending-${process.pid}`,
    fixture,
    fixture + '.record',
    fixture + `.record.pending-${process.pid}`,
  ].map(canonical);
  assert.equal(
    new Set(paths).size,
    paths.length,
    'Synthetic fixture/evidence destinations overlap',
  );
  assert.ok(
    paths.every((path) => !existsSync(path)),
    'Preserve existing fixture/evidence destinations',
  );
}
