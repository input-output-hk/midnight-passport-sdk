import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cacheObservation,
  timingReport,
  repeatedTiming,
  REQUIRED_JOBS,
  requiredSteps,
  substantiveJob,
} from '../scripts/ci/timing.mjs';
import { timingJobs } from '../scripts/ci/collect-timing.mjs';

const key = 'pnpm-v1-Linux-X64-' + 'a'.repeat(64);
/** @param {'hit'|'fallback'|'miss'|'ambiguous'|'foreign'} mode */
function log(mode) {
  const restored =
    mode === 'hit'
      ? key
      : mode === 'foreign'
        ? key.replace('Linux', 'macOS')
        : key.slice(0, -64) + 'b'.repeat(64);
  return [
    '2026-11-10T12:00:00Z ##[group]Run actions/cache@0400d5f644dc74513175e3cd8d07132dd4860809',
    `  key: ${key}`,
    ...(mode === 'ambiguous' ? [`  key: ${restored}`] : []),
    mode === 'miss'
      ? `2026-11-10T12:00:02Z Cache not found for input keys: ${key}`
      : `2026-11-10T12:00:02Z Cache restored from key: ${restored}`,
    'Cache Size: ~1 MB (1000 B)',
    '##[group]Run tests',
    `Cache not found for input keys: ${key}`,
  ].join('\n');
}
/** @param {number} runId @param {string} [mode] */
function sample(runId, mode = 'warm') {
  const start = Date.parse('2026-11-10T12:00:00Z');
  const stamp = (/** @type {number} */ n) => new Date(start + n).toISOString();
  const run = {
    id: runId,
    run_attempt: 1,
    head_sha: 'a'.repeat(40),
    path: '.github/workflows/pr-checks.yml',
    name: 'PR checks',
    status: 'completed',
    conclusion: 'success',
    created_at: stamp(0),
    run_started_at: stamp(1000),
    updated_at: stamp(60000),
  };
  const jobs = REQUIRED_JOBS.map((name, index) => {
    const steps = [
      ...(substantiveJob(name) ? ['Run ./.github/actions/prepare-workspace'] : []),
      ...requiredSteps(name),
    ];
    return {
      id: index + 1,
      run_id: runId,
      run_attempt: 1,
      head_sha: run.head_sha,
      name,
      status: 'completed',
      conclusion: 'success',
      created_at: stamp(1000),
      started_at: stamp(2000),
      completed_at: stamp(mode === 'slow' && index === 7 ? 52000 : 32000),
      steps: steps.map((name, i) => ({
        name,
        number: i + 1,
        status: 'completed',
        conclusion: 'success',
        started_at: stamp(2000 + i * 1000),
        completed_at: stamp(3000 + i * 1000),
      })),
    };
  });
  const logs = new Map(
    jobs.map((j) => [j.id, mode === 'unknown' ? null : log(mode === 'cold' ? 'miss' : 'hit')]),
  );
  return { run, jobs, logs, report: () => timingReport(run, jobs, 'b'.repeat(64), logs) };
}

test('cache warmth needs pinned action, unambiguous matching keys and observed restore', () => {
  assert.equal(cacheObservation(null).state, 'unknown');
  assert.equal(cacheObservation(`key: ${key}\nCache restored from key: ${key}`).state, 'unknown');
  for (const [mode, state] of /** @type {const} */ ([
    ['hit', 'exact-hit'],
    ['fallback', 'fallback-hit'],
    ['miss', 'miss'],
    ['ambiguous', 'unknown'],
    ['foreign', 'unknown'],
  ]))
    assert.equal(cacheObservation(log(mode)).state, state);
  assert.equal(cacheObservation(log('hit')).observedActionMs, 2000);
  assert.equal(cacheObservation(log('hit')).reportedBytes, 1000);
  assert.equal(cacheObservation(log('miss')).reportedBytes, null);
  assert.throws(() => cacheObservation('x'.repeat(4 * 1024 ** 2 + 1)));
});

test('complete hosted inventory separates whole-job, steps, registration and unknown queue costs', () => {
  const result = sample(1).report();
  assert.equal(result.jobCount, 20);
  assert.equal(result.jobs.filter((j) => j.role === 'substantive').length, 15);
  assert.equal(result.warmSample, true);
  assert.equal(result.jobs[0]?.milliseconds, 30000);
  assert.equal(result.jobs[0]?.registeredToStartMs, 1000);
  assert.equal(result.standaloneSampleEstablishesTarget, false);
  assert.equal(result.jobs[0]?.cache.state, 'not-applicable');
});

test('hosted timing reports the 90-second target and retains the 45-second comparison', () => {
  const input = sample(1);
  input.run.updated_at = new Date(Date.parse(input.run.created_at) + 120_000).toISOString();
  const [first, second, third] = input.jobs;
  assert.ok(first && second && third);
  first.completed_at = new Date(Date.parse(first.started_at) + 46_000).toISOString();
  second.completed_at = new Date(Date.parse(second.started_at) + 90_000).toISOString();
  third.completed_at = new Date(Date.parse(third.started_at) + 91_000).toISOString();
  const report = input.report();
  assert.equal(report.budgetMs, 90_000);
  assert.deepEqual(report.overBudget, [third.name]);
  assert.deepEqual(report.over45Seconds, [first.name, second.name, third.name]);
});

for (const variant of [
  'missing',
  'duplicate',
  'attempt',
  'head',
  'required-step',
  'contradictory',
  'overlap',
  'outside',
])
  test(`timing rejects incomplete or inconsistent evidence: ${variant}`, () => {
    const input = sample(1),
      job = input.jobs[0];
    assert.ok(job);
    if (variant === 'missing') input.jobs.pop();
    if (variant === 'duplicate') input.jobs.push(job);
    if (variant === 'attempt') job.run_attempt = 2;
    if (variant === 'head') job.head_sha = 'c'.repeat(40);
    if (variant === 'required-step') job.steps = [];
    if (variant === 'contradictory') {
      assert.ok(job.steps[0]);
      job.steps[0].conclusion = 'failure';
    }
    if (variant === 'overlap') {
      assert.ok(job.steps[0]);
      job.steps.push({ ...job.steps[0], number: 2 });
    }
    if (variant === 'outside') job.completed_at = '2026-11-10T13:00:00Z';
    assert.throws(input.report);
  });

test('warm target requires three distinct matching complete successful samples with every job within budget', () => {
  const warm = [1, 2, 3].map((n) => sample(n).report());
  assert.equal(repeatedTiming(warm).repeatedWarmTargetEstablished, false);
  assert.ok(warm.every((s) => !s.executedWorkflowIdentityVerified));
  assert.equal(repeatedTiming(warm.slice(1)).repeatedWarmTargetEstablished, false);
  assert.throws(() => repeatedTiming([warm[0], warm[0]].filter((s) => s !== undefined)));
  for (const mode of ['cold', 'slow', 'unknown'])
    assert.equal(
      repeatedTiming([sample(1, mode).report(), ...warm.slice(1)]).repeatedWarmTargetEstablished,
      false,
    );
  assert.ok(warm[0]);
  warm[0].headSha = 'd'.repeat(40);
  assert.equal(repeatedTiming(warm).repeatedWarmTargetEstablished, false);
});

test('job metadata uses exact attempt and exhaustive bounded pagination', async () => {
  /** @type {string[]} */ const paths = [];
  const jobs = await timingJobs(12, 3, async (path) => {
    paths.push(path);
    return JSON.stringify({
      total_count: 101,
      jobs: Array.from({ length: paths.length === 1 ? 100 : 1 }, (_, i) => ({ id: i })),
    });
  });
  assert.equal(jobs.length, 101);
  assert.ok(paths.every((p) => p.includes('/attempts/3/jobs?')));
  await assert.rejects(
    timingJobs(1, 1, async () => JSON.stringify({ total_count: 101, jobs: [{}] })),
  );
  await assert.rejects(
    timingJobs(1, 1, async () => JSON.stringify({ total_count: 129, jobs: [] })),
  );
});
