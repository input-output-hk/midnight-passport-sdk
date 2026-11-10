// Public test-file timings only. Never collect stdout, test names, arguments or fixtures.
import assert from 'node:assert/strict';
import { globSync, readFileSync, lstatSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const hash = (/** @type {string|Uint8Array} */ value) =>
  createHash('sha256').update(value).digest('hex');
/** @param {string} root */
export function packageInventory(root) {
  assert.equal(realpathSync(root), root);
  const inventory = globSync('tests/**/*.test.mjs', { cwd: root })
    .sort()
    .map((path) => {
      const full = join(root, path);
      assert.equal(realpathSync(full), full);
      assert.equal(lstatSync(full).isFile(), true);
      return { path, sha256: hash(readFileSync(full)) };
    });
  assert.ok(inventory.length > 0 && inventory.length <= 2000);
  return { inventory, sha256: hash(JSON.stringify(inventory)) };
}
/** @param {unknown} input @returns {Record<string,unknown>} */
function record(input) {
  assert.ok(input && typeof input === 'object' && !Array.isArray(input));
  return Object.fromEntries(Object.entries(input));
}
const countKeys = ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo'];
/** @param {unknown} input */
function counts(input) {
  const value = record(input);
  return Object.fromEntries(
    countKeys.map((key) => {
      assert.ok(Number.isSafeInteger(value[key]) && Number(value[key]) >= 0);
      return [key, Number(value[key])];
    }),
  );
}
/** @param {unknown} value */
function duration(value) {
  assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return value;
}

/** @typedef {{root:string,headSha:string,checkoutCommit:string,sourceDirty:boolean,runId:string,attempt:number,workflowSha256:string,nodeVersion:string,platform:string,arch:string,shard:{index:number,total:number},inventory:ReturnType<typeof packageInventory>}} ProfileContext */
/** @param {ProfileContext} context */
export function packageProfile(context) {
  const catalog = new Map(context.inventory.inventory.map((f) => [f.path, f.sha256]));
  /** @type {Map<string,{bodyMs:number,counts:Record<string,number>,passed:boolean}>} */ const bodies =
    new Map();
  /** @type {Map<string,number>} */ const processes = new Map();
  /** @type {{counts:Record<string,number>,milliseconds:number,passed:boolean}|null} */ let final =
    null;
  const filePath = (/** @type {unknown} */ file) => {
    assert.equal(typeof file, 'string');
    const path = relative(context.root, String(file));
    assert.equal(catalog.has(path), true, 'Unexpected test file');
    return path;
  };
  return {
    accept(/** @type {{type:string,data:unknown}} */ event) {
      if (event.type === 'test:summary') {
        const data = record(event.data);
        assert.equal(typeof data.success, 'boolean');
        if (data.file !== undefined) {
          const path = filePath(data.file);
          assert.equal(bodies.has(path), false);
          bodies.set(path, {
            bodyMs: duration(data.duration_ms),
            counts: counts(data.counts),
            passed: data.success === true,
          });
        } else {
          assert.equal(final, null, 'Duplicate final test summary');
          final = {
            counts: counts(data.counts),
            milliseconds: duration(data.duration_ms),
            passed: data.success === true,
          };
        }
      } else if (event.type === 'test:complete') {
        const data = record(event.data);
        if (
          data.nesting !== 0 ||
          data.line !== 1 ||
          data.column !== 1 ||
          typeof data.file !== 'string'
        )
          return;
        const path = filePath(data.file);
        if (data.name !== path && data.name !== data.file) return;
        assert.equal(processes.has(path), false);
        processes.set(path, duration(record(data.details).duration_ms));
      }
    },
    finish() {
      assert.ok(final && bodies.size > 0);
      assert.deepEqual(
        [...processes.keys()].sort(),
        [...bodies.keys()].sort(),
        'Incomplete file timing/summary inventory',
      );
      assert.equal(
        packageInventory(context.root).sha256,
        context.inventory.sha256,
        'Test source changed during profiling',
      );
      const files = [...bodies]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, body]) => ({
          path,
          sha256: String(catalog.get(path)),
          processMs: processes.get(path) ?? -1,
          ...body,
        }));
      for (const key of countKeys)
        assert.equal(
          files.reduce((n, f) => n + Number(f.counts[key]), 0),
          final.counts[key],
          `Incomplete ${key} count`,
        );
      return {
        schema: 1,
        kind: 'node-package-test-profile',
        headSha: context.headSha,
        checkoutCommit: context.checkoutCommit,
        sourceDirty: context.sourceDirty,
        runId: context.runId,
        attempt: context.attempt,
        workflowSha256: context.workflowSha256,
        nodeVersion: context.nodeVersion,
        platform: context.platform,
        arch: context.arch,
        shard: context.shard,
        inventory: context.inventory,
        files,
        totals: final,
        includesProcessStartup: true,
        stdoutOrFixtureDataCollected: false,
      };
    },
  };
}

/** @param {ReturnType<ReturnType<typeof packageProfile>['finish']>[]} samples */
export function completePackageProfiles(samples) {
  assert.ok(samples.length > 0 && samples.length <= 32);
  const first = samples[0];
  assert.ok(first);
  const total = first.shard.total;
  assert.equal(samples.length, total);
  assert.deepEqual(
    samples.map((s) => s.shard.index).sort((a, b) => a - b),
    Array.from({ length: total }, (_, n) => n + 1),
  );
  const fields = [
    'headSha',
    'checkoutCommit',
    'sourceDirty',
    'runId',
    'attempt',
    'workflowSha256',
    'nodeVersion',
    'platform',
    'arch',
  ];
  for (const sample of samples) {
    for (const field of fields)
      assert.equal(
        /** @type {Record<string,unknown>} */ (sample)[field],
        /** @type {Record<string,unknown>} */ (first)[field],
      );
    assert.equal(sample.inventory.sha256, first.inventory.sha256);
    assert.deepEqual(sample.inventory, first.inventory);
    assert.equal(sample.shard.total, total);
    assert.equal(sample.totals.passed, true);
  }
  const files = samples.flatMap((s) => s.files);
  assert.equal(new Set(files.map((f) => f.path)).size, files.length, 'Overlapping package shards');
  assert.deepEqual(
    files
      .map((f) => ({ path: f.path, sha256: f.sha256 }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    [...first.inventory.inventory].sort((a, b) => a.path.localeCompare(b.path)),
    'Omitted or stale package test file',
  );
  return {
    source: first.checkoutCommit,
    sourceDirty: first.sourceDirty,
    headSha: first.headSha,
    runId: first.runId,
    attempt: first.attempt,
    inventorySha256: first.inventory.sha256,
    shardCount: total,
    files,
    sumObservedProcessMs: files.reduce((n, f) => n + f.processMs, 0),
    predictsJobWallTime: false,
  };
}

/** Observed load sums guide partitioning; they are not projected job durations.
 * @param {ReturnType<typeof completePackageProfiles>} profile @param {number} total */
export function partitionObservedFiles(profile, total) {
  assert.ok(
    Number.isSafeInteger(total) && total > 0 && total <= profile.files.length && total <= 32,
  );
  const shards = Array.from({ length: total }, (_, i) => ({
    index: i + 1,
    files: /** @type {string[]} */ ([]),
    observedLoadMs: 0,
  }));
  for (const file of [...profile.files].sort(
    (a, b) => b.processMs - a.processMs || a.path.localeCompare(b.path),
  )) {
    const target = [...shards].sort(
      (a, b) => a.observedLoadMs - b.observedLoadMs || a.index - b.index,
    )[0];
    assert.ok(target);
    target.files.push(file.path);
    target.observedLoadMs += file.processMs;
  }
  assert.equal(shards.flatMap((s) => s.files).length, profile.files.length);
  return {
    source: profile.source,
    sourceDirty: profile.sourceDirty,
    inventorySha256: profile.inventorySha256,
    shards,
    predictsJobWallTime: false,
    defaultWorkflowSchedulingChanged: false,
  };
}
