#!/usr/bin/env node
// Read-only existing Actions evidence. No dispatch, rerun, cache write or publication.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { freshRoot, put, sha256, object } from '../release/files.mjs';
import { timingReport, repeatedTiming, substantiveJob } from './timing.mjs';

const REPOSITORY = 'input-output-hk/midnight-passport-sdk';
/** @param {string} path @param {AbortSignal} signal @returns {Promise<string>} */
async function github(path, signal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        execFile(
          'gh',
          ['api', '--allow-escape-sequences', `repos/${REPOSITORY}/${path}`],
          { timeout: 15_000, maxBuffer: 4 * 1024 ** 2, signal, encoding: 'utf8' },
          (error, stdout) => {
            if (error) reject(Error('GitHub timing read unavailable'));
            else resolve(stdout);
          },
        );
      });
    } catch {
      if (attempt === 1 || signal.aborted) throw Error('GitHub timing read unavailable');
      await delay(200, undefined, { signal });
    }
  }
  throw Error('Unreachable metadata retry state');
}
/** @param {number} runId @param {number} attempt @param {(path:string)=>Promise<string>} get */
export async function timingJobs(runId, attempt, get) {
  /** @type {unknown[]} */ const jobs = [];
  let total = -1;
  for (let page = 1; page <= 2; page++) {
    const response = object(
      JSON.parse(
        await get(`actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`),
      ),
    );
    assert.ok(
      typeof response.total_count === 'number' &&
        Number.isSafeInteger(response.total_count) &&
        response.total_count > 0 &&
        response.total_count <= 128,
    );
    if (total < 0) total = response.total_count;
    else assert.equal(response.total_count, total);
    assert.ok(Array.isArray(response.jobs) && response.jobs.length <= 100);
    jobs.push(...response.jobs);
    if (jobs.length >= total) {
      assert.equal(jobs.length, total);
      return jobs;
    }
    assert.equal(response.jobs.length, 100, 'Partial pagination cannot establish inventory');
  }
  throw Error('Timing inventory exceeds pagination bound');
}
/** @param {number[]} runIds @param {string} output */
export async function collectTiming(runIds, output) {
  assert.ok(
    runIds.length > 0 &&
      runIds.length <= 5 &&
      runIds.every((n) => Number.isSafeInteger(n) && n > 0),
  );
  assert.equal(new Set(runIds).size, runIds.length);
  freshRoot(output);
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 90_000);
  /** @type {ReturnType<typeof timingReport>[]} */ const samples = [];
  try {
    for (const runId of runIds) {
      const get = (/** @type {string} */ path) => github(path, controller.signal);
      const raw = await get(`actions/runs/${runId}`),
        run = object(JSON.parse(raw));
      put(join(output, `${runId}.run.json`), raw);
      assert.equal(run.path, '.github/workflows/pr-checks.yml');
      assert.ok(typeof run.head_sha === 'string' && /^[a-f0-9]{40}$/.test(run.head_sha));
      assert.ok(
        typeof run.run_attempt === 'number' &&
          Number.isSafeInteger(run.run_attempt) &&
          run.run_attempt > 0,
      );
      const jobs = await timingJobs(runId, run.run_attempt, get);
      put(join(output, `${runId}.jobs.json`), JSON.stringify(jobs, null, 2) + '\n');
      const workflow = execFileSync(
        'git',
        ['show', `${run.head_sha}:.github/workflows/pr-checks.yml`],
        { encoding: 'utf8', timeout: 5_000, maxBuffer: 256 * 1024 },
      );
      const workflowSha256 = sha256(workflow);
      put(join(output, `${runId}.workflow.yml`), workflow);
      /** @type {Map<number,string|null>} */ const logs = new Map();
      const selected = jobs.map(object).filter((job) => substantiveJob(String(job.name)));
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, selected.length) }, async () => {
          while (index < selected.length && !controller.signal.aborted) {
            const job = selected[index++];
            assert.ok(
              job && typeof job.id === 'number' && Number.isSafeInteger(job.id) && job.id > 0,
            );
            try {
              const log = await get(`actions/jobs/${job.id}/logs`);
              put(join(output, `${runId}.${job.id}.private.log`), log);
              logs.set(job.id, log);
            } catch {
              logs.set(job.id, null);
            } // Missing logs remain unknown, never inferred warm.
          }
        }),
      );
      assert.equal(controller.signal.aborted, false, 'Timing collection deadline expired');
      const final = object(JSON.parse(await get(`actions/runs/${runId}`)));
      assert.equal(final.run_attempt, run.run_attempt);
      assert.equal(final.head_sha, run.head_sha);
      assert.equal(final.status, 'completed');
      const report = timingReport(run, jobs, workflowSha256, logs);
      samples.push(report);
      put(join(output, `${runId}.timing.json`), JSON.stringify(report, null, 2) + '\n');
    }
    const result = {
      schema: 1,
      repository: REPOSITORY,
      samples,
      comparison: repeatedTiming(samples),
      calls: { concurrency: 4, retries: 1, requestDeadlineMs: 15_000, overallDeadlineMs: 90_000 },
      newWorkflowDispatches: 0,
      rawLogsPubliclyMirrored: false,
    };
    put(join(output, 'receipt.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  } catch {
    put(
      join(output, 'failure.json'),
      JSON.stringify({
        kind: 'incomplete-timing-collection',
        completedSamples: samples.length,
        warmTargetEstablished: false,
      }) + '\n',
    );
    throw Error('Timing collection incomplete; inspect retained private inputs');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , flag, ids, outputFlag, output] = process.argv;
  assert.ok(
    process.argv.length === 6 && flag === '--runs' && outputFlag === '--output' && ids && output,
  );
  assert.match(ids, /^\d+(?:,\d+){0,4}$/);
  const result = await collectTiming(ids.split(',').map(Number), output);
  console.log(
    JSON.stringify({ runs: result.samples.map((s) => s.runId), comparison: result.comparison }),
  );
}
