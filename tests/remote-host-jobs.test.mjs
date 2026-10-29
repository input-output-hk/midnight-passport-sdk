import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, hostJobRoute, hostHash, hostJobId } from '../packages/service/dist/index.js';
import {
  remoteHostJobs,
  remoteHostJobId,
  remoteHostJobPorts,
} from '../packages/adapter-service/dist/index.js';
import { fixture, descriptor, servicePins, barrier } from './fixtures/host-jobs.mjs';
import { observeImageJobReplies } from '../scripts/qualification/image-job-observer.mjs';
import { confirmedReplyLossProbe } from '../scripts/qualification/job-lifecycle-spec.mjs';
const token = 'cd'.repeat(32);
test('image observer interrupts direct submit completion with the same confirmed job', async (t) => {
  const f = await setup(t);
  /** @type {Record<string,unknown>[]} */ const markers = [];
  const probe = confirmedReplyLossProbe('add_device_with_jubjub', (m) => markers.push(m));
  const ports = observeImageJobReplies(
    remoteHostJobPorts(f.base, f.options),
    f.client,
    probe,
    f.d.identity.pins,
  );
  await assert.rejects(
    () =>
      ports.submitter.submit(Uint8Array.of(1), {
        address: 'ab'.repeat(32),
        circuit: 'add_device_with_jubjub',
        mutation: { requestId: f.d.identity.requestId, intentSha256: f.d.identity.intentSha256 },
      }),
    { code: 'MutationUnsettled' },
  );
  assert.equal(probe.lost, true);
  assert.equal(markers.length, 1);
  assert.equal(markers[0]?.jobId, await remoteHostJobId(f.d.identity));
  assert.equal((await f.client.get(f.d.identity))?.state, 'done');
  assert.equal(f.counts().sends, 1);
});
for (const visible of [true, false])
  test(`image observer covers terminal original-ID reconciliation (confirmed=${visible})`, async (t) => {
    const f = await setup(t);
    const input = /** @type {{address:string,circuit:string,tx:string}} */ (f.d.input);
    const d = { ...f.d, input: { ...input, circuit: 'add_device_with_jubjub' } };
    f.visible(visible);
    await f.client.execute(d.identity, d.input);
    const before = f.counts();
    /** @type {Record<string,unknown>[]} */ const marker = [];
    const probe = confirmedReplyLossProbe(d.input.circuit, (m) => marker.push(m));
    const ports = observeImageJobReplies(
      remoteHostJobPorts(f.base, f.options),
      f.client,
      probe,
      f.d.identity.pins,
    );
    const effect = {
      key: d.identity.requestId,
      digest: d.identity.intentSha256,
      kind: /** @type {const} */ ('call'),
      input: { circuit: d.input.circuit },
    };
    if (visible) {
      const methods = f.methods.length;
      await assert.rejects(() => ports.outcomes.reconcile(d.identity.pins, effect), {
        code: 'MutationUnsettled',
      });
      assert.equal(probe.lost, true);
      assert.deepEqual(marker, [
        {
          imageReplyLost: true,
          circuit: d.input.circuit,
          jobId: await remoteHostJobId(d.identity),
          state: 'done',
        },
      ]);
      assert.ok(f.methods.slice(methods).every((m) => m.startsWith('GET ')));
    } else {
      assert.deepEqual(await ports.outcomes.reconcile(d.identity.pins, effect), {
        kind: 'unknown',
      });
      assert.equal(probe.lost, false);
      assert.equal(marker.length, 0);
    }
    assert.equal(f.counts().sends, before.sends);
    assert.equal(f.counts().executions, before.executions);
  });
/** @param {import('node:test').TestContext} t @param {Partial<import('../packages/service/dist/index.js').HostJobOptions>} [options] */
async function setup(t, options = {}) {
  const f = fixture(undefined, options),
    d = descriptor(),
    server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
      hostJobRoute({ jobs: f.jobs, pins: servicePins, token: Buffer.from(token, 'hex') }),
    ]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    f.jobs.stopAdmission();
    await f.jobs.drain();
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  });
  /** @type {string[]} */ const methods = [];
  /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
  const fetchFn = async (url, init) => {
    methods.push((init?.method ?? 'GET') + ' ' + new URL(url).pathname);
    return fetch(url, /** @type {RequestInit} */ (init));
  };
  return {
    ...f,
    d,
    base,
    methods,
    options: { pins: d.identity.pins, token, timeoutMs: 1500, pollIntervalMs: 1, fetch: fetchFn },
    client: remoteHostJobs(base, {
      pins: d.identity.pins,
      token,
      timeoutMs: 1500,
      pollIntervalMs: 1,
      fetch: fetchFn,
    }),
  };
}
for (const scheme of ['p256-webauthn', 'jubjub-schnorr'])
  test(`browser job ID and identity hashes match host canonical form (${scheme})`, async () => {
    const d = descriptor();
    const i = {
      ...d.identity,
      pins: {
        ...d.identity.pins,
        scheme: /** @type {'p256-webauthn'|'jubjub-schnorr'} */ (scheme),
      },
    };
    const input = { ...d, identity: i };
    assert.equal(await remoteHostJobId(i), hostJobId(input));
  });
test('client acceptance/start/status is asynchronous, identity-bound and observer-safe', async (t) => {
  const f = await setup(t),
    entered = barrier(),
    release = barrier(),
    old = f.driver.prepare;
  f.driver.prepare = async (...args) => {
    entered.release();
    await release.promise;
    return old(...args);
  };
  try {
    const accepted = await f.client.accept(
      f.d.identity,
      /** @type {import('../packages/adapter-service/dist/index.js').RemoteHostJobInput} */ (
        f.d.input
      ),
    );
    assert.equal(accepted.jobId, hostJobId(f.d));
    assert.equal(f.counts().sends, 0);
    await f.client.start(f.d.identity);
    await entered.promise;
    const running = await f.client.get(f.d.identity);
    assert.equal(running?.identitySha256, hostHash(f.d.identity));
    assert.equal(running?.state, 'running');
    const changed = { ...f.d.identity, intentSha256: 'ff'.repeat(32) };
    await assert.rejects(() => f.client.get(changed), { code: 'MutationUnsettled' });
    await assert.rejects(() => f.client.reconcile(changed), { code: 'MutationUnsettled' });
    assert.equal(f.counts().resumes, 0);
    const watched = remoteHostJobs(f.base, {
      ...f.options,
      onSnapshot: (s) => {
        assert.ok(!JSON.stringify(s).includes('append_inbox'));
        /** @type {{state:string}} */ (s).state = 'expired';
      },
    });
    release.release();
    await f.jobs.drain();
    const done = await watched.wait(f.d.identity);
    assert.equal(done?.state, 'done');
    assert.equal(done?.outcome?.digest, f.d.identity.intentSha256);
    assert.equal(f.counts().sends, 1);
    assert.ok(!f.methods.some((p) => p.includes('/reconcile')) || f.counts().resumes === 0);
  } finally {
    release.release();
    await f.jobs.drain();
  }
});
test('ordinary execute does not reconcile unknown results or retry any lost POST reply', async (t) => {
  const f = await setup(t);
  f.visible(false);
  const result = await f.client.execute(
    f.d.identity,
    /** @type {import('../packages/adapter-service/dist/index.js').RemoteHostJobInput} */ (
      f.d.input
    ),
  );
  assert.equal(result?.state, 'unknown');
  assert.equal(f.counts().sends, 1);
  assert.equal(f.counts().resumes, 0);
  assert.equal(f.methods.filter((p) => p.includes('/reconcile')).length, 0);
  f.visible(true);
  const done = await f.client.resume(f.d.identity);
  assert.equal(done?.state, 'done');
  assert.equal(f.counts().sends, 1);
  const d = descriptor(2);
  let calls = 0;
  const lost = remoteHostJobs(f.base, {
    ...f.options,
    fetch: async (url, init) => {
      calls++;
      const response = await fetch(url, /** @type {RequestInit} */ (init));
      await response.json();
      throw new Error('protected lost reply');
    },
  });
  await assert.rejects(
    () =>
      lost.execute(
        d.identity,
        /** @type {import('../packages/adapter-service/dist/index.js').RemoteHostJobInput} */ (
          d.input
        ),
      ),
    { code: 'MutationUnsettled' },
  );
  assert.equal(calls, 1);
  assert.equal((await f.jobs.get(hostJobId(d)))?.state, 'queued');
  assert.equal(f.counts().sends, 1);
  const resumed = await f.client.resume(d.identity);
  assert.equal(resumed?.state, 'done');
  assert.equal(f.counts().sends, 2);
});
test('explicit reconciliation of missing jobs never accepts a replacement', async (t) => {
  const f = await setup(t),
    ports = remoteHostJobPorts(f.base, f.options);
  assert.equal(await f.client.resume(f.d.identity), undefined);
  assert.deepEqual(
    await ports.outcomes.reconcile(f.d.identity.pins, {
      key: f.d.identity.requestId,
      digest: f.d.identity.intentSha256,
      kind: 'call',
      input: {},
    }),
    { kind: 'unknown' },
  );
  assert.ok(f.methods.every((p) => p.startsWith('GET ')));
  assert.equal(f.counts().executions, 0);
});
test('ports preserve tagged submission IDs and return canonical confirmed owner outcomes', async (t) => {
  const f = await setup(t);
  const old = f.driver.prepareStep;
  f.driver.prepareStep = async (...a) => {
    const r = await old(...a);
    return { ...r, identifiers: ['00' + r.identifiers[0]] };
  };
  const ports = remoteHostJobPorts(f.base, f.options);
  const submissionId = await ports.submitter.submit(Uint8Array.of(1), {
    address: 'ab'.repeat(32),
    circuit: 'append_inbox_with_jubjub',
    mutation: { requestId: f.d.identity.requestId, intentSha256: f.d.identity.intentSha256 },
  });
  assert.equal(submissionId.length, 66);
  const answer = await ports.outcomes.reconcile(f.d.identity.pins, {
    key: f.d.identity.requestId,
    digest: f.d.identity.intentSha256,
    kind: 'call',
    input: {},
  });
  assert.deepEqual(answer, {
    kind: 'confirmed',
    digest: f.d.identity.intentSha256,
    result: { txHash: 'ef'.repeat(32) },
  });
});
test('abort during a long polling delay returns promptly and leaves original work alive', async (t) => {
  const f = await setup(t),
    entered = barrier(),
    release = barrier(),
    old = f.driver.prepare;
  f.driver.prepare = async (...a) => {
    entered.release();
    await release.promise;
    return old(...a);
  };
  const controller = new AbortController(),
    seen = barrier();
  const c = remoteHostJobs(f.base, {
    ...f.options,
    pollIntervalMs: 60000,
    onSnapshot: () => seen.release(),
  });
  const work = c.execute(
    f.d.identity,
    /** @type {import('../packages/adapter-service/dist/index.js').RemoteHostJobInput} */ (
      f.d.input
    ),
    controller.signal,
  );
  const refused = assert.rejects(work, { code: 'MutationUnsettled' });
  try {
    await entered.promise;
    await seen.promise;
    controller.abort();
    await refused;
    assert.equal(f.counts().sends, 0);
  } finally {
    release.release();
    await f.jobs.drain();
  }
  assert.equal(f.counts().sends, 1);
  assert.equal((await f.client.resume(f.d.identity))?.state, 'done');
});
test('malformed status, receipt kind/digest, event gaps, and error diagnostics never become success', async (t) => {
  const f = await setup(t);
  await f.client.execute(
    f.d.identity,
    /** @type {import('../packages/adapter-service/dist/index.js').RemoteHostJobInput} */ (
      f.d.input
    ),
  );
  const actual = await f.jobs.get(hostJobId(f.d));
  assert.ok(actual);
  const bad = [
    { ...actual, identitySha256: 'ff'.repeat(32) },
    { ...actual, jobId: 'ff'.repeat(16) },
    { ...actual, cursor: '9007199254740992' },
    { ...actual, cursor: '01' },
    { ...actual, events: [] },
    { ...actual, milestones: { preparedSteps: 2, confirmedSteps: 2 } },
    { ...actual, outcome: { ...actual.outcome, digest: 'ff'.repeat(32) } },
    {
      ...actual,
      outcome: {
        kind: 'confirmed',
        digest: f.d.identity.intentSha256,
        result: { address: 'ab'.repeat(32), txIds: ['ef'.repeat(32)] },
      },
    },
    { ...actual, protected: 'must not be forwarded' },
    {
      ...actual,
      state: 'unknown',
      outcome: undefined,
      error: { code: 'MutationUnsettled', message: 'protected details' },
    },
  ];
  for (const body of bad) {
    const c = remoteHostJobs(f.base, {
      ...f.options,
      fetch: async () => ({ ok: true, status: 200, json: async () => body }),
    });
    await assert.rejects(() => c.get(f.d.identity), { code: 'MutationUnsettled' });
  }
  let reads = 0;
  const refused = remoteHostJobs(f.base, {
    ...f.options,
    fetch: async () => ({
      ok: false,
      status: 503,
      json: async () => {
        reads++;
        throw new Error('private');
      },
    }),
  });
  await assert.rejects(() => refused.get(f.d.identity), { code: 'MutationUnsettled' });
  assert.equal(reads, 0);
});
test('client refuses invalid settings, foreign pins, absent mutation context and conflicting input before effects', async (t) => {
  const f = await setup(t);
  for (const opts of [
    { timeoutMs: 0 },
    { timeoutMs: 2147483648 },
    { pollIntervalMs: -1 },
    { requestTimeoutMs: 0 },
    { token: 'bad' },
  ])
    assert.throws(() => remoteHostJobs(f.base, { ...f.options, ...opts }), {
      code: 'MutationUnsettled',
    });
  await assert.rejects(
    () => f.client.start({ ...f.d.identity, pins: { ...f.d.identity.pins, networkId: 'preview' } }),
    { code: 'MutationUnsettled' },
  );
  await assert.rejects(
    () =>
      f.client.accept(
        f.d.identity,
        /** @type {any} */ ({
          address: 'ab'.repeat(32),
          circuit: 'append_inbox_with_jubjub',
          tx: 'AA',
        }),
      ),
    { code: 'MutationUnsettled' },
  );
  await assert.rejects(
    () => remoteHostJobPorts(f.base, f.options).submitter.submit(Uint8Array.of(1)),
    { code: 'MutationUnsettled' },
  );
  assert.equal(f.methods.length, 0);
});

for (const phase of ['fetch', 'body'])
  test(
    `per-request deadline bounds a custom ${phase} that ignores abort`,
    { timeout: 2000 },
    async () => {
      const d = descriptor();
      let calls = 0;
      const hanging = () => new Promise(() => {});
      const client = remoteHostJobs('http://unused', {
        pins: d.identity.pins,
        token,
        requestTimeoutMs: 20,
        timeoutMs: 1000,
        fetch: async () => {
          calls++;
          if (phase === 'fetch') return hanging();
          return { ok: true, status: 200, json: hanging };
        },
      });
      await assert.rejects(() => client.get(d.identity), { code: 'MutationUnsettled' });
      assert.equal(calls, 1);
    },
  );
for (const phase of ['start', 'reconcile'])
  test(`lost ${phase} reply stops the invocation and never replays a mutating POST`, async (t) => {
    const f = await setup(t);
    /** @type {string[]} */ const paths = [];
    if (phase === 'reconcile') {
      f.visible(false);
      await f.client.execute(
        f.d.identity,
        /** @type {import('../packages/adapter-service/dist/index.js').RemoteHostJobInput} */ (
          f.d.input
        ),
      );
      f.visible(true);
    }
    const client = remoteHostJobs(f.base, {
      ...f.options,
      fetch: async (url, init) => {
        paths.push(new URL(url).pathname);
        const response = await fetch(url, /** @type {RequestInit} */ (init));
        if (url.endsWith('/' + phase)) {
          await response.json();
          throw new Error('lost private reply');
        }
        return response;
      },
    });
    if (phase === 'start')
      await assert.rejects(
        () =>
          client.execute(
            f.d.identity,
            /** @type {import('../packages/adapter-service/dist/index.js').RemoteHostJobInput} */ (
              f.d.input
            ),
          ),
        { code: 'MutationUnsettled' },
      );
    else await assert.rejects(() => client.resume(f.d.identity), { code: 'MutationUnsettled' });
    await f.jobs.drain();
    assert.equal(paths.filter((p) => p.endsWith('/' + phase)).length, 1);
    assert.equal(f.counts().sends, 1);
    assert.equal((await f.client.resume(f.d.identity))?.state, 'done');
    assert.equal(f.counts().sends, 1);
  });
test('detached execute and full invocation identity survive caller mutation after acceptance starts', async (t) => {
  const f = await setup(t),
    entered = barrier(),
    release = barrier();
  const i = structuredClone(f.d.identity),
    saved = structuredClone(i);
  const c = remoteHostJobs(f.base, {
    ...f.options,
    fetch: async (url, init) => {
      if (url.endsWith('/accept')) {
        entered.release();
        await release.promise;
      }
      return fetch(url, /** @type {RequestInit} */ (init));
    },
  });
  const { execute } = c;
  const work = execute(
    i,
    /** @type {import('../packages/adapter-service/dist/index.js').RemoteHostJobInput} */ (
      f.d.input
    ),
  );
  try {
    await entered.promise;
    /** @type {{intentSha256:string}} */ (i).intentSha256 = 'ff'.repeat(32);
    release.release();
    assert.equal((await work)?.state, 'done');
    assert.equal((await f.client.get(saved))?.state, 'done');
  } finally {
    release.release();
    await Promise.allSettled([work]);
  }
});

test(
  'a slow explicit reconciliation may still report unknown; later GET collects its outcome without another POST',
  { timeout: 5000 },
  async (t) => {
    const f = await setup(t);
    f.visible(false);
    await f.client.execute(
      f.d.identity,
      /** @type {import('../packages/adapter-service/dist/index.js').RemoteHostJobInput} */ (
        f.d.input
      ),
    );
    f.visible(true);
    const entered = barrier(),
      release = barrier(),
      old = f.driver.lookup;
    f.driver.lookup = async (...args) => {
      entered.release();
      await release.promise;
      return old(...args);
    };
    const resumed = f.client.resume(f.d.identity);
    try {
      await entered.promise;
      assert.equal((await resumed)?.state, 'unknown');
      assert.equal(f.counts().sends, 1);
    } finally {
      release.release();
      await Promise.allSettled([resumed]);
      await f.jobs.drain();
    }
    const posts = f.methods.filter((p) => p.startsWith('POST ')).length;
    assert.equal((await f.client.get(f.d.identity))?.state, 'done');
    assert.equal(f.methods.filter((p) => p.startsWith('POST ')).length, posts);
  },
);

test('expired results retain identity without a continuation POST, and stale cursor refuses without reset', async (t) => {
  const f = await setup(t, { completedTtlMs: 0 });
  await f.client.accept(
    f.d.identity,
    /** @type {import('../packages/adapter-service/dist/index.js').RemoteHostJobInput} */ (
      f.d.input
    ),
  );
  await f.client.start(f.d.identity);
  await f.jobs.drain();
  const before = f.methods.length;
  const expired = await f.client.resume(f.d.identity);
  assert.equal(expired?.state, 'expired');
  assert.equal(expired?.outcome, undefined);
  assert.ok(f.methods.slice(before).every((p) => p.startsWith('GET ')));
  const ring = await setup(t, { eventLimit: 1 });
  await ring.client.execute(
    ring.d.identity,
    /** @type {import('../packages/adapter-service/dist/index.js').RemoteHostJobInput} */ (
      ring.d.input
    ),
  );
  await assert.rejects(() => ring.client.get(ring.d.identity, undefined, '0'), {
    code: 'MutationUnsettled',
  });
  const latest = await ring.client.get(ring.d.identity);
  assert.equal(latest?.state, 'done');
  assert.equal(latest?.events.length, 1);
  assert.deepEqual((await ring.client.get(ring.d.identity, undefined, latest?.cursor))?.events, []);
});
