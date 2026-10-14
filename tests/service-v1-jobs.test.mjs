import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryJobStore, createServer, jobsRoute } from '../packages/service/dist/index.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
/** @type {import('../packages/protocol/dist/index.js').PassportEvent} */
const event = {
  id: 'step-1',
  flowId: 'flow-1',
  step: 'prove',
  phase: 'start',
  at: 12,
  clock: 'client',
};

test('jobs accept before work, return cursor deltas, and preserve a sanitized outcome', async () => {
  /** @type {() => void} */
  let finish = () => {};
  const gate = new Promise((resolve) => (finish = () => resolve(undefined)));
  const jobs = createMemoryJobStore({ newId: () => 'job-1' });
  const accepted = jobs.start(async (emit) => {
    emit(Object.assign({}, event, { secret: 'never publish this field' }));
    await gate;
    return { tx: 'aabb' };
  });
  assert.deepEqual(accepted, { jobId: 'job-1' });
  assert.equal(jobs.get('job-1')?.state, 'queued');
  await tick();
  assert.deepEqual(jobs.get('job-1'), {
    state: 'running',
    events: [{ ...event, clock: 'service' }],
    cursor: '1',
  });
  finish();
  await tick();
  assert.deepEqual(jobs.get('job-1', '1'), {
    state: 'done',
    events: [],
    cursor: '1',
    result: { tx: 'aabb' },
  });
  assert.throws(() => jobs.get('job-1', '2'), /invalid job cursor/);
  assert.throws(() => jobs.get('job-1', '-1'), /invalid job cursor/);
});

test('failed jobs sanitize errors and completed jobs expire without evicting running work', async () => {
  let time = 100;
  const ids = ['first', 'second'];
  const jobs = createMemoryJobStore({
    maxJobs: 1,
    completedTtlMs: 10,
    now: () => time,
    newId: () => ids.shift() ?? 'unexpected',
    errorOf: () => ({ code: 'SponsorRejected', message: 'policy refused' }),
  });
  jobs.start(async () => {
    throw new Error('sensitive backend detail');
  });
  assert.throws(() => jobs.start(async () => 2), /job store is full/);
  await tick();
  assert.deepEqual(jobs.get('first'), {
    state: 'failed',
    events: [],
    cursor: '0',
    error: { code: 'SponsorRejected', message: 'policy refused' },
  });
  time += 10;
  assert.equal(jobs.get('first'), undefined);
  assert.deepEqual(
    jobs.start(async () => 2),
    { jobId: 'second' },
  );
});

test('reference server exposes the v1 poll route and refuses malformed cursors', async (t) => {
  const jobs = createMemoryJobStore({ newId: () => 'job-1' });
  jobs.start(async () => ({ address: 'ab'.repeat(32), txIds: [] }));
  const server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
    jobsRoute(jobs),
  ]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const ok = await fetch(`${base}/v1/jobs/job-1?after=0`);
  assert.equal(ok.status, 200);
  assert.equal(/** @type {{state: string}} */ (await ok.json()).state, 'done');
  assert.equal((await fetch(`${base}/v1/jobs/job-1?after=-1`)).status, 400);
  assert.equal((await fetch(`${base}/v1/jobs/absent`)).status, 404);
});
