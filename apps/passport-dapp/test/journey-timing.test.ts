import assert from 'node:assert/strict';
import { test } from 'node:test';
import { journeyTiming } from '../e2e/journey-timing.ts';

test('receipt intervals partition setup, checkpoint work, validation tail and cleanup', () => {
  let time = 100;
  const timing = journeyTiming(() => time);
  time = 110;
  timing.finishSetup();
  timing.beginArm('p256');
  timing.created('context');
  timing.created('page');
  timing.created('page');
  time = 125;
  timing.checkpoint('create and approve');
  time = 129;
  timing.checkpoint('login');
  time = 135;
  timing.beginArmCleanup();
  time = 140;
  timing.endArm(true);
  timing.beginArm('jubjub');
  time = 147;
  timing.checkpoint('open');
  timing.beginArmCleanup();
  time = 149;
  timing.endArm(true);
  timing.beginCleanup();
  time = 155;
  timing.finishCleanup();
  time = 200; // Receipt writing is outside the recorded resource lifecycle.
  const report = timing.snapshot();
  assert.equal(report.totalMs, 55);
  assert.equal(report.setup.elapsedMs, 10);
  assert.equal(report.cleanup?.elapsedMs, 6);
  assert.deepEqual(
    report.arms.map((arm) => arm.elapsedMs),
    [30, 9],
  );
  const first = report.arms[0];
  assert.ok(first);
  assert.deepEqual(
    first.checkpoints.map((point) => point.elapsedMs),
    [15, 4],
  );
  assert.equal(first.afterLastCheckpointMs, 6);
  assert.equal(first.cleanup?.elapsedMs, 5);
  assert.equal(first.contextsCreated, 1);
  assert.equal(first.pagesCreated, 2);
  assert.equal(first.bodyComplete, true);
  assert.equal(
    first.checkpoints.reduce((sum, point) => sum + point.elapsedMs, 0) +
      first.afterLastCheckpointMs +
      (first.cleanup?.elapsedMs ?? 0),
    first.elapsedMs,
  );
  assert.match(report.checkpointMeaning, /not isolated test duration/);
});

test('failed setup or journey retains finite partial evidence without inventing a checkpoint', () => {
  let time = 0;
  const failedSetup = journeyTiming(() => time);
  time = 7;
  failedSetup.beginCleanup();
  time = 10;
  failedSetup.finishCleanup();
  assert.deepEqual(failedSetup.snapshot().setup, {
    startMs: 0,
    endMs: 7,
    elapsedMs: 7,
    complete: false,
  });
  assert.deepEqual(failedSetup.snapshot().arms, []);

  const failedArm = journeyTiming(() => time);
  failedArm.finishSetup();
  failedArm.beginArm('p256');
  time = 12.5;
  const partial = failedArm.snapshot().arms[0];
  assert.ok(partial);
  assert.equal(partial.endMs, null);
  assert.equal(partial.elapsedMs, 2.5);
  assert.equal(partial.afterLastCheckpointMs, 2.5);
  failedArm.beginArmCleanup();
  time = 14;
  failedArm.endArm(false);
  failedArm.beginCleanup();
  failedArm.finishCleanup();
  const arm = failedArm.snapshot().arms[0];
  assert.ok(arm);
  assert.equal(arm.bodyComplete, false);
  assert.deepEqual(arm.checkpoints, []);
  assert.equal(arm.elapsedMs, 4);
  assert.equal(arm.cleanup?.elapsedMs, 1.5);
});

test('closed timing lifecycle rejects later events and snapshots do not expose mutable state', () => {
  const timing = journeyTiming(() => 50);
  assert.throws(() => timing.beginArm('p256'), /Cannot begin/);
  timing.finishSetup();
  timing.beginArm('p256');
  assert.throws(() => timing.beginArm('jubjub'), /Cannot begin/);
  timing.checkpoint('first');
  const report = timing.snapshot();
  const arm = report.arms[0];
  assert.ok(arm);
  arm.checkpoints.length = 0;
  assert.equal(timing.snapshot().arms[0]?.checkpoints.length, 1);
  timing.beginArmCleanup();
  assert.throws(() => timing.created('page'), /No active/);
  assert.throws(() => timing.checkpoint('after body'), /No active/);
  timing.endArm(false);
  timing.beginCleanup();
  timing.finishCleanup();
  assert.throws(() => timing.finishCleanup(), /No active/);
  assert.throws(() => timing.beginArm('jubjub'), /Cannot begin/);
  assert.throws(() => timing.beginCleanup(), /Cannot begin/);
});

test('invalid or retreating clock cannot produce negative or nonfinite receipt intervals', () => {
  for (const initial of [NaN, Infinity, -1])
    assert.throws(() => journeyTiming(() => initial), /Invalid timing clock/);
  for (const next of [NaN, Infinity, 9]) {
    let time = 10;
    const timing = journeyTiming(() => time);
    time = next;
    assert.throws(() => timing.finishSetup(), /Non-monotonic/);
  }
});
