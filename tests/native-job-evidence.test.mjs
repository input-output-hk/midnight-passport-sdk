import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeMutationValue } from '../packages/account/dist/index.js';
import {
  encryptedHostMutationStore,
  encryptedHostJobStore,
  createHostMutationExecutor,
  createHostMutationJobs,
  hostHash,
} from '../packages/service/dist/index.js';
import {
  nativeJobSnapshot,
  assertNativeJobContinuation,
  requireNativeJobFailure,
} from '../scripts/qualification/native-job-evidence.mjs';
import { descriptor, servicePins } from './fixtures/host-jobs.mjs';
/** @param {import('node:test').TestContext} t */
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'native-job-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const keys = { hostKey: new Uint8Array(32).fill(1), jobKey: new Uint8Array(32).fill(2) };
  await writeFile(join(root, 'fixture.json'), JSON.stringify(encodeMutationValue(keys)), {
    mode: 0o600,
  });
  const h = encryptedHostMutationStore(join(root, 'host-journal'), keys.hostKey),
    j = encryptedHostJobStore(join(root, 'job-journal'), keys.jobKey);
  t.after(() => {
    h.close();
    j.close();
  });
  let sends = 0,
    visible = true;
  const sent = new Set();
  const engine = createHostMutationExecutor(h, {
    prepare: async () => ({
      address: 'ab'.repeat(32),
      steps: 1,
      context: { secret: 'synthetic-private-authority' },
    }),
    prepareStep: async () => ({ tx: 'deadbeef', identifiers: ['cd'.repeat(32)] }),
    submit: async (p) => {
      sends++;
      sent.add(p.identifiers[0]);
      return /** @type {string} */ (p.identifiers[0]);
    },
    lookup: async (p) =>
      visible && sent.has(p.identifiers[0])
        ? {
            identifier: /** @type {string} */ (p.identifiers[0]),
            txHash: 'ef'.repeat(32),
            succeeded: true,
          }
        : undefined,
    check: async () => true,
  });
  const jobs = createHostMutationJobs(j, engine, { pins: servicePins });
  return {
    root,
    h,
    j,
    engine,
    jobs,
    sends: () => sends,
    visible: (v = true) => {
      visible = v;
    },
  };
}
test('native receipt inspector derives immutable history claims and exports no protected input/authority', async (t) => {
  const f = await setup(t),
    d = descriptor();
  const a = await f.jobs.accept(d);
  const queued = await nativeJobSnapshot(f.root);
  assert.equal(queued.dispatchClaims, 0);
  assert.equal(queued.jobs[0]?.host, undefined);
  await f.jobs.start(a.jobId);
  await f.jobs.drain();
  const done = await nativeJobSnapshot(f.root);
  assert.equal(done.dispatchClaims, 1);
  assert.equal(done.confirmed, 1);
  assert.equal(done.historyAudited, true);
  assert.equal(done.attemptsInstrumented, false);
  assert.equal(f.sends(), 1);
  assertNativeJobContinuation(queued, done);
  const text = JSON.stringify(done);
  assert.ok(!text.includes('deadbeef'));
  assert.ok(!text.includes('synthetic-private-authority'));
  assert.equal(done.jobs[0]?.inputSha256, hostHash(d.input));
  const observation = await nativeJobSnapshot(f.root, { history: false });
  assert.equal(observation.historyAudited, false);
  assert.throws(() => assertNativeJobContinuation(observation, done));
});
test('native unknown broadcast keeps its dispatch claim and original bytes through confirmed lookup', async (t) => {
  const f = await setup(t);
  f.visible(false);
  const d = descriptor(),
    a = await f.jobs.accept(d);
  await f.jobs.start(a.jobId);
  await f.jobs.drain();
  const before = await nativeJobSnapshot(f.root);
  assert.equal(before.dispatchClaims, 1);
  assert.equal(before.confirmed, 0);
  f.visible(true);
  await f.jobs.reconcile(a.jobId);
  await f.jobs.drain();
  const after = await nativeJobSnapshot(f.root);
  assertNativeJobContinuation(before, after);
  assert.equal(after.confirmed, 1);
  assert.equal(f.sends(), 1);
  const altered = structuredClone(after);
  assert.ok(altered.jobs[0]);
  altered.jobs[0].descriptorSha256 = 'ff'.repeat(32);
  assert.throws(() => assertNativeJobContinuation(before, altered));
});
test('missing, corrupt or private-unsafe historical ciphertext cannot become an audited native pass', async (t) => {
  const f = await setup(t),
    a = await f.jobs.accept(descriptor());
  await f.jobs.start(a.jobId);
  await f.jobs.drain();
  const directory = join(f.root, 'host-journal'),
    file = (await readdir(directory)).find((p) => p.endsWith('.r1.json'));
  assert.ok(file);
  const path = join(directory, file),
    original = await readFile(path);
  await rm(path);
  await assert.rejects(() => nativeJobSnapshot(f.root));
  await writeFile(path, original, { mode: 0o600 });
  const raw = JSON.parse(original.toString('utf8'));
  const value = Buffer.from(raw.ciphertext, 'base64');
  value[15] = (value[15] ?? 0) ^ 1;
  raw.ciphertext = value.toString('base64');
  await writeFile(path, JSON.stringify(raw));
  await assert.rejects(() => nativeJobSnapshot(f.root));
});
test('native failure classifier refuses arbitrary exits, another operation, wrong code or missing unresolved effect', () => {
  const good = {
    code: 2,
    messages: [{ failed: 'create', code: 'MutationUnsettled', audit: { unresolvedEffects: 1 } }],
  };
  requireNativeJobFailure(good, 'create');
  for (const bad of [
    { ...good, code: 0 },
    { ...good, messages: [] },
    {
      ...good,
      messages: [{ failed: 'rotate', code: 'MutationUnsettled', audit: { unresolvedEffects: 1 } }],
    },
    {
      ...good,
      messages: [{ failed: 'create', code: 'InternalError', audit: { unresolvedEffects: 1 } }],
    },
    {
      ...good,
      messages: [{ failed: 'create', code: 'MutationUnsettled', audit: { unresolvedEffects: 0 } }],
    },
    { ...good, messages: [...good.messages, ...good.messages] },
  ])
    assert.throws(() => requireNativeJobFailure(bad, 'create'));
});
