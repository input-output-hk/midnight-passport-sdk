import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { configuredHostMutations } from '../src/host-config.ts';
import { serviceShutdown } from '../src/shutdown.ts';
import {
  createServer,
  createDeploymentBudget,
  serial,
  hostHash,
  type HostMutationDriver,
  type HostJobDescriptor,
  type HostJobView,
} from '@input-output-hk/mn-passport-service';
import { testConfig } from './fixtures.ts';
const pins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  scheme: 'jubjub-schnorr' as const,
};
const token = '44'.repeat(32),
  directToken = '22'.repeat(32);
const gate = () => {
  let release = () => {};
  return {
    promise: new Promise<void>((r) => {
      release = r;
    }),
    release: () => release(),
  };
};
const descriptor = (n = 1, kind: 'deploy' | 'call' = 'call'): HostJobDescriptor => ({
  version: 1,
  identity: {
    pins,
    kind,
    requestId: n.toString(16).padStart(32, '0') + ':0',
    intentSha256: 'aa'.repeat(32),
  },
  input:
    kind === 'call'
      ? { address: 'ab'.repeat(32), circuit: 'append_inbox_with_jubjub', tx: '01' }
      : {
          boot: 'ab'.repeat(32),
          encKey: 'cd'.repeat(32),
          retireAuthority: true,
          firstArm: 'jubjub',
        },
});
function setupFiles() {
  const root = mkdtempSync(join(tmpdir(), 'passport-configured-jobs-'));
  for (const [name, value] of Object.entries({
    hostKey: '11',
    hostToken: '22',
    jobKey: '33',
    jobToken: '44',
  }))
    writeFileSync(join(root, name), value.repeat(32), { mode: 0o600 });
  const env = {
    PASSPORT_HOST_MUTATION_DIR: join(root, 'host'),
    PASSPORT_HOST_MUTATION_KEY_FILE: join(root, 'hostKey'),
    PASSPORT_HOST_MUTATION_TOKEN_FILE: join(root, 'hostToken'),
    PASSPORT_HOST_JOB_DIR: join(root, 'jobs'),
    PASSPORT_HOST_JOB_KEY_FILE: join(root, 'jobKey'),
    PASSPORT_HOST_JOB_TOKEN_FILE: join(root, 'jobToken'),
  };
  const config = testConfig({ ...pins });
  return {
    root,
    env,
    config,
    clean: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(config.artefactDir, { recursive: true, force: true });
    },
  };
}
function fakeDriver() {
  let sends = 0;
  const receipts = new Set<string>();
  const driver: HostMutationDriver = {
    prepare: async (i) => ({
      address: 'ab'.repeat(32),
      steps: i.kind === 'deploy' ? 2 : 1,
      context: {},
    }),
    prepareStep: async (r, index) => ({
      tx: '01',
      identifiers: [hostHash({ id: r.identity.requestId, index })],
    }),
    submit: async (p) => {
      sends++;
      receipts.add(p.identifiers[0]!);
      return p.identifiers[0]!;
    },
    lookup: async (p) =>
      receipts.has(p.identifiers[0]!)
        ? { identifier: p.identifiers[0]!, txHash: 'ef'.repeat(32), succeeded: true }
        : undefined,
    check: async () => true,
  };
  return { driver, sends: () => sends };
}
test('reference configuration requires independent private job settings, disjoint roots and bounded limits', async () => {
  const f = setupFiles(),
    { driver } = fakeDriver(),
    run = serial(8),
    noop = () => {};
  try {
    const partial = { ...f.env };
    delete (partial as Partial<typeof partial>).PASSPORT_HOST_JOB_TOKEN_FILE;
    assert.throws(() => configuredHostMutations(f.config, driver, partial, run, noop), /all three/);
    for (const env of [
      { ...f.env, PASSPORT_HOST_JOB_DIR: f.env.PASSPORT_HOST_MUTATION_DIR },
      { ...f.env, PASSPORT_HOST_JOB_DIR: join(f.env.PASSPORT_HOST_MUTATION_DIR, 'nested') },
    ])
      assert.throws(() => configuredHostMutations(f.config, driver, env, run, noop), /non-nested/);
    symlinkSync(f.root, join(f.root, 'alias'));
    assert.throws(
      () =>
        configuredHostMutations(
          f.config,
          driver,
          { ...f.env, PASSPORT_HOST_JOB_DIR: join(f.root, 'alias', 'host') },
          run,
          noop,
        ),
      /non-nested/,
    );
    for (const key of [
      'PASSPORT_HOST_JOB_MAX_JOBS',
      'PASSPORT_HOST_JOB_MAX_ACTIVE',
      'PASSPORT_HOST_JOB_EVENT_LIMIT',
      'PASSPORT_HOST_JOB_COMPLETED_TTL_MS',
    ])
      for (const value of ['-1', '1.5', '9007199254740992', ''])
        assert.throws(
          () => configuredHostMutations(f.config, driver, { ...f.env, [key]: value }, run, noop),
          /Invalid/,
        );
    writeFileSync(f.env.PASSPORT_HOST_JOB_KEY_FILE, '11'.repeat(32));
    assert.throws(() => configuredHostMutations(f.config, driver, f.env, run, noop), /independent/);
    writeFileSync(f.env.PASSPORT_HOST_JOB_KEY_FILE, f.config.sponsorSeed);
    assert.throws(() => configuredHostMutations(f.config, driver, f.env, run, noop), /independent/);
    writeFileSync(f.env.PASSPORT_HOST_JOB_KEY_FILE, '33'.repeat(32));
    chmodSync(f.env.PASSPORT_HOST_JOB_TOKEN_FILE, 0o644);
    assert.throws(() => configuredHostMutations(f.config, driver, f.env, run, noop), /private/);
    chmodSync(f.env.PASSPORT_HOST_JOB_TOKEN_FILE, 0o600);
    const host = configuredHostMutations(f.config, driver, f.env, run, noop);
    assert.equal(host?.hostJobs, true);
    await host?.close();
  } finally {
    f.clean();
  }
});
test(
  'host jobs and direct mutation RPC share deployment policy, executor and wallet serialization',
  { timeout: 10000 },
  async (t) => {
    const f = setupFiles(),
      fake = fakeDriver(),
      run = serial(8),
      budget = createDeploymentBudget(1);
    const host = configuredHostMutations(f.config, fake.driver, f.env, run, () => budget.accept());
    assert.ok(host);
    const server = createServer(f.config, [host]);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const a = server.address();
    assert.ok(a && typeof a === 'object');
    const base = `http://127.0.0.1:${a.port}`;
    const request = (path: string, body?: unknown, auth = token) =>
      fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${auth}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    t.after(async () => {
      await serviceShutdown(server, host, run)();
      f.clean();
    });
    const d = descriptor(1, 'deploy');
    assert.equal((await request('/v1/host-jobs/accept', d, directToken)).status, 401);
    const accepted = await request('/v1/host-jobs/accept', d);
    assert.equal(accepted.status, 202);
    const { jobId } = (await accepted.json()) as { jobId: string };
    const blocker = gate(),
      entered = gate();
    const occupied = run(async () => {
      entered.release();
      await blocker.promise;
    });
    await entered.promise;
    try {
      assert.equal(
        (await request('/v1/host-jobs/start', { jobId, identitySha256: hostHash(d.identity) }))
          .status,
        202,
      );
      assert.equal(fake.sends(), 0);
      const direct = request(
        '/v1/mutations/execute',
        { identity: d.identity, input: d.input },
        directToken,
      );
      blocker.release();
      await occupied;
      assert.equal((await direct).status, 200);
      await host.drain();
      const done = (await (await request(`/v1/host-jobs/${jobId}`)).json()) as HostJobView;
      assert.equal(done.state, 'done');
      assert.equal(fake.sends(), 2);
      assert.equal(
        (
          await request(
            '/v1/mutations/execute',
            { identity: descriptor(2, 'deploy').identity, input: d.input },
            directToken,
          )
        ).status,
        409,
      );
      assert.equal(fake.sends(), 2);
      const next = (await (
        await request('/v1/host-jobs/accept', descriptor(3, 'deploy'))
      ).json()) as { jobId: string };
      await request('/v1/host-jobs/start', next);
      await host.drain();
      assert.equal(
        ((await (await request(`/v1/host-jobs/${next.jobId}`)).json()) as HostJobView).state,
        'unknown',
      );
      assert.equal(fake.sends(), 2);
    } finally {
      blocker.release();
      await occupied;
    }
  },
);
test(
  'shutdown drains accepted jobs and legacy queued wallet work before key close',
  { timeout: 10000 },
  async () => {
    const f = setupFiles(),
      fake = fakeDriver(),
      run = serial(8),
      held = gate(),
      entered = gate(),
      old = fake.driver.prepare;
    fake.driver.prepare = async (...args) => {
      entered.release();
      await held.promise;
      return old(...args);
    };
    const host = configuredHostMutations(f.config, fake.driver, f.env, run, () => {});
    assert.ok(host);
    const server = createServer(f.config, [host]);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const a = server.address();
    assert.ok(a && typeof a === 'object');
    const base = `http://127.0.0.1:${a.port}/v1/host-jobs/`;
    const post = (p: string, b: unknown) =>
      fetch(base + p, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(b),
      });
    try {
      const accepted = (await (await post('accept', descriptor())).json()) as { jobId: string };
      await post('start', accepted);
      await entered.promise;
      let queued = false,
        finished = false;
      const legacy = run(async () => {
        queued = true;
      });
      const stop = serviceShutdown(server, host, run);
      const draining = stop().then(() => {
        finished = true;
      });
      assert.equal(stop(), stop());
      await new Promise<void>((r) => setImmediate(r));
      assert.equal(finished, false);
      assert.equal(queued, false);
      held.release();
      await draining;
      await legacy;
      assert.equal(fake.sends(), 1);
      assert.equal(queued, true);
      const reopened = configuredHostMutations(f.config, fake.driver, f.env, run, () => {});
      assert.ok(reopened);
      await reopened.close();
    } finally {
      held.release();
      await host.close();
      if (server.listening) await new Promise<void>((r) => server.close(() => r()));
      f.clean();
    }
  },
);

test(
  'shutdown drains a completely full wallet queue without reserving another slot',
  { timeout: 3000 },
  async () => {
    const run = serial(0),
      held = gate(),
      entered = gate();
    let finished = false;
    const work = run(async () => {
      entered.release();
      await held.promise;
      finished = true;
    });
    await entered.promise;
    const server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, []);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const stop = serviceShutdown(server, undefined, run);
    let done = false;
    const draining = stop().then(() => {
      done = true;
    });
    try {
      await new Promise<void>((r) => setImmediate(r));
      assert.equal(done, false);
      assert.equal(finished, false);
      held.release();
      await draining;
      await work;
      assert.equal(finished, true);
      assert.equal(done, true);
    } finally {
      held.release();
      await work;
      if (server.listening) await new Promise<void>((r) => server.close(() => r()));
    }
  },
);
