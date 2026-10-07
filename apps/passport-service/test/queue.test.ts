// The serial job queue (src/queue.ts) without HTTP: order, one at a time, the depth bound, and a
// failure that wedges nothing. Jobs are held open by hand, so no test waits on a timer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../src/http.ts';
import { serial } from '../src/queue.ts';

/** A job that settles when the test says so, and records when it starts. */
function controlled<T>(started: string[], name: string) {
  let release!: (value: T) => void;
  let fail!: (reason: unknown) => void;
  const gate = new Promise<T>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return {
    job: () => {
      started.push(name);
      return gate;
    },
    release,
    fail,
  };
}

/** Lets every queued promise reaction run. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('jobs start in the order offered and only after the one before has settled', async () => {
  const started: string[] = [];
  const run = serial();
  const a = controlled<string>(started, 'a');
  const b = controlled<string>(started, 'b');
  const c = controlled<string>(started, 'c');
  const results = [run(a.job), run(b.job), run(c.job)];
  await settle();
  assert.deepEqual(started, ['a'], 'only the first runs');
  a.release('A');
  await settle();
  assert.deepEqual(started, ['a', 'b']);
  b.release('B');
  await settle();
  assert.deepEqual(started, ['a', 'b', 'c']);
  c.release('C');
  assert.deepEqual(await Promise.all(results), ['A', 'B', 'C']);
});

test('a job that rejects tells only its own caller and the next job still runs', async () => {
  const started: string[] = [];
  const run = serial();
  const a = controlled<string>(started, 'a');
  const b = controlled<string>(started, 'b');
  const first = run(a.job);
  const second = run(b.job);
  const firstOutcome = first.then(
    () => 'resolved',
    (e: Error) => e.message,
  );
  a.fail(new Error('proof server hung up'));
  assert.equal(await firstOutcome, 'proof server hung up');
  await settle();
  assert.deepEqual(started, ['a', 'b'], 'b was not skipped');
  b.release('B');
  assert.equal(await second, 'B');
  // The queue is as good as new afterwards.
  assert.equal(await run(async () => 'later'), 'later');
});

test('a job that throws before it returns a promise is a rejection, not a crash or a wedge', async () => {
  const run = serial();
  await assert.rejects(
    run(() => {
      throw new Error('sync fault');
    }),
    /sync fault/,
  );
  assert.equal(await run(async () => 'ok'), 'ok');
});

test('a job that rejects with a non-Error value passes it through untouched', async () => {
  const run = serial();
  await assert.rejects(
    run(() => Promise.reject('plain string')),
    (e) => e === 'plain string',
  );
  assert.equal(await run(async () => 1), 1);
});

test('maxWaiting bounds the jobs behind the running one: the running job plus that many are accepted', async () => {
  const started: string[] = [];
  const run = serial(2);
  const gates = ['a', 'b', 'c'].map((name) => controlled<string>(started, name));
  const accepted = gates.map((g) => run(g.job));
  const refused = run(async () => 'd');
  await assert.rejects(refused, (e) => {
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, 503);
    assert.match(e.message, /too many queued jobs/);
    return true;
  });
  await settle();
  assert.deepEqual(started, ['a']);
  for (const [i, g] of gates.entries()) g.release(String(i));
  assert.deepEqual(await Promise.all(accepted), ['0', '1', '2']);
});

test('with no waiting allowed, only an idle queue accepts a job', async () => {
  const started: string[] = [];
  const run = serial(0);
  const a = controlled<string>(started, 'a');
  const running = run(a.job);
  await assert.rejects(
    run(async () => 'b'),
    { status: 503 },
  );
  a.release('A');
  assert.equal(await running, 'A');
  assert.equal(await run(async () => 'c'), 'c', 'idle again');
});

test('a refused job takes no slot, and capacity returns as jobs settle, failures included', async () => {
  const started: string[] = [];
  const run = serial(1);
  const a = controlled<string>(started, 'a');
  const b = controlled<string>(started, 'b');
  const first = run(a.job);
  const second = run(b.job);
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      run(async () => 'x'),
      { status: 503 },
    );
  a.fail(new Error('a failed'));
  await assert.rejects(first, /a failed/);
  await settle();
  // One slot is free again: a failed job released its place like a successful one.
  const third = run(async () => 'third');
  await assert.rejects(
    run(async () => 'over'),
    { status: 503 },
  );
  b.release('B');
  assert.equal(await second, 'B');
  assert.equal(await third, 'third');
  assert.equal(await run(async () => 'drained'), 'drained');
});

test('an unbounded queue never refuses', async () => {
  const run = serial();
  const jobs = Array.from({ length: 200 }, (_, i) => run(async () => i));
  assert.equal((await Promise.all(jobs)).length, 200);
});
