// Closed synthetic-browser inventory aggregation; never launches a browser or accepts a count alone.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  journeyCatalog,
  journeyGroups,
  expectedCases,
  bootstrapPlans,
} from '../../apps/passport-dapp/e2e/journeys/catalog.mjs';
const arms = Object.freeze(['p256', 'jubjub']);
export const journeyInventorySha256 = createHash('sha256')
  .update(JSON.stringify(journeyCatalog))
  .digest('hex');
export const journeyCells = Object.freeze(
  arms.flatMap((arm) =>
    journeyGroups.map((group) =>
      Object.freeze({ arm, group, artifact: `journey-${arm}-${group}` }),
    ),
  ),
);
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @param {unknown} value @returns {asserts value is Record<string,unknown>} */
function object(value) {
  if (!record(value)) throw Error('Invalid journey receipt object');
}
/** @param {unknown} value @returns {value is number} */
function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
/** @param {unknown} value */
function interval(value) {
  object(value);
  if (
    !finite(value.startMs) ||
    !finite(value.endMs) ||
    !finite(value.elapsedMs) ||
    Number(value.endMs) < Number(value.startMs) ||
    Math.abs(Number(value.endMs) - Number(value.startMs) - Number(value.elapsedMs)) > 0.01
  )
    throw Error('Invalid complete journey timing');
  return { startMs: value.startMs, endMs: value.endMs, elapsedMs: value.elapsedMs };
}
/** @param {string} arm */
export function journeyPurposes(arm) {
  return [
    'create',
    'derive-keys',
    'identify-and-unlock',
    ...(arm === 'p256' ? ['sign'] : []),
    'verify-created',
  ];
}
/** @param {unknown} value @param {string} arm @param {string} group */
function attestCases(value, arm, group) {
  if (!Array.isArray(value)) throw Error('Missing journey cases');
  const expected = expectedCases(arm, group);
  if (value.length !== expected.length) throw Error('Journey cases missing or extra');
  for (const [index, item] of value.entries()) {
    object(item);
    const wanted = expected[index];
    if (
      !wanted ||
      Object.keys(item).sort().join(',') !== 'arm,group,id,name' ||
      item.arm !== arm ||
      item.group !== group ||
      item.id !== wanted.id ||
      item.name !== wanted.name
    )
      throw Error('Journey case duplicate, foreign or out of order');
  }
  return expected.map((item) => ({ arm, group, id: item.id, name: item.name }));
}
/** @param {number} left @param {number} right */
const near = (left, right) => Math.abs(left - right) <= 0.01;
/** The clock samples between phases may leave gaps; checkpoints themselves are contiguous.
 * @param {Record<string,unknown>} observed @param {string} arm @param {string} group */
function attestArmTiming(observed, arm, group) {
  const body = interval(observed),
    cleanup = interval(observed.cleanup);
  if (
    observed.arm !== arm ||
    observed.bodyComplete !== true ||
    !Number.isSafeInteger(observed.contextsCreated) ||
    Number(observed.contextsCreated) < 1 ||
    !Number.isSafeInteger(observed.pagesCreated) ||
    Number(observed.pagesCreated) < Number(observed.contextsCreated) ||
    cleanup.startMs < body.startMs ||
    !near(cleanup.endMs, body.endMs)
  )
    throw Error('Incomplete journey body');
  const expected = expectedCases(arm, group);
  if (!Array.isArray(observed.checkpoints) || observed.checkpoints.length !== expected.length)
    throw Error('Missing journey checkpoints');
  let last = body.startMs;
  for (const [index, point] of observed.checkpoints.entries()) {
    object(point);
    const checkpoint = interval(point);
    if (
      point.name !== expected[index]?.name ||
      !near(checkpoint.startMs, last) ||
      checkpoint.endMs > cleanup.startMs
    )
      throw Error('Journey checkpoint inventory or chronology differs');
    last = checkpoint.endMs;
  }
  if (
    !finite(observed.afterLastCheckpointMs) ||
    !near(observed.afterLastCheckpointMs, cleanup.startMs - last)
  )
    throw Error('Invalid journey checkpoint tail');
  return { body, cleanup };
}
/** @param {unknown} groups @param {string} group @param {number} availableMs */
function attestGroupTiming(groups, group, availableMs) {
  if (!Array.isArray(groups) || groups.length !== 1) throw Error('Missing journey group timing');
  const phase = groups[0];
  object(phase);
  if (
    phase.group !== group ||
    phase.complete !== true ||
    phase.bootstrapComplete !== true ||
    !finite(phase.bodyMs) ||
    !finite(phase.elapsedMs) ||
    !finite(phase.bootstrapMs) ||
    !near(phase.elapsedMs, phase.bodyMs + phase.bootstrapMs) ||
    phase.elapsedMs > availableMs + 0.01 ||
    JSON.stringify(phase.bootstrapActions) !==
      JSON.stringify(bootstrapPlans[/** @type {keyof typeof bootstrapPlans} */ (group)])
  )
    throw Error('Incomplete group or bootstrap accounting');
}
/** @param {Record<string,unknown>} value @param {string} arm @param {string} group */
function attestTiming(value, arm, group) {
  object(value.timings);
  const timing = value.timings;
  if (timing.clock !== 'monotonic performance.now' || !finite(timing.totalMs))
    throw Error('Invalid journey clock');
  object(timing.setup);
  const setup = interval(timing.setup),
    cleanup = interval(timing.cleanup);
  if (setup.startMs !== 0 || timing.setup.complete !== true)
    throw Error('Incomplete journey setup');
  if (!Array.isArray(timing.arms) || timing.arms.length !== 1)
    throw Error('Missing journey arm timing');
  const observed = timing.arms[0];
  object(observed);
  const armTiming = attestArmTiming(observed, arm, group);
  if (
    setup.endMs > armTiming.body.startMs ||
    armTiming.body.endMs > cleanup.startMs ||
    !near(cleanup.endMs, timing.totalMs)
  )
    throw Error('Invalid journey phase chronology');
  object(value.groupTimings);
  attestGroupTiming(
    value.groupTimings[arm],
    group,
    armTiming.cleanup.startMs - armTiming.body.startMs,
  );
}
/** @param {Record<string,unknown>} value @param {string} source @param {boolean} allowDirty */
function attestScope(value, source, allowDirty) {
  if (
    typeof source !== 'string' ||
    !/^[a-f0-9]{40}$/.test(source) ||
    value.sourceCommit !== source ||
    value.schemaVersion !== 1 ||
    value.outcome !== 'passed' ||
    value.tier !== 'browser-ui-synthetic-connector' ||
    value.binding !== 'acc-s3r1.1' ||
    value.manifestSha256 !== '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f' ||
    value.nativeProofs !== false ||
    value.realProvider !== false ||
    value.resourcesClosed !== true ||
    typeof value.dirty !== 'boolean' ||
    (!allowDirty && value.dirty)
  )
    throw Error('Failed, stale or overclaimed journey receipt');
}
/** @param {Record<string,unknown>} value */
function attestCell(value) {
  if (
    !Array.isArray(value.selectedArms) ||
    value.selectedArms.length !== 1 ||
    !Array.isArray(value.selectedGroups) ||
    value.selectedGroups.length !== 1
  )
    throw Error('Journey needs exactly one arm and group');
  const arm = value.selectedArms[0],
    group = value.selectedGroups[0];
  if (
    typeof arm !== 'string' ||
    typeof group !== 'string' ||
    !arms.includes(arm) ||
    !journeyGroups.includes(
      /** @type {import('../../apps/passport-dapp/e2e/journeys/catalog.mjs').JourneyGroup} */ (
        group
      ),
    )
  )
    throw Error('Foreign journey cell');
  return { arm, group };
}
/** @param {Record<string,unknown>} value */
function attestFingerprint(value) {
  if (
    value.caseInventorySha256 !== journeyInventorySha256 ||
    typeof value.runtimeSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.runtimeSha256) ||
    typeof value.nodeVersion !== 'string' ||
    !value.nodeVersion ||
    typeof value.browserVersion !== 'string' ||
    !value.browserVersion
  )
    throw Error('Journey fingerprints missing or mismatched');
}
/** @param {Record<string,unknown>} value */
function attestCleanup(value) {
  object(value.cleanup);
  if (
    Object.keys(value.cleanup).sort().join(',') !== 'browser,ownedCache,server' ||
    Object.values(value.cleanup).some((item) => item !== 'closed')
  )
    throw Error('Journey cleanup incomplete');
  for (const key of ['credentialFailureCodes', 'failures', 'pageErrors'])
    if (!Array.isArray(value[key]) || value[key].length)
      throw Error('Journey observer or page failure');
}
/** @param {unknown} value @param {string} source @param {boolean} allowDirty */
export function admitJourneyReceipt(value, source, allowDirty = false) {
  object(value);
  attestScope(value, source, allowDirty);
  const { arm, group } = attestCell(value);
  attestFingerprint(value);
  attestCleanup(value);
  const cases = attestCases(value.caseAttestations, arm, group);
  if (JSON.stringify(value.cases) !== JSON.stringify(cases.map(({ arm, name }) => ({ arm, name }))))
    throw Error('Legacy journey name projection differs');
  object(value.ceremonyPurposesByArm);
  const purposes = value.ceremonyPurposesByArm[arm];
  if (
    Object.keys(value.ceremonyPurposesByArm).join(',') !== arm ||
    JSON.stringify(purposes) !==
      JSON.stringify(group === 'presentation' ? [] : journeyPurposes(arm))
  )
    throw Error('Journey credential-purpose scope differs');
  attestTiming(value, arm, group);
  return {
    arm,
    group,
    cases,
    purposes,
    runtimeSha256: value.runtimeSha256,
    nodeVersion: value.nodeVersion,
    browserVersion: value.browserVersion,
    dirty: value.dirty,
  };
}
/** @param {unknown[]} values @param {string} source @param {{allowDirty?:boolean}} [options] */
export function aggregateJourneyReceipts(values, source, options = {}) {
  if (values.length !== journeyCells.length) throw Error('Need all eight journey cells');
  const cells = values.map((value) =>
    admitJourneyReceipt(value, source, options.allowDirty ?? false),
  );
  if (new Set(cells.map((cell) => cell.arm + ':' + cell.group)).size !== journeyCells.length)
    throw Error('Duplicate or missing journey cell');
  const first = cells[0];
  if (!first) throw Error('Missing journey cells');
  for (const cell of cells)
    for (const key of /** @type {const} */ ([
      'runtimeSha256',
      'nodeVersion',
      'browserVersion',
      'dirty',
    ]))
      if (cell[key] !== first[key]) throw Error('Mismatched journey runtime inputs');
  const all = journeyCells.flatMap(({ arm, group }) => {
    const cell = cells.find((cell) => cell.arm === arm && cell.group === group);
    if (!cell) throw Error('Missing journey cell');
    return cell.cases;
  });
  for (const arm of arms) {
    const actual = all.filter((c) => c.arm === arm);
    const expected = expectedCases(arm);
    if (
      actual.length !== expected.length ||
      actual.some((item, index) => item.id !== expected[index]?.id)
    )
      throw Error('Journey aggregate is not disjoint/exhaustive');
  }
  return {
    schemaVersion: 1,
    kind: 'synthetic-browser-journey-aggregate',
    outcome: 'passed',
    sourceCommit: source,
    runtimeSha256: first.runtimeSha256,
    caseInventorySha256: journeyInventorySha256,
    dirty: first.dirty,
    cells: journeyCells.length,
    cases: all.length,
    counts: {
      p256: all.filter((c) => c.arm === 'p256').length,
      jubjub: all.filter((c) => c.arm === 'jubjub').length,
    },
    nativeProofs: false,
    realProvider: false,
  };
}
/** @param {string} directory */
export function readJourneyCells(directory) {
  const expected = journeyCells.map((cell) => cell.artifact).sort();
  if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(expected))
    throw Error('Journey artifact directories missing or extra');
  return expected.map((name) => {
    const folder = join(directory, name);
    if (
      !lstatSync(folder).isDirectory() ||
      JSON.stringify(readdirSync(folder)) !== JSON.stringify(['demo-journeys.json'])
    )
      throw Error('Invalid journey artifact directory');
    const file = join(folder, 'demo-journeys.json'),
      stat = lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024)
      throw Error('Invalid journey receipt file');
    return JSON.parse(readFileSync(file, 'utf8'));
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , inputFlag, input, sourceFlag, source, extra] = process.argv;
  if (
    inputFlag !== '--input' ||
    !input ||
    sourceFlag !== '--source' ||
    !source ||
    process.argv.length > 7 ||
    (extra !== undefined && extra !== '--allow-dirty')
  )
    throw Error('Use --input ARTIFACT_DIRECTORY --source FULL_SHA [--allow-dirty]');
  if (extra && process.env.CI) throw Error('CI cannot allow dirty journey receipts');
  console.log(
    JSON.stringify(
      aggregateJourneyReceipts(readJourneyCells(input), source, {
        allowDirty: extra === '--allow-dirty',
      }),
      null,
      2,
    ),
  );
}
