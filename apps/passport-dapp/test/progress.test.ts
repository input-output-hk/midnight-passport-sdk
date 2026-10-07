// The progress bar's arithmetic (src/progress.ts) on runs recorded against a fixed clock: the
// create stages, the deployment's 3-minute estimate, the cap before a stage really ends, the
// "taking longer than usual" label, indeterminate stages, and the finished and failed bars.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventLog } from '../src/event-log.ts';
import { FLOWS, type ActionId } from '../src/flows.ts';
import { RUNNING_FILL_CAP, progressView, segmentGrow } from '../src/progress.ts';

/** A log on a settable clock, and the view of its latest run at `at`. */
function setup() {
  let t = 0;
  const log = new EventLog(() => t);
  return {
    log,
    clock: (ms: number) => {
      t = ms;
    },
    view(now: number) {
      const run = log.last!;
      return progressView(run, log.stagesOf(run), now);
    },
  };
}

/** Starts `action` and moves to `stage` at the given time. */
function runAt(action: ActionId, stage: string, ms: number) {
  const s = setup();
  s.log.start(action);
  s.clock(0);
  if (stage !== FLOWS[action].stages[0]!.id) {
    // Walk through the stages in between so they read as done.
    for (const def of FLOWS[action].stages) {
      s.log.stage(def.id);
      if (def.id === stage) break;
    }
  }
  s.clock(ms);
  return s;
}

const states = (v: ReturnType<ReturnType<typeof setup>['view']>) => v.segments.map((x) => x.state);
const widths = (v: ReturnType<ReturnType<typeof setup>['view']>) => v.segments.map((x) => x.width);

test('a create that has just started: the first stage is indeterminate, the rest pending', () => {
  const s = setup();
  s.log.start('create');
  const v = s.view(0);
  assert.deepEqual(states(v), ['indeterminate', 'pending', 'pending', 'pending', 'pending']);
  assert.deepEqual(widths(v), [100, 0, 0, 0, 0]);
  assert.equal(v.label, 'Step 1 of 5: Create and verify the passkey');
  assert.equal(v.elapsedMs, 0);
});

test('stages already left read as done and full, and the stage in progress as indeterminate', () => {
  const s = runAt('create', 'prf', 5_000);
  const v = s.view(5_000);
  assert.deepEqual(states(v), ['done', 'indeterminate', 'pending', 'pending', 'pending']);
  assert.deepEqual(widths(v), [100, 100, 0, 0, 0]);
  assert.equal(v.label, 'Step 2 of 5: Derive the encryption key (PRF)');
});

test('the deployment fills against its 3-minute estimate and names the elapsed and expected time', () => {
  const s = setup();
  s.log.start('create');
  s.log.stage('prf');
  s.clock(10_000);
  s.log.stage('deploy'); // starts at t = 10 s
  const at = (afterMs: number) => s.view(10_000 + afterMs);
  let v = at(0);
  assert.equal(v.segments[2]?.state, 'running');
  assert.equal(v.segments[2]?.width, 0);
  assert.equal(v.label, 'Step 3 of 5: Deploy the account (10 waves) · 0:00 of about 3:00');
  v = at(90_000);
  assert.equal(v.segments[2]?.width, 50);
  assert.equal(v.label, 'Step 3 of 5: Deploy the account (10 waves) · 1:30 of about 3:00');
  v = at(45_000);
  assert.equal(v.segments[2]?.width, 25);
  assert.deepEqual(states(v).slice(0, 2), ['done', 'done']);
});

test('a running stage never reads full: it stops at 97 percent, with the estimate passed or not', () => {
  assert.equal(RUNNING_FILL_CAP, 97);
  const s = setup();
  s.log.start('create');
  s.log.stage('deploy');
  const run = s.log.last!;
  const stages = s.log.stagesOf(run);
  const width = (ms: number) => progressView(run, stages, ms).segments[2]?.width;
  assert.equal(width(174_599), (174_599 / 180_000) * 100); // just under the cap
  assert.equal(width(180_000), 97, 'at the estimate: capped');
  assert.equal(width(10 * 180_000), 97, 'long after it: still capped');
  assert.equal(progressView(run, stages, 180_000).segments[2]?.state, 'running');
});

test('the label says so once the estimate is passed, and not before', () => {
  const s = setup();
  s.log.start('create');
  s.log.stage('deploy');
  const run = s.log.last!;
  const stages = s.log.stagesOf(run);
  const label = (ms: number) => progressView(run, stages, ms).label;
  assert.doesNotMatch(label(180_000), /taking longer/, 'exactly the estimate is still on time');
  assert.match(label(180_001), /\(taking longer than usual\)$/);
  assert.equal(
    label(200_000),
    'Step 3 of 5: Deploy the account (10 waves) · 3:20 of about 3:00 (taking longer than usual)',
  );
});

test('the activation fills against 25 seconds and the rotation against 60', () => {
  const activate = runAt('create', 'activate', 12_500).view(12_500);
  assert.equal(activate.segments[3]?.width, 50);
  assert.equal(activate.label, 'Step 4 of 5: Activate the first device · 0:12 of about 0:25');
  const rotate = runAt('rotate', 'prove', 30_000).view(30_000);
  assert.deepEqual(widths(rotate).slice(0, 1), [50]);
  assert.equal(
    rotate.label,
    'Step 1 of 2: Sign with the passkey, prove and submit · 0:30 of about 1:00',
  );
  assert.equal(rotate.segments[1]?.state, 'pending');
});

test('open and wallet have no estimate, so each running stage is indeterminate and full', () => {
  for (const action of ['open', 'wallet'] as const) {
    for (const def of FLOWS[action].stages) {
      const v = runAt(action, def.id, 1_000).view(1_000);
      const index = FLOWS[action].stages.findIndex((x) => x.id === def.id);
      assert.equal(v.segments[index]?.state, 'indeterminate', `${action}/${def.id}`);
      assert.equal(v.segments[index]?.width, 100);
      assert.equal(v.label, `Step ${index + 1} of ${v.segments.length}: ${def.label}`);
    }
  }
});

test('the segments of a stage with an estimate are wider, in proportion to that estimate', () => {
  const [passkey, prf, deploy, activate, read] = FLOWS.create.stages.map(segmentGrow);
  assert.deepEqual([passkey, prf, read], [1, 1, 1], 'no estimate: the base width');
  assert.equal(deploy, 9, '180 s in 20 s units');
  assert.equal(activate, 1.25);
  assert.equal(segmentGrow(FLOWS.rotate.stages[0]!), 3);
  assert.equal(
    segmentGrow({ id: 'tiny', label: 't', estimateMs: 1_000 }),
    1,
    'never below the base',
  );
  const total = FLOWS.create.stages.map(segmentGrow).reduce((a, b) => a + b, 0);
  assert.equal(total, 13.25);
});

test('a finished run is full everywhere and says how long it took, from its own end, not from now', () => {
  const s = setup();
  s.log.start('create');
  s.clock(1_000);
  s.log.stage('prf');
  s.clock(2_000);
  s.log.stage('deploy');
  s.clock(190_000);
  s.log.stage('activate');
  s.clock(210_000);
  s.log.stage('read');
  s.clock(200_000 + 20_400);
  s.log.finish();
  const early = s.view(220_400);
  const late = s.view(9_999_999);
  assert.deepEqual(late, early, 'now no longer matters');
  assert.deepEqual(states(late), ['done', 'done', 'done', 'done', 'done']);
  assert.deepEqual(widths(late), [100, 100, 100, 100, 100]);
  assert.equal(late.label, 'Create account finished in 3 min 40 s.');
  assert.equal(late.elapsedMs, 220_400);
});

test('a failed run marks the failed stage full, leaves later stages pending and names the stage', () => {
  const s = setup();
  s.log.start('create');
  s.log.stage('prf');
  s.log.stage('deploy');
  s.clock(60_000);
  s.log.fail({ code: 'SponsorRejected', message: 'm', hint: 'h' });
  const v = s.view(70_000);
  assert.deepEqual(states(v), ['done', 'done', 'failed', 'pending', 'pending']);
  assert.deepEqual(widths(v), [100, 100, 100, 0, 0]);
  assert.equal(v.label, 'Create account failed at “Deploy the account (10 waves)”.');
  assert.equal(v.elapsedMs, 60_000);
});

test('a failure between stages adds an ad-hoc "Error" segment, and the label names the first failed step', () => {
  const s = setup();
  s.log.start('wallet');
  s.log.stage('balances');
  s.log.failStep({ code: 'InternalError', message: 'm', hint: 'h' });
  s.log.fail({ code: 'NetworkMismatch', message: 'm2', hint: 'h2' });
  const v = s.view(1);
  assert.equal(v.segments.length, 5, 'four planned stages and the Error step');
  assert.deepEqual(states(v), ['done', 'pending', 'pending', 'failed', 'failed']);
  assert.equal(v.label, 'Connect built-in wallet failed at “Wait for sync and read balances”.');
});

test('a step that failed while the run goes on is full and red, and names no running stage', () => {
  const s = setup();
  s.log.start('wallet');
  s.log.stage('balances');
  s.clock(2_000);
  s.log.failStep({ code: 'InternalError', message: 'timed out', hint: 'h' });
  const v = s.view(5_000);
  assert.equal(v.segments[3]?.state, 'failed');
  assert.equal(v.segments[3]?.width, 100);
  assert.equal(v.label, '', 'nothing is running, and the run has not ended');
  assert.equal(v.elapsedMs, 5_000);
});

test('an unlisted connector step gets its own indeterminate segment and a step number past the plan', () => {
  const s = setup();
  s.log.start('create');
  s.log.stage('prf');
  s.log.stage('brand-new-step');
  const v = s.view(0);
  assert.equal(v.segments.length, 6);
  assert.equal(v.segments[5]?.state, 'indeterminate');
  assert.equal(v.label, 'Step 6 of 6: brand-new-step');
});

test('while a run is going the elapsed time follows the clock handed in', () => {
  const s = setup();
  s.clock(1_000);
  s.log.start('open');
  assert.equal(s.view(1_000).elapsedMs, 0);
  assert.equal(s.view(66_000).elapsedMs, 65_000);
});
