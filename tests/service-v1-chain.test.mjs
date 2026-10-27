import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chainRoute,
  createDeploymentBudget,
  createMemoryJobStore,
  createServer,
  jobsRoute,
  serial,
  v1ChainRoute,
} from '../packages/service/dist/index.js';

const byte = (/** @type {number} */ value) => Uint8Array.of(value);

test('v1 prove and deploy return pollable jobs; fee routes retain synchronous wire results', async (t) => {
  /** @type {string[]} */
  const calls = [];
  /** @type {import('../packages/service/dist/index.js').ChainBackend} */
  const backend = {
    check: async () => [],
    prove: async () => byte(1),
    proveTx: async () => {
      calls.push('prove');
      return byte(2);
    },
    balance: async () => {
      calls.push('balance');
      return byte(3);
    },
    submit: async () => 'submission-1',
    deploy: async (_boot, _key, retire, arm) => {
      calls.push(`${retire}:${arm}`);
      return { address: 'ab'.repeat(32), txHashes: ['wave-1'] };
    },
    sponsorKeys: () => ({ coinPublicKey: '00', encryptionPublicKey: '11' }),
  };
  let nextId = 0;
  const jobs = createMemoryJobStore({ newId: () => `job-${++nextId}` });
  const deploymentBudget = createDeploymentBudget(1);
  const runExclusive = serial(8);
  const server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
    jobsRoute(jobs),
    v1ChainRoute(backend, { jobs, deploymentBudget, runExclusive, log: () => {} }),
    chainRoute(backend, {
      circuits: new Set(),
      maxDeploys: 1,
      deploymentBudget,
      runExclusive,
      log: () => {},
    }),
  ]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (/** @type {string} */ path, /** @type {Record<string, unknown>} */ body) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const result = async (/** @type {string} */ id) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await fetch(`${base}/v1/jobs/${id}`);
      assert.equal(response.status, 200);
      const body =
        /** @type {{state: string, result?: unknown, events: {step: string, phase: string, clock: string}[]}} */ (
          await response.json()
        );
      if (body.state === 'done' || body.state === 'failed') return body;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail('job did not finish');
  };

  const prove = await post('/v1/prove-tx', { tx: '01' });
  assert.equal(prove.status, 202);
  const proven = await result(/** @type {{jobId: string}} */ (await prove.json()).jobId);
  assert.deepEqual(proven.result, { tx: '02' });
  assert.deepEqual(
    proven.events.map((event) => [event.step, event.phase, event.clock]),
    [
      ['prove', 'start', 'service'],
      ['prove', 'end', 'service'],
    ],
  );
  const deploy = await post('/v1/deploy', {
    boot: '01'.repeat(32),
    encKey: '02'.repeat(32),
    retireAuthority: true,
    firstArm: 'jubjub',
  });
  assert.equal(deploy.status, 202);
  assert.deepEqual(
    (await result(/** @type {{jobId: string}} */ (await deploy.json()).jobId)).result,
    {
      address: 'ab'.repeat(32),
      txIds: ['wave-1'],
    },
  );
  assert.equal(
    (
      await post('/deploy', {
        boot: '01'.repeat(32),
        encKey: '02'.repeat(32),
        retireAuthority: true,
      })
    ).status,
    429,
  );
  assert.deepEqual(await (await post('/v1/sponsor/balance', { tx: '01' })).json(), { tx: '03' });
  assert.deepEqual(await (await post('/v1/sponsor/submit', { tx: '03' })).json(), {
    txId: 'submission-1',
  });
  assert.deepEqual(calls, ['prove', 'true:jubjub', 'balance']);
});

test('v1 routes reject malformed inputs before work and sanitize a failed proof job', async (t) => {
  /** @type {import('../packages/service/dist/index.js').ChainBackend} */
  const backend = {
    check: async () => [],
    prove: async () => byte(1),
    proveTx: async () => {
      throw new Error('private proof-server detail');
    },
    balance: async () => byte(1),
    submit: async () => 'ok',
    deploy: async () => ({ address: 'ab'.repeat(32), txHashes: [] }),
    sponsorKeys: () => ({ coinPublicKey: '00', encryptionPublicKey: '11' }),
  };
  const jobs = createMemoryJobStore({ newId: () => 'failed-job' });
  const server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
    jobsRoute(jobs),
    v1ChainRoute(backend, { jobs, deploymentBudget: createDeploymentBudget(1), log: () => {} }),
  ]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (/** @type {string} */ path, /** @type {Record<string, unknown>} */ body) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal((await post('/v1/prove-tx', { tx: 'not-hex' })).status, 400);
  assert.equal(
    (await post('/v1/deploy', { boot: '00', encKey: '11', retireAuthority: true })).status,
    400,
  );
  const accepted = await post('/v1/prove-tx', { tx: '01' });
  assert.equal(accepted.status, 202);
  await new Promise((resolve) => setImmediate(resolve));
  const polled = /** @type {{state: string, error: unknown, events: {phase: string}[]}} */ (
    await (await fetch(`${base}/v1/jobs/failed-job`)).json()
  );
  assert.equal(polled.state, 'failed');
  assert.deepEqual(polled.error, { code: 'ProverUnavailable', message: 'prove failed' });
  assert.deepEqual(
    polled.events.map((event) => event.phase),
    ['start', 'error'],
  );
  assert.equal(JSON.stringify(polled).includes('private proof-server detail'), false);
});

test(
  'legacy and v1 balance/submit operations respect the shared sponsor queue',
  { timeout: 5000 },
  async (t) => {
    let release = () => {};
    const blocked = new Promise((resolve) => {
      release = () => resolve(undefined);
    });
    const runExclusive = serial(8);
    const held = runExclusive(() => blocked);
    /** @type {string[]} */ const calls = [];
    /** @type {import('../packages/service/dist/index.js').ChainBackend} */
    const backend = {
      check: async () => [],
      prove: async () => byte(1),
      proveTx: async () => byte(1),
      balance: async () => {
        calls.push('balance');
        return byte(1);
      },
      submit: async () => {
        calls.push('submit');
        return 'submission';
      },
      deploy: async () => ({ address: 'ab'.repeat(32), txHashes: [] }),
      sponsorKeys: () => ({ coinPublicKey: '', encryptionPublicKey: '' }),
    };
    const budget = createDeploymentBudget(1),
      jobs = createMemoryJobStore();
    t.after(async () => {
      release();
      await held;
    });
    // Observe actual queue admission, without assuming network arrival order or sleeping.
    const entered = new Set();
    let all = () => {};
    const queued = new Promise((r) => {
      all = () => r(undefined);
    });
    const instrumented = /** @type {typeof runExclusive} */ (
      async (work) => {
        const promise = runExclusive(work);
        entered.add(promise);
        if (entered.size === 4) all();
        return promise;
      }
    );
    const live = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
      v1ChainRoute(backend, { jobs, deploymentBudget: budget, runExclusive: instrumented }),
      chainRoute(backend, {
        circuits: new Set(),
        maxDeploys: 1,
        deploymentBudget: budget,
        runExclusive: instrumented,
      }),
    ]);
    await new Promise((r) => live.listen(0, '127.0.0.1', () => r(undefined)));
    const a = live.address();
    assert.ok(a && typeof a === 'object');
    t.after(
      () =>
        new Promise((r) => {
          live.close(r);
          live.closeAllConnections();
        }),
    );
    const requests = [
      '/sponsor/balance',
      '/sponsor/submit',
      '/v1/sponsor/balance',
      '/v1/sponsor/submit',
    ].map((path) =>
      fetch(`http://127.0.0.1:${a.port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tx: '01' }),
      }),
    );
    try {
      await queued;
      assert.deepEqual(calls, []);
      release();
      await held;
      for (const response of await Promise.all(requests)) assert.equal(response.status, 200);
      assert.equal(calls.filter((c) => c === 'balance').length, 2);
      assert.equal(calls.filter((c) => c === 'submit').length, 2);
    } finally {
      release();
      await Promise.allSettled(requests);
    }
  },
);
