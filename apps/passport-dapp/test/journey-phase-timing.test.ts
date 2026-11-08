import assert from 'node:assert/strict';
import { test } from 'node:test';
import { journeyTiming } from '../e2e/journey-timing.js';
import { groupTiming, measureJourneyPhase } from '../e2e/journeys/phase-timing.js';
function clockFixture() {
  let time = 1000;
  const timing = journeyTiming(() => time);
  return {
    timing,
    at(value: number) {
      time = 1000 + value;
    },
  };
}
test('phase boundaries and checkpoint completion share one origin, retaining first-checkpoint setup time', async () => {
  const { timing, at } = clockFixture();
  at(10);
  timing.finishSetup();
  at(20);
  timing.beginArm('p256');
  const value = groupTiming('scoped-sessions');
  at(30);
  await measureJourneyPhase(value, 'bootstrap', timing.boundary, async () => {
    at(40);
  });
  at(50);
  const result = await measureJourneyPhase(value, 'body', timing.boundary, async () => {
    at(60);
    timing.checkpoint('first');
    at(70);
    timing.checkpoint('last');
    at(80);
    return 42;
  });
  assert.equal(result, 42);
  assert.deepEqual(value.bootstrap, { startMs: 30, endMs: 40, elapsedMs: 10 });
  assert.deepEqual(value.body, { startMs: 50, endMs: 80, elapsedMs: 30 });
  assert.equal(value.elapsedMs, 40);
  assert.equal(value.bootstrapComplete, true);
  assert.equal(value.complete, true);
  at(90);
  timing.beginArmCleanup();
  at(100);
  timing.endArm(true);
  at(110);
  timing.beginCleanup();
  at(120);
  timing.finishCleanup();
  assert.deepEqual(timing.snapshot().arms[0]?.checkpoints, [
    { name: 'first', startMs: 20, endMs: 60, elapsedMs: 40 },
    { name: 'last', startMs: 60, endMs: 70, elapsedMs: 10 },
  ]);
});
test('failed work retains its original rejection and an explicitly unfinished phase', async () => {
  const { timing, at } = clockFixture();
  timing.finishSetup();
  timing.beginArm('jubjub');
  const value = groupTiming('owner-safety'),
    failure = Error('deliberate work failure');
  at(1);
  await measureJourneyPhase(value, 'bootstrap', timing.boundary, async () => {
    at(2);
  });
  at(3);
  await assert.rejects(
    measureJourneyPhase(value, 'body', timing.boundary, async () => {
      at(4);
      throw failure;
    }),
    (error) => error === failure,
  );
  assert.deepEqual(value.body, { startMs: 3, endMs: null, elapsedMs: null });
  assert.equal(value.complete, false);
  assert.equal(value.bootstrapComplete, true);
  assert.equal(value.bodyMs, null);
  assert.equal(value.bootstrapMs, 1);
  assert.equal(value.elapsedMs, null);
});
test('shared boundary refuses inactive arms and a retreating clock without completing the phase', async () => {
  const { timing, at } = clockFixture();
  assert.throws(timing.boundary, /No active/);
  timing.finishSetup();
  assert.throws(timing.boundary, /No active/);
  timing.beginArm('p256');
  const value = groupTiming('presentation');
  at(2);
  await assert.rejects(
    measureJourneyPhase(value, 'body', timing.boundary, async () => {
      at(1);
    }),
    /Non-monotonic/,
  );
  assert.equal(value.body?.endMs, null);
  assert.equal(value.complete, false);
  at(3);
  timing.beginArmCleanup();
  assert.throws(timing.boundary, /No active/);
  at(4);
  timing.endArm(false);
  assert.throws(timing.boundary, /No active/);
});
