import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  journeyCells,
  journeyInventorySha256,
  journeyPurposes,
  aggregateJourneyReceipts,
  readJourneyCells,
} from '../scripts/qualification/demo-journey-receipts.mjs';
import { expectedCases, bootstrapPlans } from '../apps/passport-dapp/e2e/journeys/catalog.mjs';
const source = '44'.repeat(20);
/** Synthetic receipt validation only: these fixtures never qualify browser execution.
 * @param {{arm:string,group:import('../apps/passport-dapp/e2e/journeys/catalog.mjs').JourneyGroup}} cell */
function cellReceipt({ arm, group }) {
  const cases = expectedCases(arm, group).map(({ id, name }) => ({ arm, group, id, name }));
  const n = cases.length,
    bootstrapMs = group === 'presentation' ? 0 : 2;
  return {
    schemaVersion: 1,
    outcome: 'passed',
    tier: 'browser-ui-synthetic-connector',
    sourceCommit: source,
    dirty: false,
    binding: 'acc-s3r1.1',
    manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
    nativeProofs: false,
    realProvider: false,
    resourcesClosed: true,
    cleanup: { browser: 'closed', server: 'closed', ownedCache: 'closed' },
    selectedArms: [arm],
    selectedGroups: [group],
    caseInventorySha256: journeyInventorySha256,
    runtimeSha256: 'ab'.repeat(32),
    nodeVersion: 'v22',
    browserVersion: 'synthetic-boundary',
    credentialFailureCodes: [],
    failures: [],
    pageErrors: [],
    caseAttestations: cases,
    cases: cases.map(({ arm, name }) => ({ arm, name })),
    ceremonyPurposesByArm: { [arm]: group === 'presentation' ? [] : journeyPurposes(arm) },
    groupTimings: {
      [arm]: [
        {
          group,
          complete: true,
          elapsedMs: n + bootstrapMs,
          bodyMs: n,
          body: { startMs: 1 + bootstrapMs, endMs: n + bootstrapMs + 1, elapsedMs: n },
          bootstrap:
            group === 'presentation'
              ? null
              : { startMs: 1, endMs: 1 + bootstrapMs, elapsedMs: bootstrapMs },
          bootstrapComplete: true,
          bootstrapMs,
          bootstrapActions: bootstrapPlans[group],
        },
      ],
    },
    timings: {
      clock: 'monotonic performance.now',
      totalMs: n + bootstrapMs + 3,
      setup: { startMs: 0, endMs: 1, elapsedMs: 1, complete: true },
      arms: [
        {
          arm,
          startMs: 1,
          endMs: n + bootstrapMs + 2,
          elapsedMs: n + bootstrapMs + 1,
          bodyComplete: true,
          contextsCreated: 1,
          pagesCreated: 1,
          afterLastCheckpointMs: 0,
          cleanup: { startMs: n + bootstrapMs + 1, endMs: n + bootstrapMs + 2, elapsedMs: 1 },
          checkpoints: cases.map((c, i) => ({
            name: c.name,
            startMs: i === 0 ? 1 : i + bootstrapMs + 1,
            endMs: i + bootstrapMs + 2,
            elapsedMs: i === 0 ? bootstrapMs + 1 : 1,
          })),
        },
      ],
      cleanup: { startMs: n + bootstrapMs + 2, endMs: n + bootstrapMs + 3, elapsedMs: 1 },
    },
  };
}
const receipts = () => journeyCells.map(cellReceipt);
test('eight independently labeled cells aggregate in canonical97/95 case order', () => {
  const result = aggregateJourneyReceipts(receipts().reverse(), source);
  assert.deepEqual(result.counts, { p256: 97, jubjub: 95 });
  assert.equal(result.cases, 192);
  assert.equal(result.cells, 8);
  assert.equal(result.realProvider, false);
  assert.equal(result.nativeProofs, false);
});
test('missing or duplicate cell cannot pass by matching total case count', () => {
  assert.throws(() => aggregateJourneyReceipts(receipts().slice(1), source));
  const duplicate = receipts();
  duplicate[7] = cellReceipt(journeyCells[0] ?? { arm: 'p256', group: 'presentation' });
  assert.throws(() => aggregateJourneyReceipts(duplicate, source));
});
for (const defect of ['missing', 'duplicate', 'foreign', 'name', 'order', 'legacy'])
  test(`canonical ${defect} case evidence refuses`, () => {
    const values = receipts(),
      value = values[0];
    assert.ok(value);
    const [first, second] = value.caseAttestations;
    assert.ok(first && second);
    if (defect === 'missing') value.caseAttestations.pop();
    if (defect === 'duplicate') value.caseAttestations[1] = { ...first };
    if (defect === 'foreign') Object.assign(first, { id: 'foreign-case' });
    if (defect === 'name') first.name = 'Different assertion';
    if (defect === 'order') {
      value.caseAttestations[0] = second;
      value.caseAttestations[1] = first;
    }
    if (defect === 'legacy') value.cases.reverse();
    assert.throws(() => aggregateJourneyReceipts(values, source));
  });
for (const defect of /** @type {const} */ ([
  'source',
  'runtime',
  'catalog',
  'node',
  'browser',
  'dirty',
]))
  test(`stale or mismatched ${defect} scope refuses`, () => {
    const values = receipts(),
      value = values[0];
    assert.ok(value);
    const updates = {
      source: { sourceCommit: '55'.repeat(20) },
      runtime: { runtimeSha256: 'cd'.repeat(32) },
      catalog: { caseInventorySha256: 'ef'.repeat(32) },
      node: { nodeVersion: 'v24' },
      browser: { browserVersion: 'other' },
      dirty: { dirty: true },
    };
    Object.assign(value, updates[defect]);
    assert.throws(() => aggregateJourneyReceipts(values, source));
  });
for (const defect of [
  'failed',
  'provider',
  'native',
  'resources',
  'handle',
  'observer',
  'page',
  'network',
  'body',
  'bootstrap',
  'clock',
])
  test(`partial ${defect} result cannot pass fromcase acknowledgements`, () => {
    const values = receipts(),
      value = values[0];
    assert.ok(value);
    if (defect === 'failed') value.outcome = 'failed';
    if (defect === 'provider') value.realProvider = true;
    if (defect === 'native') value.nativeProofs = true;
    if (defect === 'resources') value.resourcesClosed = false;
    if (defect === 'handle') value.cleanup.server = 'failed';
    if (defect === 'observer') Object.assign(value, { credentialFailureCodes: ['UserCancelled'] });
    if (defect === 'page') Object.assign(value, { pageErrors: ['unexpected'] });
    if (defect === 'network') Object.assign(value, { failures: ['unhandled-network'] });
    if (defect === 'body') Object.assign(value.timings.arms[0] ?? {}, { bodyComplete: false });
    if (defect === 'bootstrap')
      Object.assign(value.groupTimings[value.selectedArms[0] ?? '']?.[0] ?? {}, {
        bootstrapActions: ['create'],
      });
    if (defect === 'clock') value.timings.totalMs = NaN;
    assert.throws(() => aggregateJourneyReceipts(values, source));
  });
test('timing validation permits measured inter-phase gaps and a nonzero checkpoint tail', () => {
  const values = receipts(),
    value = values[0];
  assert.ok(value);
  const arm = value.timings.arms[0];
  assert.ok(arm);
  const phase = value.groupTimings.p256?.[0];
  assert.ok(phase);
  phase.body.startMs++;
  phase.body.endMs++;
  if (phase.bootstrap) {
    phase.bootstrap.startMs++;
    phase.bootstrap.endMs++;
  }
  arm.startMs++;
  for (const point of arm.checkpoints) {
    point.startMs++;
    point.endMs++;
  }
  arm.cleanup.startMs += 2;
  arm.cleanup.endMs += 2;
  arm.endMs += 2;
  arm.elapsedMs++;
  arm.afterLastCheckpointMs = 1;
  value.timings.cleanup.startMs += 3;
  value.timings.cleanup.endMs += 3;
  value.timings.totalMs += 3;
  assert.equal(aggregateJourneyReceipts(values, source).cases, 192);
});
for (const defect of [
  'total',
  'cleanup-order',
  'checkpoint-outside',
  'checkpoint-gap',
  'group-sum',
  'group-duration',
  'negative-tail',
  'tail-accounting',
  'arm-cleanup-end',
  'setup-origin',
])
  test(`contradictory ${defect} timing cannot qualify case acknowledgements`, () => {
    const values = receipts(),
      value = values[0];
    assert.ok(value);
    const arm = value.timings.arms[0],
      phase = value.groupTimings.p256?.[0];
    assert.ok(arm && phase);
    const point = arm.checkpoints[0];
    assert.ok(point);
    if (defect === 'total') value.timings.totalMs = 0;
    if (defect === 'cleanup-order') value.timings.cleanup = { startMs: 0, endMs: 1, elapsedMs: 1 };
    if (defect === 'checkpoint-outside') {
      point.startMs = 1e8;
      point.endMs = 1e8 + 1;
    }
    if (defect === 'checkpoint-gap') {
      point.startMs += 0.5;
      point.elapsedMs -= 0.5;
    }
    if (defect === 'group-sum') phase.elapsedMs = 0;
    if (defect === 'group-duration') {
      phase.bodyMs = 1e8;
      phase.elapsedMs = 1e8;
    }
    if (defect === 'negative-tail') arm.afterLastCheckpointMs = -1;
    if (defect === 'tail-accounting') arm.afterLastCheckpointMs = 1;
    if (defect === 'arm-cleanup-end') {
      arm.cleanup.endMs++;
      arm.cleanup.elapsedMs++;
    }
    if (defect === 'setup-origin') {
      value.timings.setup.startMs++;
      value.timings.setup.endMs++;
    }
    assert.throws(() => aggregateJourneyReceipts(values, source));
  });
for (const defect of [
  'zero-summary',
  'zero-body',
  'first-before-body',
  'last-after-body',
  'missing-body',
  'unfinished-body',
])
  test(`case completion is bound to its ${defect} body interval`, () => {
    const values = receipts(),
      value = values[0];
    assert.ok(value);
    const phase = value.groupTimings.p256?.[0],
      arm = value.timings.arms[0];
    assert.ok(phase && arm);
    const first = arm.checkpoints[0],
      last = arm.checkpoints.at(-1);
    assert.ok(first && last);
    if (defect === 'zero-summary') {
      phase.bodyMs = 0;
      phase.elapsedMs = 0;
    }
    if (defect === 'zero-body') {
      phase.body.startMs = phase.body.endMs;
      phase.body.elapsedMs = 0;
      phase.bodyMs = 0;
      phase.elapsedMs = 0;
    }
    if (defect === 'first-before-body') {
      phase.body.startMs = first.endMs + 0.5;
      phase.body.elapsedMs = phase.body.endMs - phase.body.startMs;
      phase.bodyMs = phase.body.elapsedMs;
      phase.elapsedMs = phase.bodyMs;
    }
    if (defect === 'last-after-body') {
      phase.body.endMs = last.endMs - 0.5;
      phase.body.elapsedMs = phase.body.endMs - phase.body.startMs;
      phase.bodyMs = phase.body.elapsedMs;
      phase.elapsedMs = phase.bodyMs;
    }
    if (defect === 'missing-body') Reflect.deleteProperty(phase, 'body');
    if (defect === 'unfinished-body') Object.assign(phase.body, { endMs: null, elapsedMs: null });
    assert.throws(() => aggregateJourneyReceipts(values, source));
  });
for (const defect of [
  'before-bootstrap',
  'bootstrap-after-body',
  'bootstrap-outside-arm',
  'missing-bootstrap',
])
  test(`case and bootstrap boundaries refuse ${defect}`, () => {
    const values = receipts(),
      value = values[1];
    assert.ok(value);
    const phase = value.groupTimings.p256?.[0],
      arm = value.timings.arms[0];
    assert.ok(phase && phase.bootstrap && arm);
    const first = arm.checkpoints[0];
    assert.ok(first);
    if (defect === 'before-bootstrap') {
      phase.bootstrap.endMs = first.endMs + 0.5;
      phase.bootstrap.elapsedMs = phase.bootstrap.endMs - phase.bootstrap.startMs;
      phase.bootstrapMs = phase.bootstrap.elapsedMs;
      phase.body.startMs = phase.bootstrap.endMs;
      phase.body.elapsedMs = phase.body.endMs - phase.body.startMs;
      phase.bodyMs = phase.body.elapsedMs;
      phase.elapsedMs = phase.bodyMs + phase.bootstrapMs;
    }
    if (defect === 'bootstrap-after-body') {
      phase.bootstrap.endMs = phase.body.startMs + 0.5;
      phase.bootstrap.elapsedMs += 0.5;
      phase.bootstrapMs += 0.5;
      phase.elapsedMs += 0.5;
    }
    if (defect === 'bootstrap-outside-arm') {
      phase.bootstrap.startMs--;
      phase.bootstrap.elapsedMs++;
      phase.bootstrapMs++;
      phase.elapsedMs++;
    }
    if (defect === 'missing-bootstrap') phase.bootstrap = null;
    assert.throws(() => aggregateJourneyReceipts(values, source));
  });
test('dirty local evaluation needs explicit opt-in and still binds every runtime', () => {
  const values = receipts();
  for (const value of values) value.dirty = true;
  assert.throws(() => aggregateJourneyReceipts(values, source));
  assert.equal(aggregateJourneyReceipts(values, source, { allowDirty: true }).dirty, true);
});
test('artifact reader admits exactly eight regular single-file directories and refuses substitutions', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'passport-journey-receipts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const cell of journeyCells) {
    const folder = join(root, cell.artifact);
    mkdirSync(folder);
    writeFileSync(join(folder, 'demo-journeys.json'), JSON.stringify(cellReceipt(cell)));
  }
  assert.equal(aggregateJourneyReceipts(readJourneyCells(root), source).cases, 192);
  const first = journeyCells[0];
  assert.ok(first);
  const folder = join(root, first.artifact),
    file = join(folder, 'demo-journeys.json');
  rmSync(file);
  symlinkSync(join(root, journeyCells[1]?.artifact ?? 'missing', 'demo-journeys.json'), file);
  assert.throws(() => readJourneyCells(root));
  rmSync(file);
  writeFileSync(file, ' '.repeat(1024 * 1024 + 1));
  assert.throws(() => readJourneyCells(root));
});

for (const cell of journeyCells)
  test(`nonempty ${cell.arm}/${cell.group} cannot compress all case completions into a zero-width body`, () => {
    const values = receipts();
    assert.equal(aggregateJourneyReceipts(values, source).cases, 192);
    const value = values.find(
      (item) => item.selectedArms[0] === cell.arm && item.selectedGroups[0] === cell.group,
    );
    assert.ok(value);
    const phase = value.groupTimings[cell.arm]?.[0],
      arm = value.timings.arms[0];
    assert.ok(phase && arm);
    const at = arm.cleanup.startMs;
    for (const [index, point] of arm.checkpoints.entries()) {
      point.startMs = index === 0 ? arm.startMs : at;
      point.endMs = at;
      point.elapsedMs = at - point.startMs;
    }
    phase.body = { startMs: at, endMs: at, elapsedMs: 0 };
    phase.bodyMs = 0;
    phase.elapsedMs = phase.bootstrapMs;
    assert.throws(
      () => aggregateJourneyReceipts(values, source),
      /Journey case completion outside group body/,
    );
  });
