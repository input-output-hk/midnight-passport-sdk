import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { requestV1Job } from '../packages/adapter-service/dist/v1-jobs.js';
import { remoteV1Prover, remoteV1Deployer } from '../packages/adapter-service/dist/index.js';

/** @typedef {import('../packages/account/dist/ports/index.js').FetchLike} FetchLike */
/** @template T @returns {{promise:Promise<T>,resolve:(value:T)=>void,reject:(reason:unknown)=>void}} */
function deferred() {
  /** @type {(value:T)=>void} */ let resolve = () => {};
  /** @type {(reason:unknown)=>void} */ let reject = () => {};
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
/** @param {unknown} value @param {number} [status] */
const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const event = { id: 'one', flowId: 'flow', step: 'prove', phase: 'end', at: 1, clock: 'service' };
/** @param {unknown} [result] */
const done = (result = { tx: '02' }) => ({ state: 'done', cursor: '1', events: [event], result });
/** @param {FetchLike} fetch @param {number} [timeoutMs] @param {AbortSignal} [signal] @param {(event:import('../packages/protocol/dist/index.js').PassportEvent)=>void} [onEvent] */
const request = (fetch, timeoutMs = 1000, signal, onEvent) =>
  requestV1Job(
    'http://synthetic.invalid/',
    '/v1/prove-tx',
    { tx: '01' },
    'prover',
    { fetch, timeoutMs, pollIntervalMs: 0 },
    signal,
    onEvent,
  );
/** @param {Promise<unknown>} task @returns {Promise<unknown>} */
async function bounded(task) {
  let timer;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Synthetic caller did not settle')), 1500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

for (const stall of ['headers', 'accepted-body', 'poll-body']) {
  test(`V1 total deadline settles uncooperative ${stall} without replay`, async () => {
    let calls = 0;
    /** @type {import('../packages/account/dist/ports/index.js').FetchAbortSignal|undefined} */ let wire;
    /** @type {FetchLike} */ const fetch = async (_url, init) => {
      calls++;
      wire = init?.signal;
      if (stall === 'headers') return new Promise(() => {});
      if (stall === 'accepted-body' || calls > 1)
        return { ok: true, status: calls === 1 ? 202 : 200, json: () => new Promise(() => {}) };
      return json({ jobId: 'job' }, 202);
    };
    await assert.rejects(bounded(request(fetch, 20)), {
      code: 'ProverUnavailable',
      message: '/v1/prove-tx: job timed out',
    });
    assert.equal(calls, stall === 'poll-body' ? 2 : 1);
    assert.equal(wire?.aborted, true);
  });
}

test('V1 caller abort after headers settles body stall and detaches caller listener', async () => {
  const controller = new AbortController();
  let added = 0,
    removed = 0,
    calls = 0;
  const signal = {
    get aborted() {
      return controller.signal.aborted;
    },
    addEventListener(/** @type {'abort'} */ type, /** @type {()=>void} */ listener) {
      added++;
      controller.signal.addEventListener(type, listener);
    },
    removeEventListener(/** @type {'abort'} */ type, /** @type {()=>void} */ listener) {
      removed++;
      controller.signal.removeEventListener(type, listener);
    },
  };
  const headers = deferred();
  const task = requestV1Job(
    'http://synthetic.invalid',
    '/v1/deploy',
    {},
    'sponsor',
    {
      timeoutMs: 1000,
      fetch: async () => {
        calls++;
        headers.resolve(undefined);
        return { ok: true, status: 202, json: () => new Promise(() => {}) };
      },
    },
    signal,
  );
  await headers.promise;
  controller.abort();
  await assert.rejects(bounded(task), { code: 'Aborted' });
  assert.equal(calls, 1);
  assert.equal(added, 1);
  assert.equal(removed, 1);
});

test('V1 registration-time abort refuses before dispatch', async () => {
  let calls = 0,
    removed = 0;
  const signal = {
    aborted: false,
    addEventListener(/** @type {'abort'} */ _type, /** @type {()=>void} */ listener) {
      this.aborted = true;
      listener();
    },
    removeEventListener() {
      removed++;
    },
  };
  await assert.rejects(
    requestV1Job(
      'http://synthetic.invalid',
      '/v1/deploy',
      {},
      'sponsor',
      {
        fetch: async () => {
          calls++;
          return json({});
        },
      },
      signal,
    ),
    { code: 'Aborted' },
  );
  assert.equal(calls, 0);
  assert.equal(removed, 1);
});

test('V1 late headers are cancelled without reading JSON, including rejecting cancel', async () => {
  const headers = deferred();
  let reads = 0,
    cancels = 0,
    releases = 0;
  /** @type {FetchLike} */ const fetch = () => headers.promise;
  await assert.rejects(bounded(request(fetch, 15)), { code: 'ProverUnavailable' });
  headers.resolve({
    ok: true,
    status: 202,
    json: async () => {
      reads++;
      return { jobId: 'late' };
    },
    body: {
      getReader() {
        return {
          read: () => new Promise(() => {}),
          cancel: async () => {
            cancels++;
            throw Error('late cancel');
          },
          releaseLock() {
            releases++;
          },
        };
      },
    },
  });
  await delay(10);
  assert.equal(reads, 0);
  assert.equal(cancels, 1);
  assert.equal(releases, 1);
});

test('V1 late body and fetch rejections remain observed and cannot emit progress', async () => {
  for (const phase of ['headers', 'body']) {
    const losing = deferred();
    let calls = 0,
      emitted = 0;
    /** @type {FetchLike} */ const fetch = () => {
      calls++;
      return phase === 'headers'
        ? losing.promise
        : Promise.resolve({ ok: true, status: 202, json: () => losing.promise });
    };
    await assert.rejects(
      bounded(
        request(fetch, 15, undefined, () => {
          emitted++;
        }),
      ),
      { code: 'ProverUnavailable' },
    );
    losing.reject(Error('late host rejection'));
    await delay(5);
    assert.equal(calls, 1);
    assert.equal(emitted, 0);
  }
});

test('V1 owns native reader cancellation even when its cancel never settles', async () => {
  let cancels = 0;
  const body = new ReadableStream({
    cancel() {
      cancels++;
      return new Promise(() => {});
    },
  });
  const response = new Response(body, { status: 202 });
  await assert.rejects(bounded(request(async () => response, 20)), { code: 'ProverUnavailable' });
  assert.equal(cancels, 1);
  assert.equal(body.locked, false);
});

test('V1 malformed native JSON and throwing reader hooks refuse without polling', async () => {
  for (const response of [
    new Response('{', { status: 202 }),
    {
      ok: true,
      status: 202,
      json: async () => ({ jobId: 'bad' }),
      body: {
        getReader() {
          throw Error('locked');
        },
      },
    },
  ]) {
    let calls = 0;
    await assert.rejects(
      request(async () => {
        calls++;
        return response;
      }),
      { code: 'InternalError' },
    );
    assert.equal(calls, 1);
  }
});

for (const bad of [
  { ...done(), events: [event, { ...event, clock: 'private' }], cursor: '2' },
  { ...done(), state: 'mystery' },
  { ...done(), cursor: '01' },
  { ...done(), cursor: '2' },
  { ...done(), cursor: '9007199254740992' },
  { ...done(), result: null },
  { state: 'failed', cursor: '1', events: [event], error: { code: 'InternalError' } },
  { ...done(), events: Array(1) },
]) {
  test(`V1 validates whole batch before callbacks: ${JSON.stringify(bad).slice(0, 100)}`, async () => {
    let calls = 0,
      events = 0;
    await assert.rejects(
      request(
        async () => (++calls === 1 ? json({ jobId: 'job' }, 202) : json(bad)),
        1000,
        undefined,
        () => {
          events++;
        },
      ),
      { code: 'InternalError' },
    );
    assert.equal(calls, 2);
    assert.equal(events, 0);
  });
}

test('V1 observer remains synchronous, public-only, and its async rejection is consumed', async () => {
  let calls = 0;
  /** @type {string[]} */ const order = [];
  const result = await request(
    async () =>
      ++calls === 1
        ? json({ jobId: 'job' }, 202)
        : json({
            ...done(),
            events: [{ ...event, secret: 'private', detail: { wave: 1, secret: 'private' } }],
          }),
    1000,
    undefined,
    (progress) => {
      order.push('event');
      assert.equal(JSON.stringify(progress).includes('private'), false);
      return Promise.reject(Error('async observer'));
    },
  );
  order.push('result');
  await delay(5);
  assert.deepEqual(order, ['event', 'result']);
  assert.deepEqual(result, { tx: '02' });
});

test('V1 synchronous observer throw stops immediately; callback abort prevents another event/result', async () => {
  for (const abort of [false, true]) {
    const controller = new AbortController();
    let calls = 0,
      events = 0;
    const task = request(
      async () =>
        ++calls === 1
          ? json({ jobId: 'job' }, 202)
          : json({ ...done(), cursor: '2', events: [event, event] }),
      1000,
      controller.signal,
      () => {
        events++;
        if (abort) controller.abort();
        else throw Error('observer failed');
      },
    );
    await assert.rejects(task, abort ? { code: 'Aborted' } : /observer failed/);
    assert.equal(events, 1);
    assert.equal(calls, 2);
  }
});

test('V1 total deadline is rechecked after blocking observer code', async () => {
  let calls = 0;
  await assert.rejects(
    request(
      async () => (++calls === 1 ? json({ jobId: 'job' }, 202) : json(done())),
      20,
      undefined,
      () => {
        const end = performance.now() + 30;
        while (performance.now() < end) {
          /* Deliberate owned synchronous host stall. */
        }
      },
    ),
    { code: 'ProverUnavailable' },
  );
});

test('V1 backoff is abortable and preserves the same cursor without POST replay', async () => {
  const controller = new AbortController(),
    failedPoll = deferred();
  let posts = 0,
    polls = 0;
  const task = request(
    async (_url, init) => {
      if (init?.method === 'POST') {
        posts++;
        return json({ jobId: 'job' }, 202);
      }
      polls++;
      failedPoll.resolve(undefined);
      throw Error('lost GET');
    },
    1000,
    controller.signal,
  );
  await failedPoll.promise;
  await delay(5); // The first safe GET retry is now in its 250ms backoff.
  controller.abort();
  await assert.rejects(bounded(task), { code: 'Aborted' });
  assert.equal(posts, 1);
  assert.equal(polls, 1);
});

test('V1 native streams retain large-result compatibility and reject invalid UTF8', async () => {
  let calls = 0;
  const large = { tx: 'ab'.repeat(20_000) };
  const answer = await request(async () =>
    ++calls === 1 ? json({ jobId: 'job' }, 202) : new Response(JSON.stringify(done(large))),
  );
  assert.deepEqual(answer, large);
  calls = 0;
  await assert.rejects(
    request(async () => {
      calls++;
      return new Response(Uint8Array.of(0xff), { status: 202 });
    }),
    { code: 'InternalError' },
  );
  assert.equal(calls, 1);
});

test('V1 captures invocation request JSON and factory options before asynchronous work', async () => {
  const gate = deferred();
  /** @type {string[]} */ const bodies = [];
  let calls = 0;
  /** @type {FetchLike} */ const fetch = async (_url, init) => {
    calls++;
    if (init?.method === 'POST') {
      bodies.push(init.body ?? '');
      return gate.promise;
    }
    return json(done());
  };
  const options = { fetch, timeoutMs: 1000, pollIntervalMs: 0 };
  const prover = remoteV1Prover('http://synthetic.invalid', options);
  options.fetch = async () => {
    throw Error('replacement fetch');
  };
  options.timeoutMs = 1;
  const tx = Buffer.from([1]),
    task = prover.proveTx(tx, { networkId: 'undeployed', bindingId: 'acc-s3r1.1', circuits: [] });
  tx.fill(255);
  gate.resolve(json({ jobId: 'job' }, 202));
  assert.deepEqual((await task).tx, Uint8Array.of(2));
  assert.deepEqual(bodies, ['{"tx":"01"}']);
  assert.equal(calls, 2);
});

test('V1 generic structural results retain cyclic records and large valid transactions', async () => {
  /** @type {Record<string,unknown>} */ const cyclic = {};
  cyclic.self = cyclic;
  for (const result of [cyclic, { tx: 'ab'.repeat(4 * 1024 * 1024) }]) {
    let calls = 0;
    assert.equal(
      await request(
        async () => (++calls === 1 ? json({ jobId: 'job' }, 202) : json(done(result))),
        1000,
      ),
      result,
    );
  }
});

test('V1 deployer returns an owned txIds array and retains arbitrary legacy IDs', async () => {
  const ids = ['wave-1'];
  let calls = 0;
  const result = await remoteV1Deployer('http://synthetic.invalid', {
    pollIntervalMs: 0,
    fetch: async () =>
      ++calls === 1
        ? json({ jobId: 'job' }, 202)
        : json(done({ address: 'ab'.repeat(32), txIds: ids })),
  }).deploy({ boot: new Uint8Array(32), encKey: new Uint8Array(32), retireAuthority: true });
  ids[0] = 'changed';
  assert.deepEqual(result.txIds, ['wave-1']);
});

for (const option of ['timeoutMs', 'pollIntervalMs']) {
  for (const invalid of [
    -1,
    0.5,
    NaN,
    Infinity,
    2_147_483_648,
    ...(option === 'timeoutMs' ? [0] : []),
  ]) {
    test(`V1 refuses invalid ${option} ${invalid} before dispatch`, async () => {
      let calls = 0;
      await assert.rejects(
        requestV1Job('http://synthetic.invalid', '/v1/prove-tx', {}, 'prover', {
          [option]: invalid,
          fetch: async () => {
            calls++;
            return json({});
          },
        }),
        /invalid v1 service polling limits/,
      );
      assert.equal(calls, 0);
    });
  }
}

test('V1 admits maximum timer values and removes caller listeners after success', async () => {
  let calls = 0,
    adds = 0,
    removes = 0;
  const signal = {
    aborted: false,
    addEventListener() {
      adds++;
    },
    removeEventListener() {
      removes++;
    },
  };
  const result = await requestV1Job(
    'http://synthetic.invalid',
    '/v1/prove-tx',
    {},
    'prover',
    {
      timeoutMs: 2_147_483_647,
      pollIntervalMs: 2_147_483_647,
      fetch: async () => (++calls === 1 ? json({ jobId: 'job' }, 202) : json(done())),
    },
    signal,
  );
  assert.deepEqual(result, { tx: '02' });
  assert.equal(adds, 1);
  assert.equal(removes, 1);
});
