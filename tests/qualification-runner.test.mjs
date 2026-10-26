import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCENARIOS } from '../scripts/qualification/catalog.mjs';
import { planSuite, runCommand } from '../scripts/qualification/runner.mjs';
import {
  qualifyRepeatedRuns,
  tapSummary,
  validateReceipt,
  writeReceipt,
  qualificationRuntimeFiles,
} from '../scripts/qualification/receipt.mjs';

const identity = {
  commit: 'a'.repeat(40),
  dirty: false,
  workspaceSha256: 'b'.repeat(64),
  fileCount: 1,
};
const binding = {
  id: 'acc-s3r1.1',
  compilerManifestSha256: 'c'.repeat(64),
  moduleSha256: 'd'.repeat(64),
};
const receipt = () => ({
  schemaVersion: 1,
  runId: randomUUID(),
  suite: 'foundation',
  startedAt: new Date().toISOString(),
  source: { ...identity },
  binding: { ...binding },
  results: [
    { id: 'binding-source', tier: 'source-comparison', outcome: 'passed', elapsedMs: 1 },
    {
      id: 'contract-entries',
      tier: 'contract-simulator',
      outcome: 'passed',
      elapsedMs: 1,
      tests: { passed: 1, failed: 0, skipped: 0, cancelled: 0 },
    },
    {
      id: 'reader-guards',
      tier: 'unit-port',
      outcome: 'passed',
      elapsedMs: 1,
      tests: { passed: 1, failed: 0, skipped: 0, cancelled: 0 },
    },
  ],
  allRequiredPassed: true,
  releaseQualified: false,
});
const scenario = (/** @type {string} */ code, timeoutMs = 2000) => ({
  tier: 'unit-port',
  command: [process.execPath, '-e', code],
  requires: [],
  timeoutMs,
  establishes: 'test fixture',
});

test('plans name missing inputs, distinguish tiers and leave unimplemented release gates visible', () => {
  assert.deepEqual(planSuite('foundation', {}).find((s) => s.id === 'binding-source')?.missing, [
    'PASSPORT_REPO',
  ]);
  const release = planSuite('release', {});
  assert.ok(release.some((s) => s.status === 'not-implemented'));
  assert.ok(release.some((s) => s.tier === 'manual-provider'));
  assert.throws(() => planSuite('unknown'), /unknown/);
});

test('process failures export fixed codes and digests, not stderr secrets', async () => {
  const result = await runCommand(
    scenario('process.stderr.write("witness-secret-fixture");process.exit(7)'),
  );
  assert.equal(result.outcome, 'failed');
  assert.equal(result.failureCode, 'PROCESS_EXIT');
  assert.equal(result.exitCode, 7);
  assert.equal(JSON.stringify(result).includes('witness-secret-fixture'), false);
});

test('owned subprocess groups are stopped on deadlines and bounded output', async () => {
  const timed = await runCommand(scenario('setInterval(()=>{},1000)', 100));
  assert.equal(timed.outcome, 'timed-out');
  const large = await runCommand(
    scenario('process.stdout.write("x".repeat(10000));setInterval(()=>{},1000)'),
    { maxOutputBytes: 100 },
  );
  assert.equal(large.outcome, 'output-limit');
});

test('skipped TAP checks cannot become successful qualification', async () => {
  const result = await runCommand(scenario('console.log("# pass 1\\n# fail 0\\n# skipped 2")'));
  assert.equal(result.outcome, 'passed-with-skips');
  assert.equal(result.tests?.skipped, 2);
  assert.deepEqual(tapSummary('no test summary'), {});
});

test('closed receipts reject arbitrary child data, contradictory passes and release claims', () => {
  assert.equal(validateReceipt(receipt()).releaseQualified, false);
  assert.throws(() => validateReceipt({ ...receipt(), secret: 'fixture' }), /unsupported field/);
  const bad = receipt();
  assert.ok(bad.results[0]);
  Object.assign(bad.results[0], { failureCode: 'raw secret exception' });
  assert.throws(() => validateReceipt(bad), /unsafe error/);
  assert.throws(() => validateReceipt({ ...receipt(), releaseQualified: true }), /unavailable/);
  const skipped = receipt();
  assert.ok(skipped.results[0]);
  skipped.results[0].outcome = 'passed-with-skips';
  assert.throws(() => validateReceipt(skipped), /contradicts/);
});

test('evidence files are exclusive and three-run checks reject replay, drift and skipped runs', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'passport-receipt-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'evidence.json'),
    record = receipt();
  await writeReceipt(path, record);
  await assert.rejects(writeReceipt(path, receipt()), /EEXIST/);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), record);
  const three = [receipt(), receipt(), receipt()];
  assert.equal(qualifyRepeatedRuns(three).repeatable, true);
  assert.throws(() => qualifyRepeatedRuns([three[0], three[0], three[2]]), /replayed/);
  assert.ok(three[1]);
  three[1].source.workspaceSha256 = 'f'.repeat(64);
  assert.throws(() => qualifyRepeatedRuns(three), /differ/);
  assert.throws(() => qualifyRepeatedRuns([]), /three/);
});

test('successful-looking receipts cannot hide failed or skipped child assertions', () => {
  const record = receipt();
  assert.ok(record.results[0]);
  Object.assign(record.results[0], { tests: { passed: 1, failed: 1, skipped: 0, cancelled: 0 } });
  assert.throws(() => validateReceipt(record), /contradicts/);
});

test('artifact identity is checked independently before any qualification action', async (t) => {
  const { verifyQualificationBinding } = await import('../scripts/qualification/receipt.mjs');
  const { mkdir, writeFile } = await import('node:fs/promises');
  const root = new URL('..', import.meta.url).pathname;
  assert.equal((await verifyQualificationBinding(root)).id, 'acc-s3r1.1');
  const dir = await mkdtemp(join(tmpdir(), 'passport-binding-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const generated = 'packages/contract/generated/acc-s3r1.1';
  await mkdir(join(dir, generated), { recursive: true });
  await writeFile(
    join(dir, 'packages/contract/acc-binding-v2.generated.json'),
    await readFile(join(root, 'packages/contract/acc-binding-v2.generated.json')),
  );
  await writeFile(
    join(dir, generated, 'index.d.ts'),
    await readFile(join(root, generated, 'index.d.ts')),
  );
  await writeFile(join(dir, generated, 'index.js'), 'tampered module');
  await assert.rejects(verifyQualificationBinding(dir), /integrity failure/);
});

test('receipt scope cannot omit declared cases or relabel a unit test as proof evidence', () => {
  const missing = receipt();
  missing.results.pop();
  assert.throws(() => validateReceipt(missing), /inventory/);
  const wrongTier = receipt();
  assert.ok(wrongTier.results[0]);
  wrongTier.results[0].tier = 'proof-localnet';
  assert.throws(() => validateReceipt(wrongTier), /tier/);
});

test('ignored compiled inputs are included in qualification identity and symlinks refused', async () => {
  const { mkdir, writeFile, symlink } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'passport-runtime-inputs-'));
  try {
    await mkdir(join(root, 'packages/example/dist'), { recursive: true });
    await writeFile(join(root, 'packages/example/dist/index.js'), 'export const v=1;');
    assert.deepEqual(await qualificationRuntimeFiles(root), ['packages/example/dist/index.js']);
    await symlink('index.js', join(root, 'packages/example/dist/alias.js'));
    await assert.rejects(qualificationRuntimeFiles(root), /symlinks/);
    await rm(join(root, 'packages/example/dist/alias.js'));
    await rm(join(root, 'packages/example/dist'), { recursive: true });
    await mkdir(join(root, 'other-build'));
    await symlink(join(root, 'other-build'), join(root, 'packages/example/dist'));
    await assert.rejects(qualificationRuntimeFiles(root), /symlinks/);
    await rm(join(root, 'packages/example'), { recursive: true, force: true });
    await symlink(join(root, 'other-build'), join(root, 'packages/example'));
    await assert.rejects(qualificationRuntimeFiles(root), /symlinks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('every declared Node test scenario pins TAP reporting', () => {
  for (const [id, declared] of Object.entries(SCENARIOS)) {
    const command = /** @type {readonly string[]} */ (declared.command);
    if (command.includes('--test')) assert.ok(command.includes('--test-reporter=tap'), id);
  }
});

test('pinned catalog flags run independently of inherited Node test context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'passport-tap-'));
  try {
    const command = SCENARIOS['contract-entries'].command.slice(0, 3);
    assert.ok(command.includes('--test-reporter=tap'));
    const fixture = { ...scenario('unused', 10000), command };
    const env = { ...process.env, NODE_TEST_CONTEXT: 'child-v8' };
    const empty = await runCommand(fixture, { root, env });
    assert.equal(empty.outcome, 'failed');
    assert.equal(empty.failureCode, 'NO_TESTS');
    await writeFile(
      join(root, 'sample.test.mjs'),
      "import {test} from 'node:test'; test('real callback',()=>{});\n",
    );
    const real = await runCommand(fixture, { root, env });
    assert.equal(real.outcome, 'passed');
    assert.equal(real.tests?.passed, 1);
    assert.equal(env.NODE_TEST_CONTEXT, 'child-v8'); // Caller-owned environment is unchanged.
    assert.equal(
      (await runCommand(scenario('console.log("non-test diagnostic")'))).outcome,
      'passed',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('receipt validation and repetition reject missing or zero declared test evidence', () => {
  for (const outcome of ['passed', 'passed-with-skips']) {
    for (const tests of [undefined, { passed: 0, failed: 0, skipped: 1, cancelled: 0 }]) {
      const changed = receipt(),
        row = changed.results[1];
      assert.ok(row);
      Object.assign(row, { outcome, tests });
      if (outcome === 'passed' && tests) tests.skipped = 0;
      changed.allRequiredPassed = outcome === 'passed';
      assert.throws(() => validateReceipt(changed), /positive passing test evidence/);
      assert.throws(
        () => qualifyRepeatedRuns([changed, receipt(), receipt()]),
        /positive passing test evidence/,
      );
    }
  }
});
