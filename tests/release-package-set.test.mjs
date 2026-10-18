import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertReleasePackageSet,
  releasePackageDirectories,
} from '../scripts/release-package-list.mjs';
const files = releasePackageDirectories.map((name) => ({
  name: `@input-output-hk/mn-passport-${name}`,
}));
test('release package set accepts the implemented packages in any packing order', () => {
  assert.doesNotThrow(() => assertReleasePackageSet(files.slice().reverse()));
});
test('release package set rejects count-preserving duplicates and unknown packages', () => {
  assert.throws(() => assertReleasePackageSet([...files.slice(1), files[1]]), /duplicate/);
  assert.throws(
    () => assertReleasePackageSet([...files.slice(1), { name: '@input-output-hk/unknown' }]),
    /unknown/,
  );
  assert.throws(() => assertReleasePackageSet(files.slice(1)), /incomplete/);
  assert.throws(() => assertReleasePackageSet(null), /incomplete/);
});
