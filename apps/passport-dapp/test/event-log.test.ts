// The client event log (src/event-log.ts) on a clock the test sets: when each run and stage
// starts and ends, what a failure records, the ad-hoc stages, change notifications, and the
// evidence rows that `toJSON` hands to the Copy button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PassportEvent } from '@midnight-ntwrk/mn-passport-protocol';
import { EventLog } from '../src/event-log.ts';
import type { PlainError } from '../src/flows.ts';

/** An EventLog on a settable clock. */
function make(start = 0) {
  let t = start;
  const log = new EventLog(() => t);
  return {
    log,
    at: (ms: number) => {
      t = start + ms;
    },
    iso: (ms: number) => new Date(start + ms).toISOString(),
  };
}

const error = (code = 'InternalError'): PlainError => ({
  code,
  message: `${code} happened`,
  hint: `what ${code} means`,
});

test('a run starts with its first stage, timed from the clock', () => {
  const { log } = make(5_000);
  const run = log.start('create');
  assert.equal(run.action, 'create');
  assert.equal(run.title, 'Create account');
  assert.equal(run.state, 'running');
  assert.equal(run.startedAt, 5_000);
  assert.equal(run.endedAt, undefined);
  assert.equal(run.steps.length, 1);
  const first = run.steps[0]!;
  assert.deepEqual(
    { id: first.id, label: first.label, state: first.state, startedAt: first.startedAt },
    { id: 'passkey', label: 'Create and verify the passkey', state: 'running', startedAt: 5_000 },
  );
  assert.equal(first.estimateMs, undefined, 'the passkey stage is indeterminate');
  assert.equal(log.current, run);
  assert.equal(log.last, run);
});

test('a stage with a known duration carries its estimate into the step', () => {
  const { log } = make();
  log.start('create');
  log.stage('prf');
  log.stage('deploy');
  assert.equal(log.last?.steps.at(-1)?.estimateMs, 180_000);
  log.stage('activate');
  assert.equal(log.last?.steps.at(-1)?.estimateMs, 25_000);
});

test('only one run is active at a time, and the next may start once it has ended', () => {
  const { log } = make();
  log.start('open');
  assert.throws(() => log.start('rotate'), /another action is still running/);
  assert.equal(log.runs.length, 1);
  log.finish();
  const next = log.start('rotate');
  assert.equal(log.runs.length, 2);
  assert.equal(log.last, next);
  log.fail(error());
  log.start('wallet');
  assert.equal(log.runs.length, 3);
});

test('a new stage ends the running one as done and starts at the clock', () => {
  const { log, at } = make();
  const run = log.start('create');
  at(2_000);
  log.stage('prf');
  assert.equal(run.steps.length, 2);
  assert.equal(run.steps[0]?.state, 'done');
  assert.equal(run.steps[0]?.endedAt, 2_000);
  assert.equal(run.steps[1]?.id, 'prf');
  assert.equal(run.steps[1]?.startedAt, 2_000);
  assert.equal(run.steps[1]?.state, 'running');
  assert.equal(run.state, 'running');
});

test('asking for the stage already running changes nothing and tells nobody', () => {
  const { log, at } = make();
  const run = log.start('create');
  let changes = 0;
  log.subscribe(() => changes++);
  at(1_000);
  log.stage('passkey');
  assert.equal(run.steps.length, 1);
  assert.equal(run.steps[0]?.endedAt, undefined);
  assert.equal(changes, 0);
});

test('an unknown stage starts an ad-hoc step named after itself, and the run lists it', () => {
  const { log } = make();
  const run = log.start('create');
  log.stage('prf');
  log.stage('some-new-connector-step');
  const step = run.steps.at(-1)!;
  assert.equal(step.id, 'some-new-connector-step');
  assert.equal(step.label, 'some-new-connector-step');
  assert.equal(step.estimateMs, undefined);
  const stages = log.stagesOf(run);
  assert.deepEqual(
    stages.map((s) => s.id),
    ['passkey', 'prf', 'deploy', 'activate', 'read', 'some-new-connector-step'],
  );
  // Entering it twice does not list it twice.
  log.stage('deploy');
  log.stage('some-new-connector-step');
  assert.equal(log.stagesOf(run).filter((s) => s.id === 'some-new-connector-step').length, 1);
});

test('stages can be skipped: the planned list is the flow, the steps are what really ran', () => {
  const { log } = make();
  const run = log.start('create');
  log.stage('deploy');
  assert.deepEqual(
    run.steps.map((s) => s.id),
    ['passkey', 'deploy'],
  );
  assert.equal(log.stagesOf(run).length, 5);
});

test('with no run in progress, stage, note, attach and the two failures do nothing', () => {
  const { log } = make();
  let changes = 0;
  log.subscribe(() => changes++);
  log.stage('x');
  log.note('n');
  log.attach({ a: 1 });
  log.failStep(error());
  log.fail(error());
  log.finish();
  assert.equal(log.runs.length, 0);
  assert.equal(changes, 0);
  // Nor after a run has finished.
  log.start('open');
  log.finish();
  const before = JSON.stringify(log.toJSON());
  changes = 0;
  log.stage('x');
  log.note('late');
  log.attach({ late: true });
  log.failStep(error());
  log.fail(error());
  log.finish();
  assert.equal(JSON.stringify(log.toJSON()), before);
  assert.equal(changes, 0);
});

test('notes and attached data belong to the running step, and later data merges over earlier', () => {
  const { log } = make();
  const run = log.start('create');
  log.note('first');
  log.note('second');
  log.attach({ a: 1, b: 2 });
  log.attach({ b: 3 });
  log.stage('prf');
  log.note('on prf');
  assert.deepEqual(run.steps[0]?.notes, ['first', 'second']);
  assert.deepEqual(run.steps[0]?.data, { a: 1, b: 3 });
  assert.deepEqual(run.steps[1]?.notes, ['on prf']);
  assert.equal(run.steps[1]?.data, undefined);
});

test('a failed step does not end the run: the next stage carries on, and the run can still finish', () => {
  const { log, at } = make();
  const run = log.start('wallet');
  at(1_000);
  log.stage('balances');
  at(4_000);
  log.failStep(error('InternalError'));
  const failed = run.steps.at(-1)!;
  assert.equal(failed.state, 'failed');
  assert.equal(failed.endedAt, 4_000);
  assert.equal(failed.error?.code, 'InternalError');
  assert.equal(run.state, 'running');
  assert.equal(log.current, run, 'the run is still the current one');
  // With no running step, a note or data has nowhere to go.
  log.note('lost');
  log.attach({ lost: true });
  assert.deepEqual(failed.notes, []);
  assert.equal(failed.data, undefined);
  at(5_000);
  log.finish();
  assert.equal(run.state, 'done');
  assert.equal(run.endedAt, 5_000);
  assert.equal(failed.state, 'failed', 'finishing does not turn a failed step into a done one');
});

test('a run that fails records the error on its running step and on the run, and ends at the clock', () => {
  const { log, at } = make();
  const run = log.start('create');
  log.stage('prf');
  log.stage('deploy');
  at(7_000);
  const err = error('SponsorRejected');
  log.fail(err);
  assert.equal(run.state, 'failed');
  assert.equal(run.endedAt, 7_000);
  assert.equal(run.error, err);
  const step = run.steps.at(-1)!;
  assert.deepEqual(
    [step.id, step.state, step.endedAt, step.error],
    ['deploy', 'failed', 7_000, err],
  );
  assert.equal(run.steps.filter((s) => s.state === 'failed').length, 1);
  assert.equal(log.current, undefined);
  assert.equal(log.last, run);
});

test('a failure between stages is recorded as a step of its own, of no duration', () => {
  const { log, at } = make();
  const run = log.start('wallet');
  log.stage('balances');
  at(3_000);
  log.failStep(error('InternalError')); // the step that was running has failed already
  at(3_500);
  log.fail(error('NetworkMismatch'));
  const last = run.steps.at(-1)!;
  assert.equal(last.id, 'error');
  assert.equal(last.label, 'Error');
  assert.equal(last.state, 'failed');
  assert.equal(last.startedAt, 3_500);
  assert.equal(last.endedAt, 3_500);
  assert.equal(last.error?.code, 'NetworkMismatch');
  assert.equal(run.state, 'failed');
  assert.equal(run.error?.code, 'NetworkMismatch');
  assert.equal(
    run.steps.find((s) => s.id === 'balances')?.error?.code,
    'InternalError',
    'the earlier step keeps its own error',
  );
});

test('finishing ends the running step as done and the run at the clock', () => {
  const { log, at } = make();
  const run = log.start('open');
  at(1_500);
  log.stage('read');
  at(2_500);
  log.finish();
  assert.deepEqual(
    run.steps.map((s) => [s.id, s.state, s.startedAt - run.startedAt, s.endedAt! - run.startedAt]),
    [
      ['identify', 'done', 0, 1_500],
      ['read', 'done', 1_500, 2_500],
    ],
  );
  assert.equal(run.state, 'done');
  assert.equal(run.endedAt! - run.startedAt, 2_500);
});

test('every change tells the subscribers once, and nothing else does', () => {
  const { log } = make();
  let changes = 0;
  log.subscribe(() => changes++);
  log.subscribe(() => changes++);
  const steps: [string, () => void][] = [
    ['start', () => log.start('create')],
    ['stage', () => log.stage('prf')],
    ['note', () => log.note('n')],
    ['attach', () => log.attach({ a: 1 })],
    ['failStep', () => log.failStep(error())],
    ['finish', () => log.finish()],
  ];
  for (const [name, run] of steps) {
    changes = 0;
    run();
    assert.equal(changes, 2, `${name}: both subscribers, once each`);
  }
});

test('the evidence rows carry the run, its timing, its error and each step with its timing', () => {
  const { log, at, iso } = make();
  log.start('create');
  at(1_000);
  log.stage('prf');
  log.note('provider returned PRF at creation');
  at(4_000);
  log.stage('deploy');
  log.attach({ address: 'ab'.repeat(32) });
  at(10_000);
  log.fail(error('SponsorRejected'));
  const rows = log.toJSON();
  assert.deepEqual(rows, [
    {
      action: 'create',
      title: 'Create account',
      result: 'failed',
      startedAt: iso(0),
      endedAt: iso(10_000),
      durationMs: 10_000,
      error: error('SponsorRejected'),
      steps: [
        {
          step: 'passkey',
          label: 'Create and verify the passkey',
          result: 'done',
          startedAt: iso(0),
          endedAt: iso(1_000),
          durationMs: 1_000,
        },
        {
          step: 'prf',
          label: 'Derive the encryption key (PRF)',
          result: 'done',
          startedAt: iso(1_000),
          endedAt: iso(4_000),
          durationMs: 3_000,
          notes: ['provider returned PRF at creation'],
        },
        {
          step: 'deploy',
          label: 'Deploy the account (10 waves)',
          result: 'failed',
          startedAt: iso(4_000),
          endedAt: iso(10_000),
          durationMs: 6_000,
          error: error('SponsorRejected'),
          data: { address: 'ab'.repeat(32) },
        },
      ],
    },
  ]);
});

test('a run in progress has a start and no end or duration in the evidence', () => {
  const { log, iso } = make();
  log.start('rotate');
  const [row] = log.toJSON() as Record<string, unknown>[];
  assert.equal(row?.result, 'running');
  assert.equal(row?.startedAt, iso(0));
  assert.equal(row?.endedAt, undefined);
  assert.equal(row?.durationMs, undefined);
  assert.equal('error' in (row ?? {}), false);
  const step = (row?.steps as Record<string, unknown>[])[0]!;
  assert.equal(step.result, 'running');
  assert.equal(step.endedAt, undefined);
  assert.equal(step.durationMs, undefined);
  assert.equal('notes' in step, false, 'no empty notes list');
  assert.equal('data' in step, false);
});

test('the evidence holds a row per run, newest last, and a copy of each error', () => {
  const { log } = make();
  log.start('open');
  log.fail(error('AccountNotFound'));
  log.start('open');
  log.finish();
  const rows = log.toJSON() as { result: string; error?: PlainError }[];
  assert.deepEqual(
    rows.map((r) => r.result),
    ['failed', 'done'],
  );
  // The rows are a snapshot: editing one does not reach the log.
  (rows[0]!.error as { message: string }).message = 'tampered';
  assert.equal(log.runs[0]?.error?.message, 'AccountNotFound happened');
  assert.equal(
    (log.toJSON() as { error?: PlainError }[])[0]?.error?.message,
    'AccountNotFound happened',
  );
});

test('the evidence rows have exactly the documented members, so a new field cannot leak in unseen', () => {
  const { log } = make();
  log.start('create');
  log.note('n');
  log.attach({ a: 1 });
  log.fail(error());
  const [row] = log.toJSON() as Record<string, unknown>[];
  assert.deepEqual(Object.keys(row ?? {}).sort(), [
    'action',
    'durationMs',
    'endedAt',
    'error',
    'result',
    'startedAt',
    'steps',
    'title',
  ]);
  const step = (row?.steps as Record<string, unknown>[])[0]!;
  assert.deepEqual(Object.keys(step).sort(), [
    'data',
    'durationMs',
    'endedAt',
    'error',
    'label',
    'notes',
    'result',
    'startedAt',
    'step',
  ]);
});

test('the evidence carries only what the flow attached: public values in, nothing implied', () => {
  const { log } = make();
  log.start('create');
  log.attach({ created: { address: 'ab'.repeat(32), binding: 'acc-45721e1' } });
  log.finish();
  const text = JSON.stringify(log.toJSON());
  assert.ok(text.includes('ab'.repeat(32)));
  for (const secret of [/seed/i, /secret/i, /private/i, /credentialId/]) {
    assert.doesNotMatch(text, secret);
  }
});

/** A connector event of one flow, stamped at `at`. */
const ev = (
  step: PassportEvent['step'],
  phase: PassportEvent['phase'],
  at: number,
  extra: Partial<PassportEvent> = {},
): PassportEvent => ({
  id: `${step}-1`,
  flowId: 'f',
  step,
  phase,
  at,
  clock: 'client',
  ...(phase !== 'start' && { durationMs: 1_500 }),
  ...extra,
});

test("connector events start their stages at the events' own time, and note every other step", () => {
  const { log, at } = make();
  const run = log.start('create');
  at(9_000); // the page's clock runs on; the stages take the connector's times
  log.event(ev('passkey.create', 'start', 10));
  log.event(ev('passkey.create', 'end', 1_510));
  log.event(ev('passkey.prf', 'start', 2_000));
  log.event(ev('passkey.prf', 'end', 3_500));
  log.event(ev('deploy', 'start', 4_000));
  log.event(ev('deploy', 'end', 5_500));
  log.event(ev('directory.write', 'start', 5_600));
  log.event(ev('directory.write', 'end', 7_100));
  log.event(ev('activate', 'start', 7_200));
  assert.deepEqual(
    run.steps.map((s) => [s.id, s.startedAt, s.endedAt, s.notes]),
    [
      ['passkey', 0, 2_000, ['passkey.create 1.5 s']],
      ['prf', 2_000, 4_000, ['passkey.prf 1.5 s']],
      ['deploy', 4_000, 7_200, ['deploy 1.5 s', 'directory.write 1.5 s']],
      ['activate', 7_200, undefined, []],
    ],
  );
  log.event(ev('prove', 'error', 8_000, { error: { code: 'ProverUnavailable', message: 'busy' } }));
  assert.deepEqual(run.steps.at(-1)?.notes, ['prove failed']);
  assert.equal(run.events.length, 10);
});

test('the evidence keeps the connector events of a run, and none for a run without them', () => {
  const { log, iso } = make();
  log.start('rotate');
  log.event(ev('passkey.sign', 'start', 100));
  log.event(
    ev('passkey.sign', 'error', 200, {
      durationMs: 100,
      error: { code: 'UserCancelled', message: 'closed' },
    }),
  );
  log.fail(error('UserCancelled'));
  log.start('open');
  log.finish();
  const [rotate, open] = log.toJSON() as Record<string, unknown>[];
  assert.deepEqual(rotate?.events, [
    { step: 'passkey.sign', phase: 'start', at: iso(100) },
    {
      step: 'passkey.sign',
      phase: 'error',
      at: iso(200),
      durationMs: 100,
      error: { code: 'UserCancelled', message: 'closed' },
    },
  ]);
  assert.equal('events' in (open ?? {}), false);
  // Events outside a run are dropped.
  log.event(ev('chain.read', 'start', 300));
  assert.equal(log.runs.at(-1)?.events.length, 0);
});
