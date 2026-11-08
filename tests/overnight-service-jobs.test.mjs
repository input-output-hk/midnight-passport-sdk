import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, descriptor, barrier, servicePins } from './fixtures/host-jobs.mjs';
import {
  createHostMutationJobs,
  createMemoryHostJobStore,
  hostHash,
  hostJobId,
} from '../packages/service/dist/index.js';

test('owned queue admits every supported reservation with maxActive twelve', async () => {
  const f = fixture(undefined, { maxActive: 12 }),
    entered = barrier(),
    release = barrier(),
    old = f.driver.prepare;
  f.driver.prepare = async (...args) => {
    entered.release();
    await release.promise;
    return old(...args);
  };
  const ids = [];
  try {
    for (let n = 1; n <= 12; n++) ids.push((await f.jobs.accept(descriptor(n))).jobId);
    for (const id of ids) await f.jobs.start(id);
    await entered.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      (await Promise.all(ids.map((id) => f.jobs.get(id)))).map((record) => record?.state),
      Array(12).fill('running'),
    );
    release.release();
    await f.jobs.drain();
    assert.deepEqual(
      (await Promise.all(ids.map((id) => f.jobs.get(id)))).map((record) => record?.state),
      Array(12).fill('done'),
    );
    assert.deepEqual(f.counts(), { sends: 12, executions: 12, resumes: 0, prepared: 12 });
  } finally {
    release.release();
    f.jobs.stopAdmission();
    await f.jobs.drain();
  }
});

for (const entered of [false, true])
  test(`custom queue failure remains unknown without replay (entered=${entered})`, async () => {
    const f = fixture();
    const queue = async (/** @type {()=>Promise<unknown>} */ work) => {
      if (entered) await work();
      throw Error('synthetic queue reply lost');
    };
    const jobs = createHostMutationJobs(createMemoryHostJobStore(), f.executor, {
      pins: servicePins,
      runExclusive: queue,
    });
    try {
      const accepted = await jobs.accept(descriptor());
      await jobs.start(accepted.jobId);
      await jobs.drain();
      assert.equal((await jobs.get(accepted.jobId))?.state, entered ? 'done' : 'unknown');
      assert.equal(f.counts().sends, entered ? 1 : 0);
      await jobs.start(accepted.jobId);
      await jobs.reconcile(accepted.jobId);
      await jobs.drain();
      assert.equal(f.counts().executions, entered ? 1 : 0);
      assert.equal(f.counts().sends, entered ? 1 : 0);
    } finally {
      jobs.stopAdmission();
      f.jobs.stopAdmission();
      await Promise.all([jobs.drain(), f.jobs.drain()]);
    }
  });

for (const scheme of ['p256-webauthn', 'jubjub-schnorr'])
  test(`deployment arm must match identity scheme before durable admission (${scheme})`, async () => {
    const f = fixture(),
      call = descriptor();
    /** @type {import('../packages/service/dist/index.js').HostJobDescriptor} */
    const deployment = {
      version: 1,
      identity: {
        ...call.identity,
        kind: 'deploy',
        pins: {
          ...call.identity.pins,
          scheme: scheme === 'p256-webauthn' ? 'p256-webauthn' : 'jubjub-schnorr',
        },
      },
      input: {
        boot: 'ab'.repeat(32),
        encKey: 'cd'.repeat(32),
        retireAuthority: true,
        firstArm: scheme === 'p256-webauthn' ? 'jubjub' : 'p256',
      },
    };
    try {
      await assert.rejects(f.jobs.accept(deployment), { status: 400 });
      const matching = {
        ...deployment,
        input: {
          boot: 'ab'.repeat(32),
          encKey: 'cd'.repeat(32),
          retireAuthority: true,
          firstArm: scheme === 'p256-webauthn' ? 'p256' : 'jubjub',
        },
      };
      const accepted = await f.jobs.accept(matching);
      assert.equal((await f.jobs.get(accepted.jobId))?.state, 'queued');
      assert.equal(f.counts().executions, 0);
    } finally {
      f.jobs.stopAdmission();
      await f.jobs.drain();
    }
  });

test('new deployment admission policy preserves readable historical mismatched descriptors', async () => {
  const store = createMemoryHostJobStore(),
    f = fixture(store),
    call = descriptor();
  /** @type {import('../packages/service/dist/index.js').HostJobDescriptor} */
  const legacy = {
    version: 1,
    identity: { ...call.identity, kind: 'deploy' },
    input: {
      boot: 'ab'.repeat(32),
      encKey: 'cd'.repeat(32),
      retireAuthority: true,
      firstArm: 'p256',
    },
  };
  const id = hostJobId(legacy),
    milestones = { preparedSteps: 0, confirmedSteps: 0 };
  await store.compareAndSwap(undefined, {
    version: 1,
    revision: 0,
    id,
    descriptor: legacy,
    descriptorSha256: hostHash(legacy),
    createdAt: 1,
    updatedAt: 1,
    policy: { eventLimit: 32, completedTtlMs: 600000 },
    state: 'queued',
    milestones,
    eventSequence: 1,
    events: [{ sequence: 1, state: 'queued', at: 1, ...milestones }],
  });
  try {
    assert.equal((await f.jobs.get(id))?.state, 'queued');
    await assert.rejects(f.jobs.accept(legacy), { status: 400 });
    assert.deepEqual((await store.read(id))?.descriptor, legacy);
    assert.equal(f.counts().executions, 0);
  } finally {
    f.jobs.stopAdmission();
    await f.jobs.drain();
  }
});
