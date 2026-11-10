// Whole jobs, observed steps and registration offsets are separate measurements.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { stripVTControlCharacters } from 'node:util';

const hash = (/** @type {string} */ text) => createHash('sha256').update(text).digest('hex');
/** @param {unknown} value @returns {Record<string,unknown>} */
function record(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}
/** @param {unknown} value */
function id(value) {
  assert.ok(typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
  return value;
}
/** @param {unknown} value */
function stamp(value) {
  assert.ok(
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value),
  );
  const n = Date.parse(value);
  assert.ok(Number.isFinite(n) && n > 0);
  return n;
}

export const REQUIRED_JOBS = Object.freeze([
  'Review size (5k–10k preferred)',
  '7-day dependency cooldown',
  'Registers never tracked',
  'Lint and format',
  'Fresh build and all types',
  'Application and key service tests',
  ...[1, 2, 3, 4].map((i) => `Package tests (${i}/4)`),
  ...['p256', 'jubjub'].flatMap((arm) =>
    ['presentation', 'account-actions', 'scoped-sessions', 'owner-safety'].map(
      (group) => `Demo UI journeys (${arm}, ${group}, synthetic credentials)`,
    ),
  ),
  'Complete browser journey inventory',
  'Lint, format, build, and test',
]);
/** @param {string} name */
export function substantiveJob(name) {
  return (
    /^(?:Package tests|Demo UI journeys)/.test(name) ||
    ['Lint and format', 'Fresh build and all types', 'Application and key service tests'].includes(
      name,
    )
  );
}

/** @param {string} name */
export function requiredSteps(name) {
  if (name === 'Lint and format') return ['Lint and format'];
  if (name === 'Fresh build and all types')
    return ['Build and check every script type', 'Check application types'];
  if (name === 'Application and key service tests')
    return ['Fresh package outputs', 'Test all applications and key service'];
  if (name.startsWith('Package tests'))
    return [
      'Fresh package outputs (script types run in build_types)',
      "Run every package test through Node's disjoint file shards",
    ];
  if (name.startsWith('Demo UI journeys'))
    return [
      'Fresh package outputs',
      'Actual Chromium UI with isolated synthetic account and chain drivers',
      'Retain exact cell receipt',
      'Retain declared browser scope in job summary',
      ...(name.includes('(p256, presentation,') ? ['Browser worker and IndexedDB contracts'] : []),
    ];
  if (name === 'Review size (5k–10k preferred)') return ['Report authored review size'];
  if (name === '7-day dependency cooldown') return ['Reject package versions younger than 7 days'];
  if (name === 'Registers never tracked')
    return ['Fail if a register path is tracked or no longer git-ignored'];
  if (name === 'Complete browser journey inventory')
    return ['Require eight matching, disjoint and exhaustive cells'];
  assert.equal(name, 'Lint, format, build, and test');
  return ['Require every full gate component'];
}

/** Cache logs establish only observed restore state, never package integrity.
 * @param {string|null} raw */
export function cacheObservation(raw) {
  if (raw === null)
    return {
      state: 'unknown',
      requestedKey: null,
      restoredKey: null,
      reportedBytes: null,
      observedActionMs: null,
      logSha256: null,
    };
  assert.ok(Buffer.byteLength(raw) <= 4 * 1024 ** 2, 'Cache log exceeds bound');
  const lines = cacheLines(stripVTControlCharacters(raw));
  const requested = new Set(),
    restored = new Set();
  let miss = false,
    reportedBytes = null,
    started = null,
    ended = null;
  for (const line of lines) {
    const input = line.replace(/^\d{4}-\d{2}-\d{2}T[^ ]+Z /, '');
    const key = input.match(/^\s+key: (pnpm-v[12]-[A-Za-z0-9_-]+-[a-f0-9]{64})\s*$/)?.[1];
    if (key) requested.add(key);
    const found = line.match(
      /Cache (?:hit for|restored from key): (pnpm-v[12]-[A-Za-z0-9_-]+-[a-f0-9]{64})\s*$/,
    )?.[1];
    if (found) restored.add(found);
    if (/Cache not found for input keys: pnpm-v[12]-/.test(line)) miss = true;
    const time = line.match(/^(\d{4}-\d{2}-\d{2}T[^ ]+Z)/)?.[1];
    if (time && /Run actions\/cache@0400d5f644dc74513175e3cd8d07132dd4860809/.test(line))
      started = stamp(time);
    if (time && (found || /Cache not found for input keys: pnpm-v[12]-/.test(line)))
      ended = stamp(time);
    const size = line.match(/Cache Size:.*\((\d+) B\)/)?.[1];
    if (size) {
      reportedBytes = Number(size);
      assert.ok(Number.isSafeInteger(reportedBytes));
    }
  }
  const requestedKey = requested.size === 1 ? ([...requested][0] ?? null) : null,
    restoredKey = restored.size === 1 ? ([...restored][0] ?? null) : null;
  const state = cacheState(requestedKey, restoredKey, miss, restored.size);
  return {
    state,
    requestedKey,
    restoredKey,
    reportedBytes: restoredKey ? reportedBytes : null,
    observedActionMs:
      started !== null && ended !== null && ended >= started ? ended - started : null,
    logSha256: hash(raw),
  };
}

/** Admit only the first pinned cache action, never later test output.
 * @param {string} text */
function cacheLines(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) =>
    /##\[group\]Run actions\/cache@0400d5f644dc74513175e3cd8d07132dd4860809/.test(line),
  );
  if (start < 0) return [];
  const next = lines.findIndex((line, index) => index > start && /##\[group\]/.test(line));
  return lines.slice(start, next < 0 ? undefined : next);
}

/** @param {string|null} requested @param {string|null} restored @param {boolean} miss @param {number} restoredCount */
function cacheState(requested, restored, miss, restoredCount) {
  if (requested && !miss && restored && restored.startsWith(requested.slice(0, -64)))
    return requested === restored ? 'exact-hit' : 'fallback-hit';
  return requested && miss && restoredCount === 0 ? 'miss' : 'unknown';
}

/** @param {Record<string,unknown>} job @param {number} started @param {number} completed */
function steps(job, started, completed) {
  assert.ok(Array.isArray(job.steps) && job.steps.length > 0 && job.steps.length <= 100);
  let priorNumber = 0,
    priorEnd = started;
  return job.steps.map((value) => {
    const step = record(value),
      number = id(step.number);
    assert.ok(number > priorNumber);
    priorNumber = number;
    assert.equal(step.status, 'completed');
    assert.ok(typeof step.name === 'string' && step.name.length <= 512);
    const skipped = step.conclusion === 'skipped';
    if (skipped && String(step.started_at).startsWith('0001-'))
      return {
        name: step.name,
        number,
        conclusion: 'skipped',
        milliseconds: 0,
        timeObserved: false,
      };
    const from = stamp(step.started_at),
      to = stamp(step.completed_at);
    assert.ok(from >= priorEnd && to >= from && to <= completed);
    priorEnd = to;
    return {
      name: step.name,
      number,
      conclusion: String(step.conclusion),
      milliseconds: to - from,
      timeObserved: true,
    };
  });
}
/** @param {unknown} runInput @param {unknown[]} jobsInput @param {string} workflowSha256 @param {Map<number,string|null>} [logs] */
export function timingReport(runInput, jobsInput, workflowSha256, logs = new Map()) {
  const run = record(runInput),
    runId = id(run.id),
    attempt = id(run.run_attempt);
  assert.equal(run.path, '.github/workflows/pr-checks.yml');
  assert.equal(run.name, 'PR checks');
  assert.equal(run.status, 'completed');
  assert.ok(typeof run.head_sha === 'string' && /^[a-f0-9]{40}$/.test(run.head_sha));
  assert.match(workflowSha256, /^[a-f0-9]{64}$/);
  assert.equal(new Set(jobsInput.map((v) => id(record(v).id))).size, jobsInput.length);
  const names = jobsInput.map((v) => String(record(v).name));
  assert.deepEqual(
    [...names].sort(),
    [...REQUIRED_JOBS].sort(),
    'Complete exact job/matrix inventory required',
  );
  const created = stamp(run.created_at),
    runStarted = stamp(run.run_started_at),
    updated = stamp(run.updated_at);
  assert.ok(runStarted >= created && updated >= runStarted);
  const jobs = jobsInput.map((value) => {
    const job = record(value),
      jobId = id(job.id);
    assert.equal(job.run_id, runId);
    assert.equal(job.run_attempt, attempt);
    assert.equal(job.head_sha, run.head_sha);
    assert.equal(job.status, 'completed');
    const registered = stamp(job.created_at),
      started = stamp(job.started_at),
      completed = stamp(job.completed_at);
    assert.ok(
      registered >= created &&
        started >= registered &&
        completed >= started &&
        completed <= updated,
    );
    const measured = steps(job, started, completed),
      stepMs = measured.reduce((sum, row) => sum + row.milliseconds, 0);
    const name = String(job.name),
      substantive = substantiveJob(name);
    if (job.conclusion === 'success') {
      assert.ok(
        measured.every((s) => s.conclusion === 'success' || s.conclusion === 'skipped'),
        'Contradictory successful job',
      );
      for (const expected of requiredSteps(name))
        assert.ok(
          measured.some((s) => s.name === expected && s.conclusion === 'success'),
          'Required execution step absent',
        );
    }
    assert.ok(
      !substantive ||
        measured.some(
          (row) =>
            row.name === 'Run ./.github/actions/prepare-workspace' && row.conclusion === 'success',
        ),
      'Substantive preparation missing',
    );
    const cache = substantive
      ? cacheObservation(logs.get(jobId) ?? null)
      : { ...cacheObservation(null), state: 'not-applicable' };
    return {
      id: jobId,
      name,
      role: substantive ? 'substantive' : 'control',
      conclusion: String(job.conclusion),
      milliseconds: completed - started,
      registrationOffsetMs: registered - created,
      registeredToStartMs: started - registered,
      waitComponents: 'queue/runner allocation not independently observed',
      stepMs,
      unattributedMs: completed - started - stepMs,
      prepareMs: measured
        .filter((s) => s.name === 'Run ./.github/actions/prepare-workspace')
        .reduce((n, s) => n + s.milliseconds, 0),
      steps: measured,
      cache,
      url: `https://github.com/input-output-hk/midnight-passport-sdk/actions/runs/${runId}/job/${jobId}`,
    };
  });
  const gatePassed = run.conclusion === 'success' && jobs.every((j) => j.conclusion === 'success');
  return {
    schema: 1,
    kind: 'observed-hosted-ci-timing',
    runId,
    attempt,
    headSha: run.head_sha,
    workflow: String(run.path),
    workflowSha256,
    executedCheckoutIdentity: 'unknown-api-head-is-not-merge-checkout',
    executedWorkflowIdentityVerified: false,
    gatePassed,
    jobCount: jobs.length,
    workflowStartDelayMs: runStarted - created,
    createdToLastJobMs: Math.max(...jobsInput.map((v) => stamp(record(v).completed_at))) - created,
    jobs,
    warmSample: jobs
      .filter((j) => j.role === 'substantive')
      .every((j) => j.cache.state === 'exact-hit'),
    budgetMs: 45_000,
    overBudget: jobs.filter((j) => j.milliseconds > 45_000).map((j) => j.name),
    coldOrFallbackCostsHidden: false,
    standaloneSampleEstablishesTarget: false,
  };
}

/** @param {ReturnType<typeof timingReport>[]} samples */
export function repeatedTiming(samples) {
  assert.ok(samples.length > 0 && samples.length <= 20);
  assert.equal(
    new Set(samples.map((s) => `${s.runId}:${s.attempt}`)).size,
    samples.length,
    'Duplicate run attempt',
  );
  const matching = new Set(samples.map((s) => `${s.headSha}:${s.workflowSha256}`)).size === 1;
  return {
    sampleCount: samples.length,
    matchingApiHeadAndWorkflow: matching,
    executedSourceBinding:
      'unknown; API head metadata cannot establish the checked-out merge source',
    repeatedWarmTargetEstablished:
      samples.length >= 3 &&
      samples.every((s) => s.executedWorkflowIdentityVerified) &&
      matching &&
      samples.every((s) => s.gatePassed && s.warmSample && s.overBudget.length === 0),
    extrapolatedPerformance: false,
  };
}
