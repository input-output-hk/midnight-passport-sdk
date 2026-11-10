import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  packageInventory,
  packageProfile,
  completePackageProfiles,
  partitionObservedFiles,
} from '../scripts/ci/package-profile.mjs';
import { admitPackageProfile } from '../scripts/ci/profile-admission.mjs';

/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ci-profile-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'tests'));
  for (const file of ['a', 'b'])
    writeFileSync(join(root, `tests/${file}.test.mjs`), '// synthetic test\n');
  const inventory = packageInventory(root);
  /** @param {number} index */
  const factory = (index) =>
    packageProfile({
      root,
      headSha: 'a'.repeat(40),
      checkoutCommit: 'b'.repeat(40),
      sourceDirty: false,
      runId: '12',
      attempt: 1,
      workflowSha256: 'c'.repeat(64),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      shard: { index, total: 2 },
      inventory,
    });
  /** @param {ReturnType<typeof factory>} profile @param {string} file */
  const feed = (profile, file) => {
    const counts = { tests: 2, passed: 2, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
    profile.accept({
      type: 'test:summary',
      data: { file: join(root, file), success: true, duration_ms: 5, counts },
    });
    profile.accept({
      type: 'test:complete',
      data: {
        file: join(root, file),
        name: file,
        nesting: 0,
        line: 1,
        column: 1,
        details: { duration_ms: 20 },
      },
    });
    profile.accept({ type: 'test:summary', data: { success: true, duration_ms: 30, counts } });
  };
  const profiles = [1, 2].map((index) => {
    const profile = factory(index);
    feed(profile, `tests/${index === 1 ? 'a' : 'b'}.test.mjs`);
    return profile.finish();
  });
  return { root, factory, feed, profiles };
}

test('profiling retains complete file hashes, process startup and counts without test stdout or fixtures', (t) => {
  const { profiles } = fixture(t);
  const complete = completePackageProfiles(profiles.map(admitPackageProfile));
  assert.equal(complete.files.length, 2);
  assert.equal(complete.sumObservedProcessMs, 40);
  const plan = partitionObservedFiles(complete, 2);
  assert.deepEqual(
    plan.shards.map((s) => s.files.length),
    [1, 1],
  );
  assert.equal(plan.defaultWorkflowSchedulingChanged, false);
  assert.equal(plan.predictsJobWallTime, false);
  assert.throws(() => partitionObservedFiles(complete, 3));
});

for (const variant of [
  'missing',
  'overlap',
  'source',
  'workflow',
  'attempt',
  'inventory',
  'file-hash',
  'counts',
  'failed',
  'unsafe-path',
  'nonfinite',
])
  test(`profile admission refuses incomplete/stale/contradictory evidence: ${variant}`, (t) => {
    const { profiles } = fixture(t),
      copy = structuredClone(profiles),
      first = copy[0],
      second = copy[1];
    assert.ok(first && second && first.files[0]);
    if (variant === 'missing') copy.pop();
    if (variant === 'overlap') second.files = first.files;
    if (variant === 'source') second.checkoutCommit = 'd'.repeat(40);
    if (variant === 'workflow') second.workflowSha256 = 'd'.repeat(64);
    if (variant === 'attempt') second.attempt = 2;
    if (variant === 'inventory') first.inventory.sha256 = 'd'.repeat(64);
    if (variant === 'file-hash') first.files[0].sha256 = 'd'.repeat(64);
    if (variant === 'counts') first.files[0].counts.tests = 3;
    if (variant === 'failed') first.totals.passed = false;
    if (variant === 'unsafe-path') first.files[0].path = '../private.test.mjs';
    if (variant === 'nonfinite') first.files[0].processMs = Infinity;
    assert.throws(() => completePackageProfiles(copy.map(admitPackageProfile)));
  });

test('reporter refuses source drift or incomplete final/process summaries', (t) => {
  const { root, factory, feed } = fixture(t);
  const missing = factory(1);
  missing.accept({
    type: 'test:summary',
    data: {
      success: true,
      duration_ms: 0,
      counts: { tests: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 },
    },
  });
  assert.throws(() => missing.finish());
  const stale = factory(1);
  feed(stale, 'tests/a.test.mjs');
  writeFileSync(join(root, 'tests/a.test.mjs'), '// changed\n');
  assert.throws(() => stale.finish(), /source changed/);
});
