import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, readdir, readFile, chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createMemoryHostJobStore,
  encryptedHostJobStore,
  createHostMutationJobs,
  hostJobId,
  validateHostJobRecord,
  hostCanonical,
} from '../packages/service/dist/index.js';
import { fixture, descriptor, servicePins, barrier } from './fixtures/host-jobs.mjs';

/** @param {import('node:test').TestContext} t @param {number} [maxJobs] */
async function disk(t, maxJobs = 128) {
  const root = await mkdtemp(join(tmpdir(), 'passport-host-jobs-')),
    key = new Uint8Array(32).fill(7);
  const store = encryptedHostJobStore(root, key, { maxJobs });
  t.after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, key, store };
}
for (const persistent of [false, true]) {
  test(`acceptance is persisted before effects; original completion is replayed (${persistent ? 'encrypted' : 'memory'})`, async (t) => {
    const f = fixture(persistent ? (await disk(t)).store : undefined),
      d = descriptor();
    const a = await f.jobs.accept(d);
    assert.deepEqual(a, { jobId: hostJobId(d) });
    assert.equal((await f.jobs.get(a.jobId))?.state, 'queued');
    assert.equal(f.counts().executions, 0);
    assert.equal(
      (await f.jobStore.read(a.jobId))?.descriptor.input &&
        hostCanonical((await f.jobStore.read(a.jobId))?.descriptor.input),
      hostCanonical(d.input),
    );
    await f.jobs.start(a.jobId);
    await f.jobs.drain();
    assert.equal((await f.jobs.get(a.jobId))?.state, 'done');
    const before = f.counts();
    assert.deepEqual(await f.jobs.accept(d), a);
    await f.jobs.start(a.jobId);
    await f.jobs.reconcile(a.jobId);
    await f.jobs.drain();
    assert.deepEqual(f.counts(), before);
    await assert.rejects(
      f.jobs.accept({ ...d, input: { .../** @type {object} */ (d.input), tx: 'ff' } }),
      { status: 409 },
    );
    await assert.rejects(
      f.jobs.accept({ ...d, identity: { ...d.identity, intentSha256: '34'.repeat(32) } }),
      { status: 409 },
    );
  });
}
test('two encrypted workers can claim a queued job only once', async (t) => {
  const p = await disk(t),
    other = encryptedHostJobStore(p.root, p.key);
  t.after(() => other.close());
  const f = fixture(p.store),
    second = createHostMutationJobs(other, f.executor, { pins: servicePins });
  const a = await f.jobs.accept(descriptor());
  await Promise.all([f.jobs.start(a.jobId), second.start(a.jobId)]);
  await Promise.all([f.jobs.drain(), second.drain()]);
  assert.equal(f.counts().executions, 1);
  assert.equal(f.counts().sends, 1);
  assert.equal((await second.get(a.jobId))?.state, 'done');
});
test('lost broadcast reply is reconciled through a new job processor without execute or resend', async (t) => {
  const p = await disk(t),
    f = fixture(p.store);
  f.lose();
  const a = await f.jobs.accept(descriptor());
  await f.jobs.start(a.jobId);
  await f.jobs.drain();
  assert.equal((await f.jobs.get(a.jobId))?.state, 'unknown');
  const nextStore = encryptedHostJobStore(p.root, p.key);
  t.after(() => nextStore.close());
  const next = createHostMutationJobs(nextStore, f.executor, { pins: servicePins });
  await next.start(a.jobId);
  assert.equal(f.counts().executions, 1);
  await next.reconcile(a.jobId);
  await next.drain();
  assert.equal((await next.get(a.jobId))?.state, 'done');
  assert.equal(f.counts().sends, 1);
  assert.equal(f.counts().prepared, 1);
});
test('unknown finality polls retain status revisions and never re-execute or resend', async () => {
  const f = fixture();
  f.visible(false);
  const a = await f.jobs.accept(descriptor());
  await f.jobs.start(a.jobId);
  await f.jobs.drain();
  const before = await f.jobStore.read(a.jobId);
  for (let n = 0; n < 10; n++) {
    await f.jobs.reconcile(a.jobId);
    await f.jobs.drain();
  }
  assert.deepEqual(await f.jobStore.read(a.jobId), before);
  assert.equal(f.counts().sends, 1);
  assert.equal(f.counts().executions, 1);
  f.visible();
  await f.jobs.reconcile(a.jobId);
  await f.jobs.drain();
  assert.equal((await f.jobs.get(a.jobId))?.state, 'done');
});
test('missing host state cannot fence a late original execute; unknown never becomes a second start', async () => {
  const f = fixture(),
    entered = barrier(),
    release = barrier(),
    execute = f.executor.execute;
  f.executor.execute = async (...args) => {
    entered.release();
    await release.promise;
    return execute(...args);
  };
  const a = await f.jobs.accept(descriptor());
  await f.jobs.start(a.jobId);
  const next = createHostMutationJobs(f.jobStore, f.executor, { pins: servicePins });
  try {
    await entered.promise;
    await next.reconcile(a.jobId);
    await next.drain();
    assert.equal((await next.get(a.jobId))?.state, 'unknown');
    assert.equal(f.counts().executions, 0);
    await next.start(a.jobId);
    assert.equal(f.counts().executions, 0);
    release.release();
    await f.jobs.drain();
    assert.equal(
      (await next.get(a.jobId))?.state,
      'unknown',
      'Stale original completion cannot overwrite newer unknown.',
    );
    await next.reconcile(a.jobId);
    await next.drain();
    assert.equal((await next.get(a.jobId))?.state, 'done');
    assert.equal(f.counts().executions, 1);
    assert.equal(f.counts().sends, 1);
  } finally {
    release.release();
    await f.jobs.drain();
  }
});
test('lost start-fence acknowledgement remains unknown, not permission to execute again', async () => {
  const actual = createMemoryHostJobStore();
  let lose = true;
  const proxy = {
    read: actual.read,
    compareAndSwap: async (
      /** @type {number|undefined} */ old,
      /** @type {import('../packages/service/dist/index.js').HostJobRecord} */ r,
    ) => {
      const ok = await actual.compareAndSwap(old, r);
      if (ok && r.state === 'running' && lose) {
        lose = false;
        throw new Error('protected disk acknowledgement lost');
      }
      return ok;
    },
  };
  const f = fixture(proxy),
    a = await f.jobs.accept(descriptor());
  await assert.rejects(f.jobs.start(a.jobId), { status: 503 });
  const next = createHostMutationJobs(actual, f.executor, { pins: servicePins });
  await next.start(a.jobId);
  await next.reconcile(a.jobId);
  await next.drain();
  assert.equal((await next.get(a.jobId))?.state, 'unknown');
  assert.equal(f.counts().executions, 0);
});
test('lost completion persistence keeps the host receipt available without another broadcast', async () => {
  const actual = createMemoryHostJobStore();
  let fail = true;
  const proxy = {
    read: actual.read,
    compareAndSwap: async (
      /** @type {number|undefined} */ old,
      /** @type {import('../packages/service/dist/index.js').HostJobRecord} */ r,
    ) => {
      if (r.state === 'done' && fail) {
        fail = false;
        throw new Error('protected completion write failure');
      }
      return actual.compareAndSwap(old, r);
    },
  };
  const f = fixture(proxy),
    a = await f.jobs.accept(descriptor());
  await f.jobs.start(a.jobId);
  await f.jobs.drain();
  assert.equal((await f.jobs.get(a.jobId))?.state, 'unknown');
  await f.jobs.reconcile(a.jobId);
  await f.jobs.drain();
  assert.equal((await f.jobs.get(a.jobId))?.state, 'done');
  assert.equal(f.counts().sends, 1);
});
test('cursor retention is explicit and terminal expiry keeps the ID and capacity tombstone', async () => {
  let clock = 100;
  const f = fixture(createMemoryHostJobStore({ maxJobs: 1 }), {
    eventLimit: 1,
    completedTtlMs: 10,
    now: () => clock,
  });
  const d = descriptor(),
    a = await f.jobs.accept(d);
  await f.jobs.start(a.jobId);
  await f.jobs.drain();
  const v = await f.jobs.get(a.jobId);
  assert.ok(v);
  assert.equal(v.events.length, 1);
  assert.equal(v.firstCursor, '2');
  assert.equal(v.cursor, '3');
  await assert.rejects(f.jobs.get(a.jobId, '0'), { status: 410 });
  for (const cursor of ['-1', '999', '1.0', '9007199254740992'])
    await assert.rejects(f.jobs.get(a.jobId, cursor), { status: 400 });
  assert.deepEqual((await f.jobs.get(a.jobId, '3'))?.events, []);
  clock += 10;
  assert.equal((await f.jobs.get(a.jobId))?.state, 'expired');
  assert.equal((await f.jobs.get(a.jobId))?.outcome, undefined);
  assert.deepEqual(await f.jobs.accept(d), a);
  await f.jobs.start(a.jobId);
  assert.equal(f.counts().executions, 1);
  await assert.rejects(f.jobs.accept(descriptor(2)), { status: 503 });
});
test('durable identity capacity is shared across instances and restart', async (t) => {
  const p = await disk(t, 1),
    b = encryptedHostJobStore(p.root, p.key, { maxJobs: 1 });
  t.after(() => b.close());
  const f = fixture(p.store),
    other = createHostMutationJobs(b, f.executor, { pins: servicePins });
  const accepted = await Promise.allSettled([
    f.jobs.accept(descriptor()),
    other.accept(descriptor(2)),
  ]);
  assert.equal(accepted.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = accepted.find((r) => r.status === 'rejected');
  assert.equal(rejected?.status === 'rejected' && rejected.reason.status, 503);
  const last = encryptedHostJobStore(p.root, p.key, { maxJobs: 1 });
  t.after(() => last.close());
  await assert.rejects(
    createHostMutationJobs(last, f.executor, { pins: servicePins }).accept(descriptor(3)),
    { status: 503 },
  );
});
test('work backpressure refuses before claiming queued work; shutdown drains owned tasks', async () => {
  const f = fixture(undefined, { maxActive: 1 }),
    entered = barrier(),
    release = barrier(),
    prepare = f.driver.prepare;
  f.driver.prepare = async (...args) => {
    entered.release();
    await release.promise;
    return prepare(...args);
  };
  const a = await f.jobs.accept(descriptor()),
    b = await f.jobs.accept(descriptor(2));
  try {
    await f.jobs.start(a.jobId);
    await entered.promise;
    await assert.rejects(f.jobs.start(b.jobId), { status: 503 });
    assert.equal((await f.jobs.get(b.jobId))?.state, 'queued');
    f.jobs.stopAdmission();
    await assert.rejects(f.jobs.accept(descriptor(3)), { status: 503 });
  } finally {
    release.release();
    await f.jobs.drain();
  }
  assert.equal(f.counts().sends, 1);
});
test('read corruption, wrong keys, closed stores and permissive directories fail before work', async (t) => {
  const p = await disk(t),
    f = fixture(p.store),
    a = await f.jobs.accept(descriptor());
  const wrong = encryptedHostJobStore(p.root, new Uint8Array(32).fill(8));
  t.after(() => wrong.close());
  await assert.rejects(
    createHostMutationJobs(wrong, f.executor, { pins: servicePins }).start(a.jobId),
    { status: 503 },
  );
  p.store.close();
  await assert.rejects(f.jobs.start(a.jobId), { status: 503 });
  assert.equal(f.counts().executions, 0);
  const reopened = encryptedHostJobStore(p.root, p.key);
  t.after(() => reopened.close());
  await chmod(p.root, 0o755);
  await assert.rejects(reopened.read(a.jobId));
  await chmod(p.root, 0o700);
  const names = await readdir(p.root);
  for (const name of names) {
    const data = await readFile(join(p.root, name), 'utf8');
    assert.ok(!data.includes('append_inbox_with_jubjub'));
  }
  const path = join(p.root, `${a.jobId}.r0.json`);
  const envelope = JSON.parse(await readFile(path, 'utf8'));
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
  envelope.ciphertext = ciphertext.toString('base64');
  await writeFile(path, JSON.stringify(envelope));
  await assert.rejects(reopened.read(a.jobId));
  await assert.rejects(
    createHostMutationJobs(reopened, f.executor, { pins: servicePins }).accept(descriptor()),
    { status: 503 },
  );
  assert.equal(f.counts().executions, 0);
});
test('invalid, oversized, wrong-pin and mutable descriptors cannot replace protected intent', async () => {
  const f = fixture(),
    d = descriptor();
  for (const value of [
    { ...d, version: 2 },
    { ...d, input: { .../** @type {object} */ (d.input), tx: 'a' } },
    { ...d, input: { .../** @type {object} */ (d.input), tx: 'aa'.repeat(2 * 1024 * 1024) } },
    { ...d, input: { unexpected: 'protected' } },
  ])
    await assert.rejects(f.jobs.accept(/** @type {any} */ (value)), { status: 400 });
  await assert.rejects(
    f.jobs.accept({
      ...d,
      identity: { ...d.identity, pins: { ...d.identity.pins, networkId: 'preview' } },
    }),
    { status: 409 },
  );
  const a = await f.jobs.accept(d);
  const changed = structuredClone(d);
  /** @type {any} */ (changed.input).tx = 'ff';
  await assert.rejects(f.jobs.accept(changed), { status: 409 });
  assert.equal(f.counts().executions, 0);
  const foreign = createHostMutationJobs(f.jobStore, f.executor, {
    pins: { ...servicePins, networkId: 'preview' },
  });
  await assert.rejects(foreign.start(a.jobId), { status: 503 });
  const r = await f.jobStore.read(a.jobId);
  assert.ok(r);
  validateHostJobRecord(r);
  await assert.rejects(
    f.jobStore.compareAndSwap(r.revision, {
      ...r,
      revision: r.revision + 1,
      state: 'running',
      descriptor: changed,
    }),
    /Invalid/,
  );
});

for (const published of [false, true])
  test(`accept storage failure ${published ? 'after publication' : 'before publication'} never starts work`, async () => {
    const actual = createMemoryHostJobStore();
    let fail = true;
    const proxy = {
      read: actual.read,
      compareAndSwap: async (
        /** @type {number|undefined} */ old,
        /** @type {import('../packages/service/dist/index.js').HostJobRecord} */ r,
      ) => {
        if (fail) {
          fail = false;
          if (published) await actual.compareAndSwap(old, r);
          throw new Error('protected storage failure');
        }
        return actual.compareAndSwap(old, r);
      },
    };
    const f = fixture(proxy),
      d = descriptor();
    await assert.rejects(f.jobs.accept(d), { status: 503 });
    assert.equal(f.counts().executions, 0);
    assert.equal((await actual.read(hostJobId(d)))?.state, published ? 'queued' : undefined);
    const a = await f.jobs.accept(d);
    await f.jobs.start(a.jobId);
    await f.jobs.drain();
    assert.equal(f.counts().executions, 1);
    assert.equal(f.counts().sends, 1);
  });

test(
  'shutdown drains a start claim still awaiting its durable CAS acknowledgement',
  { timeout: 10000 },
  async () => {
    const actual = createMemoryHostJobStore(),
      entered = barrier(),
      release = barrier();
    const proxy = {
      read: actual.read,
      compareAndSwap: async (
        /** @type {number|undefined} */ old,
        /** @type {import('../packages/service/dist/index.js').HostJobRecord} */ r,
      ) => {
        if (r.state === 'running') {
          entered.release();
          await release.promise;
        }
        return actual.compareAndSwap(old, r);
      },
    };
    const f = fixture(proxy),
      a = await f.jobs.accept(descriptor());
    const start = f.jobs.start(a.jobId);
    let drained = false;
    try {
      await entered.promise;
      f.jobs.stopAdmission();
      const done = f.jobs.drain().then(() => {
        drained = true;
      });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(drained, false);
      release.release();
      await start;
      await done;
      assert.equal(drained, true);
      assert.equal(f.counts().sends, 1);
    } finally {
      release.release();
      await Promise.allSettled([start]);
      await f.jobs.drain();
    }
  },
);

for (const digest of ['ff'.repeat(32), descriptor().identity.intentSha256])
  test(`uncommitted or mismatched host receipt cannot publish a done job (${digest.slice(0, 2)})`, async () => {
    const f = fixture();
    f.executor.execute = async () => ({
      kind: 'confirmed',
      digest,
      result: { txHash: 'ef'.repeat(32), submissionId: '01'.repeat(32) },
    });
    const a = await f.jobs.accept(descriptor());
    await f.jobs.start(a.jobId);
    await f.jobs.drain();
    assert.equal((await f.jobs.get(a.jobId))?.state, 'unknown');
    assert.equal((await f.jobs.get(a.jobId))?.outcome, undefined);
    assert.equal(f.counts().sends, 0);
  });

test('existing host input conflict never becomes a confirmed job receipt through reconcile', async () => {
  const f = fixture(),
    d = descriptor();
  await f.executor.execute(d.identity, { .../** @type {object} */ (d.input), tx: 'ff' });
  const before = f.counts(),
    a = await f.jobs.accept(d);
  await f.jobs.start(a.jobId);
  await f.jobs.drain();
  assert.equal((await f.jobs.get(a.jobId))?.state, 'unknown');
  await f.jobs.reconcile(a.jobId);
  await f.jobs.drain();
  assert.equal((await f.jobs.get(a.jobId))?.state, 'unknown');
  assert.equal((await f.jobs.get(a.jobId))?.outcome, undefined);
  assert.equal(f.counts().sends, before.sends);
  assert.equal(f.counts().prepared, before.prepared);
});
