import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  remoteV1Deployer,
  remoteV1Prover,
  remoteV1Sponsor,
} from '../packages/adapter-service/dist/index.js';
import {
  createDeploymentBudget,
  createMemoryJobStore,
  createServer,
  jobsRoute,
  v1ChainRoute,
} from '../packages/service/dist/index.js';

test('v1 clients consume the reference service jobs, progress and sponsor results', async (t) => {
  /** @type {import('../packages/service/dist/index.js').ChainBackend} */
  const backend = {
    check: async () => [],
    prove: async () => Uint8Array.of(1),
    proveTx: async (tx) => Uint8Array.of((tx[0] ?? 0) + 1),
    balance: async (tx) => Uint8Array.of((tx[0] ?? 0) + 2),
    submit: async () => 'submitted',
    deploy: async () => ({ address: 'ab'.repeat(32), txHashes: ['wave-1'] }),
    sponsorKeys: () => ({ coinPublicKey: '00', encryptionPublicKey: '11' }),
  };
  let job = 0;
  const jobs = createMemoryJobStore({ newId: () => `job-${++job}` });
  const server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
    jobsRoute(jobs),
    v1ChainRoute(backend, { jobs, deploymentBudget: createDeploymentBudget(2), log: () => {} }),
  ]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;

  /** @type {import('../packages/protocol/dist/index.js').PassportEvent[]} */
  const events = [];
  const options = { pollIntervalMs: 0, timeoutMs: 10_000 };
  const proved = await remoteV1Prover(base, options).proveTx(Uint8Array.of(1), {
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    circuits: ['rotate_enc_key_with_p256'],
    onEvent: (event) => events.push(event),
  });
  assert.deepEqual(proved, { tx: Uint8Array.of(2), provenance: 'remote' });
  assert.deepEqual(
    events.map((event) => [event.step, event.phase, event.clock]),
    [
      ['prove', 'start', 'service'],
      ['prove', 'end', 'service'],
    ],
  );

  const deployed = await remoteV1Deployer(base, options).deploy({
    boot: new Uint8Array(32).fill(1),
    encKey: new Uint8Array(32).fill(2),
    retireAuthority: true,
    firstArm: 'jubjub',
  });
  assert.deepEqual(deployed, { address: 'ab'.repeat(32), txIds: ['wave-1'] });
  const sponsor = remoteV1Sponsor(base, options);
  assert.deepEqual(await sponsor.balanceAndSign(Uint8Array.of(3)), Uint8Array.of(5));
  assert.equal(await sponsor.submit(Uint8Array.of(5)), 'submitted');
});

test('v1 clients propagate service job failures and abort before submission', async () => {
  /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
  const failed = async (url, init) => {
    if (init?.method === 'POST')
      return { ok: true, status: 202, json: async () => ({ jobId: 'job-1' }) };
    assert.equal(url, 'http://service/v1/jobs/job-1?after=0');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        state: 'failed',
        events: [
          {
            id: 'step',
            flowId: 'flow',
            step: 'prove',
            phase: 'error',
            at: 1,
            clock: 'service',
            secret: 'hidden',
          },
        ],
        cursor: '1',
        error: { code: 'ProverUnavailable', message: 'proof failed' },
      }),
    };
  };
  /** @type {import('../packages/protocol/dist/index.js').PassportEvent[]} */
  const events = [];
  await assert.rejects(
    remoteV1Prover('http://service', { fetch: failed, pollIntervalMs: 0 }).proveTx(
      Uint8Array.of(1),
      {
        networkId: 'undeployed',
        bindingId: 'acc-s3r1.1',
        circuits: [],
        onEvent: (event) => events.push(event),
      },
    ),
    { code: 'ProverUnavailable', message: 'proof failed' },
  );
  assert.equal(JSON.stringify(events).includes('hidden'), false);
  let calls = 0;
  /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
  const counted = async () => {
    calls++;
    throw new Error('unreachable');
  };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    remoteV1Deployer('http://service', { fetch: counted }).deploy({
      boot: new Uint8Array(32),
      encKey: new Uint8Array(32),
      retireAuthority: true,
      signal: controller.signal,
    }),
    { code: 'Aborted' },
  );
  assert.equal(calls, 0);
  /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
  const proxyHtml = async () => ({
    ok: false,
    status: 502,
    json: async () => {
      throw new Error('HTML');
    },
  });
  await assert.rejects(
    remoteV1Prover('http://service', { fetch: proxyHtml }).proveTx(Uint8Array.of(1), {
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      circuits: [],
    }),
    { code: 'ProverUnavailable' },
  );
});

test('v1 prove retries an interrupted poll with the same cursor and never resubmits', async () => {
  /** @type {[string, string][]} */
  const calls = [];
  /** @type {import('../packages/protocol/dist/index.js').PassportEvent[]} */
  const events = [];
  /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
  const fetch = async (url, init) => {
    calls.push([url, init?.method ?? 'GET']);
    if (init?.method === 'POST')
      return { ok: true, status: 202, json: async () => ({ jobId: 'job-1' }) };
    if (calls.length === 2) throw new Error('read ECONNRESET');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        state: 'done',
        cursor: '1',
        events: [
          { id: 'proof', flowId: 'flow', step: 'prove', phase: 'end', at: 1, clock: 'service' },
        ],
        result: { tx: '02' },
      }),
    };
  };
  const proved = await remoteV1Prover('http://service', {
    fetch,
    pollIntervalMs: 0,
    timeoutMs: 10_000,
  }).proveTx(Uint8Array.of(1), {
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    circuits: [],
    onEvent: (event) => events.push(event),
  });
  assert.deepEqual(proved.tx, Uint8Array.of(2));
  assert.deepEqual(calls, [
    ['http://service/v1/prove-tx', 'POST'],
    ['http://service/v1/jobs/job-1?after=0', 'GET'],
    ['http://service/v1/jobs/job-1?after=0', 'GET'],
  ]);
  assert.equal(events.length, 1);
});

test('v1 polling stops after a bounded run of unreachable responses', async () => {
  let submissions = 0;
  let polls = 0;
  /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
  const fetch = async (_url, init) => {
    if (init?.method === 'POST') {
      submissions++;
      return { ok: true, status: 202, json: async () => ({ jobId: 'job-1' }) };
    }
    polls++;
    throw new Error('read ECONNRESET');
  };
  await assert.rejects(
    remoteV1Prover('http://service', { fetch, pollIntervalMs: 0, timeoutMs: 10_000 }).proveTx(
      Uint8Array.of(1),
      { networkId: 'undeployed', bindingId: 'acc-s3r1.1', circuits: [] },
    ),
    { code: 'ProverUnavailable', message: '/v1/prove-tx: service unreachable' },
  );
  assert.equal(submissions, 1);
  assert.equal(polls, 4);
});
