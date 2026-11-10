// Node test reporter beside TAP; the same built-in shards execute every test.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { realpathSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { packageInventory, packageProfile } from './package-profile.mjs';

/** @param {AsyncIterable<{type:string,data:unknown}>} source */
export default async function* report(source) {
  assert.equal(process.env.PASSPORT_PACKAGE_TIMING, '1');
  const root = realpathSync(process.cwd());
  const checkoutCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
    timeout: 5_000,
  }).trim();
  const headSha = process.env.PASSPORT_PR_HEAD_SHA ?? checkoutCommit;
  const sourceDirty = Boolean(
    execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 1024 ** 2,
    }).trim(),
  );
  if (process.env.GITHUB_ACTIONS === 'true')
    assert.equal(sourceDirty, false, 'Hosted profile requires clean checked-out source');
  assert.match(checkoutCommit, /^[a-f0-9]{40}$/);
  assert.match(headSha, /^[a-f0-9]{40}$/);
  if (process.env.GITHUB_SHA) assert.equal(process.env.GITHUB_SHA, checkoutCommit);
  const selected = (process.env.PASSPORT_PACKAGE_SHARD ?? '1/1').match(/^(\d+)\/(\d+)$/);
  assert.ok(selected);
  const index = Number(selected[1]),
    total = Number(selected[2]);
  assert.ok(index >= 1 && index <= total && total <= 32);
  const runId = process.env.GITHUB_RUN_ID ?? 'local',
    attempt = Number(process.env.GITHUB_RUN_ATTEMPT ?? '1');
  assert.match(runId, /^(?:local|\d+)$/);
  assert.ok(Number.isSafeInteger(attempt) && attempt > 0);
  const profile = packageProfile({
    root,
    headSha,
    checkoutCommit,
    sourceDirty,
    runId,
    attempt,
    workflowSha256: createHash('sha256')
      .update(readFileSync(join(root, '.github/workflows/pr-checks.yml')))
      .digest('hex'),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    shard: { index, total },
    inventory: packageInventory(root),
  });
  for await (const event of source) profile.accept(event);
  yield JSON.stringify(profile.finish()) + '\n';
}
