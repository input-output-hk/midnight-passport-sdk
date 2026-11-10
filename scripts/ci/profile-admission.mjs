// Runtime admission for downloaded timing artifacts; typed JSON alone is not evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

/** @param {unknown} input */
function record(input) {
  assert.ok(input && typeof input === 'object' && !Array.isArray(input));
  return Object.fromEntries(Object.entries(input));
}
/** @param {unknown} value @param {RegExp} pattern */
function text(value, pattern) {
  assert.ok(typeof value === 'string' && value.length <= 512 && pattern.test(value));
  return value;
}
/** @param {unknown} value */
function integer(value) {
  assert.ok(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
  return value;
}
/** @param {unknown} value */
function milliseconds(value) {
  assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return value;
}
const digest = /^[a-f0-9]{64}$/;
const testPath = /^tests\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.test\.mjs$/;
const countKeys = ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo'];
/** @param {unknown} value */
function counts(value) {
  const row = record(value);
  assert.deepEqual(Object.keys(row).sort(), [...countKeys].sort());
  return Object.fromEntries(countKeys.map((key) => [key, integer(row[key])]));
}
/** @param {unknown} value */
function entries(value) {
  assert.ok(Array.isArray(value) && value.length > 0 && value.length <= 2000);
  return value;
}

/** Reject partial, stale, overlapping or contradictory externally loaded profiles.
 * @param {unknown} input @returns {ReturnType<ReturnType<typeof import('./package-profile.mjs').packageProfile>['finish']>} */
export function admitPackageProfile(input) {
  const row = record(input);
  assert.equal(row.schema, 1);
  assert.equal(row.kind, 'node-package-test-profile');
  assert.equal(row.includesProcessStartup, true);
  assert.equal(row.stdoutOrFixtureDataCollected, false);
  assert.equal(typeof row.sourceDirty, 'boolean');
  const rawInventory = record(row.inventory);
  const inventory = entries(rawInventory.inventory).map((value) => {
    const item = record(value);
    return { path: text(item.path, testPath), sha256: text(item.sha256, digest) };
  });
  assert.deepEqual(
    inventory.map((f) => f.path),
    inventory.map((f) => f.path).sort(),
  );
  assert.equal(new Set(inventory.map((f) => f.path)).size, inventory.length);
  const sha256 = text(rawInventory.sha256, digest);
  assert.equal(createHash('sha256').update(JSON.stringify(inventory)).digest('hex'), sha256);
  const catalog = new Map(inventory.map((f) => [f.path, f.sha256]));
  const files = entries(row.files).map((value) => {
    const file = record(value);
    const path = text(file.path, testPath),
      sha256 = text(file.sha256, digest);
    assert.equal(catalog.get(path), sha256);
    assert.equal(typeof file.passed, 'boolean');
    return {
      path,
      sha256,
      processMs: milliseconds(file.processMs),
      bodyMs: milliseconds(file.bodyMs),
      counts: counts(file.counts),
      passed: file.passed === true,
    };
  });
  assert.equal(new Set(files.map((f) => f.path)).size, files.length);
  const totals = record(row.totals),
    totalsCounts = counts(totals.counts);
  assert.equal(typeof totals.passed, 'boolean');
  for (const key of countKeys)
    assert.equal(
      files.reduce((n, f) => n + Number(f.counts[key]), 0),
      totalsCounts[key],
    );
  if (totals.passed) {
    assert.ok(files.every((f) => f.passed));
    for (const key of ['failed', 'cancelled']) assert.equal(totalsCounts[key], 0);
  }
  const shard = record(row.shard),
    index = integer(shard.index),
    total = integer(shard.total);
  assert.ok(index >= 1 && index <= total && total <= 32);
  const attempt = integer(row.attempt);
  assert.ok(attempt > 0);
  return {
    schema: 1,
    kind: 'node-package-test-profile',
    headSha: text(row.headSha, /^[a-f0-9]{40}$/),
    checkoutCommit: text(row.checkoutCommit, /^[a-f0-9]{40}$/),
    sourceDirty: row.sourceDirty === true,
    runId: text(row.runId, /^(?:local|[1-9]\d*)$/),
    attempt,
    workflowSha256: text(row.workflowSha256, digest),
    nodeVersion: text(row.nodeVersion, /^v\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
    platform: text(row.platform, /^(?:linux|darwin|win32)$/),
    arch: text(row.arch, /^(?:x64|arm64)$/),
    shard: { index, total },
    inventory: { inventory, sha256 },
    files,
    totals: {
      counts: totalsCounts,
      milliseconds: milliseconds(totals.milliseconds),
      passed: totals.passed === true,
    },
    includesProcessStartup: true,
    stdoutOrFixtureDataCollected: false,
  };
}
