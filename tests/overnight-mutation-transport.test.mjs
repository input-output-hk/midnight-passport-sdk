import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { remoteHostMutationPorts } from '../packages/adapter-service/dist/index.js';

/** @typedef {import('../packages/account/dist/ports/index.js').FetchLike} FetchLike */
/** @typedef {import('../packages/account/dist/ports/index.js').MutationPins} MutationPins */
/** @type {MutationPins} */
const pins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  scheme: 'jubjub-schnorr',
};
const token = '12'.repeat(32),
  mutation = { requestId: '34'.repeat(16) + ':0', intentSha256: '56'.repeat(32) };
const call = {
  kind: 'confirmed',
  digest: mutation.intentSha256,
  result: { txHash: 'ab'.repeat(32), submissionId: '00' + 'cd'.repeat(32), blockHeight: 7 },
};
const deploy = {
  kind: 'confirmed',
  digest: mutation.intentSha256,
  result: { address: 'ab'.repeat(32), txIds: ['00' + 'cd'.repeat(32)] },
};
const request = {
  boot: new Uint8Array(32).fill(1),
  encKey: new Uint8Array(32).fill(2),
  retireAuthority: true,
  mutation,
};
const effect = {
  key: mutation.requestId,
  digest: mutation.intentSha256,
  kind: /** @type {const} */ ('call'),
  input: {},
};
/** @param {unknown} value @param {number} [status] */
const json = (value, status = 200) => ({ ok: status === 200, status, json: async () => value });
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
/** @param {FetchLike} fetch @param {number} [timeoutMs] @param {number} [pollIntervalMs] */
const ports = (fetch, timeoutMs = 1000, pollIntervalMs = 0) =>
  remoteHostMutationPorts('http://synthetic.invalid/', {
    pins,
    token,
    fetch,
    timeoutMs,
    pollIntervalMs,
  });

for (const invocation of [
  'execute-headers',
  'execute-body',
  'reconcile-headers',
  'reconcile-body',
]) {
  test(`mutation total deadline settles ${invocation} and never retries the POST`, async () => {
    let calls = 0;
    /** @type {import('../packages/account/dist/ports/index.js').FetchAbortSignal|undefined} */ let wire;
    const remote = ports(async (_url, init) => {
      calls++;
      wire = init?.signal;
      if (invocation.endsWith('headers')) return new Promise(() => {});
      return { ok: true, status: 200, json: () => new Promise(() => {}) };
    }, 20);
    const task = invocation.startsWith('execute')
      ? remote.deployer.deploy(request)
      : remote.outcomes.reconcile(pins, effect);
    await assert.rejects(bounded(task), { code: 'MutationUnsettled' });
    assert.equal(calls, 1);
    assert.equal(wire?.aborted, true);
  });
}

test('mutation late confirmed body cannot replace an expired observation', async () => {
  const body = deferred();
  let calls = 0;
  const remote = ports(async () => {
    calls++;
    return { ok: true, status: 200, json: () => body.promise };
  }, 15);
  await assert.rejects(bounded(remote.outcomes.reconcile(pins, effect)), {
    code: 'MutationUnsettled',
  });
  body.resolve(call);
  await delay(10);
  assert.equal(calls, 1);
  const recovered = await ports(async () => json(call)).outcomes.reconcile(pins, effect);
  assert.deepEqual(recovered, {
    kind: 'confirmed',
    digest: mutation.intentSha256,
    result: { txHash: call.result.txHash, blockHeight: 7 },
  });
});

test('mutation abort during an unknown polling pause stops immediately without reconcile', async () => {
  const controller = new AbortController();
  let calls = 0;
  const accepted = deferred();
  const remote = ports(
    async () => {
      calls++;
      accepted.resolve(undefined);
      return json({ kind: 'unknown' });
    },
    1000,
    2_147_483_647,
  );
  const task = remote.deployer.deploy({ ...request, signal: controller.signal });
  await accepted.promise;
  await delay(5);
  controller.abort();
  await assert.rejects(bounded(task), { code: 'MutationUnsettled' });
  assert.equal(calls, 1);
});

test('mutation unknown continuation retains original identity, input bytes, token and fetch', async () => {
  const first = deferred();
  /** @type {{url:string,body:string,token:string|undefined}[]} */ const calls = [];
  /** @type {FetchLike} */ const fetch = async (url, init) => {
    calls.push({ url, body: init?.body ?? '', token: init?.headers?.authorization });
    return calls.length === 1 ? first.promise : json(deploy);
  };
  const options = { pins: { ...pins }, token, fetch, timeoutMs: 1000, pollIntervalMs: 0 };
  const remote = remoteHostMutationPorts('http://synthetic.invalid', options);
  const input = { ...request, mutation: { ...mutation }, boot: Buffer.alloc(32, 1) };
  const task = remote.deployer.deploy(input);
  input.mutation.requestId = 'ff'.repeat(16) + ':2';
  input.mutation.intentSha256 = 'ff'.repeat(32);
  input.boot.fill(255);
  options.token = 'ff'.repeat(32);
  options.pins.networkId = 'other';
  options.timeoutMs = 1;
  options.fetch = async () => {
    throw Error('replacement');
  };
  first.resolve(json({ kind: 'unknown' }));
  assert.deepEqual(await task, deploy.result);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url.endsWith('/execute'), true);
  assert.equal(calls[1]?.url.endsWith('/reconcile'), true);
  const initial = JSON.parse(calls[0]?.body ?? ''),
    continuation = JSON.parse(calls[1]?.body ?? '');
  assert.deepEqual(initial.identity, continuation.identity);
  assert.equal(initial.identity.requestId, mutation.requestId);
  assert.equal(initial.identity.pins.networkId, pins.networkId);
  assert.equal(initial.input.boot, '01'.repeat(32));
  assert.equal(calls[1]?.token, `Bearer ${token}`);
});

test('mutation explicit reconciliation captures effect digest and original signal', async () => {
  const gate = deferred(),
    controller = new AbortController();
  const remote = ports(async () => ({ ok: true, status: 200, json: () => gate.promise }));
  const original = { ...effect },
    context = { signal: controller.signal };
  const task = remote.outcomes.reconcile(pins, original, context);
  original.digest = 'ff'.repeat(32);
  context.signal = new AbortController().signal;
  gate.resolve(call);
  assert.equal((await task).kind, 'confirmed');
  const waiting = remote.outcomes.reconcile(pins, effect, { signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, { code: 'MutationUnsettled' });
});

test('mutation late headers cancel their owned native body without JSON or retry', async () => {
  const headers = deferred();
  let reads = 0,
    cancels = 0,
    calls = 0;
  const remote = ports(() => {
    calls++;
    return headers.promise;
  }, 15);
  await assert.rejects(bounded(remote.outcomes.reconcile(pins, effect)), {
    code: 'MutationUnsettled',
  });
  const body = new ReadableStream({
      cancel() {
        cancels++;
      },
    }),
    response = new Response(body);
  headers.resolve({
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    body: response.body,
    async json() {
      reads++;
      return call;
    },
  });
  await delay(10);
  assert.equal(cancels, 1);
  assert.equal(body.locked, false);
  assert.equal(reads, 0);
  assert.equal(calls, 1);
});

test('mutation losing fetch/body/cancel rejection is observed and cannot trigger continuation', async () => {
  for (const phase of ['headers', 'body', 'cancel']) {
    const losing = deferred();
    let calls = 0;
    /** @type {FetchLike} */
    const fetch = async () => {
      calls++;
      if (phase === 'headers') return losing.promise;
      if (phase === 'body') return { ok: true, status: 200, json: () => losing.promise };
      return {
        ok: true,
        status: 200,
        json: async () => call,
        body: {
          getReader() {
            return {
              read: () => new Promise(() => {}),
              cancel: () => losing.promise,
              releaseLock() {
                throw Error('locked');
              },
            };
          },
        },
      };
    };
    await assert.rejects(bounded(ports(fetch, 15).deployer.deploy(request)), {
      code: 'MutationUnsettled',
    });
    losing.reject(Error('late'));
    await delay(5);
    assert.equal(calls, 1);
  }
});

test('mutation discarded non200 body is cancelled without parsing protected diagnostics', async () => {
  let reads = 0,
    cancels = 0,
    releases = 0;
  await assert.rejects(
    ports(async () => ({
      ok: false,
      status: 403,
      json: async () => {
        reads++;
        return { secret: 'private' };
      },
      body: {
        getReader() {
          return {
            read: () => new Promise(() => {}),
            cancel: async () => {
              cancels++;
            },
            releaseLock() {
              releases++;
            },
          };
        },
      },
    })).outcomes.reconcile(pins, effect),
    { code: 'MutationUnsettled' },
  );
  assert.equal(reads, 0);
  assert.equal(cancels, 1);
  assert.equal(releases, 1);
});

test('mutation maximal canonical 64-step tagged deployment receipt is admitted and owned', async () => {
  const result = {
    address: 'ab'.repeat(32),
    txIds: Array.from({ length: 64 }, () => '00' + 'cd'.repeat(32)),
  };
  const answer = { kind: 'confirmed', digest: mutation.intentSha256, result };
  assert.equal(Buffer.byteLength(JSON.stringify(answer)), 4610);
  const remote = ports(async () => json(answer));
  const observed = await remote.deployer.deploy(request);
  result.txIds.fill('changed');
  assert.equal(observed.txIds.length, 64);
  assert.equal(observed.txIds[0], '00' + 'cd'.repeat(32));
});

for (const bytes of [8192, 8193]) {
  test(`mutation native streamed response ${bytes} bytes enforces the explicit reference outcome cap`, async () => {
    const text = JSON.stringify(call),
      wire = text + ' '.repeat(bytes - Buffer.byteLength(text));
    const task = ports(async () => new Response(wire)).outcomes.reconcile(pins, effect);
    if (bytes === 8192) assert.equal((await task).kind, 'confirmed');
    else await assert.rejects(task, { code: 'MutationUnsettled' });
  });
}

for (const header of [undefined, '1', '8193']) {
  test(`mutation oversized body header ${header} rejects without replay and cancels reader`, async () => {
    let cancels = 0,
      calls = 0;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(8193)));
      },
      cancel() {
        cancels++;
        return new Promise(() => {});
      },
    });
    const response = new Response(
      body,
      header === undefined ? undefined : { headers: { 'content-length': header } },
    );
    await assert.rejects(
      bounded(
        ports(async () => {
          calls++;
          return response;
        }, 25).deployer.deploy(request),
      ),
      { code: 'MutationUnsettled' },
    );
    assert.equal(calls, 1);
    assert.equal(cancels, 1);
    assert.equal(body.locked, false);
  });
}

for (const bad of [
  { ...call, digest: 'ff'.repeat(32) },
  { ...call, result: deploy.result },
  { ...call, result: { ...call.result, submissionId: 'not-a-watch' } },
  { ...call, result: { ...call.result, blockHeight: -1 } },
  { ...deploy, result: { address: 'ab'.repeat(32), txIds: Array(65).fill('cd'.repeat(32)) } },
]) {
  test(`mutation outcome identity/arm/fields refuse ${JSON.stringify(bad).slice(0, 100)}`, async () => {
    let calls = 0;
    await assert.rejects(
      ports(async () => {
        calls++;
        return json(bad);
      }).outcomes.reconcile(pins, effect),
      { code: 'MutationUnsettled' },
    );
    assert.equal(calls, 1);
  });
}

test('mutation deploy receipts reject 65 steps and oversized structural JSON before return', async () => {
  for (const answer of [
    { ...deploy, result: { ...deploy.result, txIds: Array(65).fill('cd'.repeat(32)) } },
    { ...deploy, ignored: 'x'.repeat(8192) },
  ]) {
    let calls = 0;
    await assert.rejects(
      ports(async () => {
        calls++;
        return json(answer);
      }).deployer.deploy(request),
      { code: 'MutationUnsettled' },
    );
    assert.equal(calls, 1);
  }
});

test('mutation valid unknown preserves unknown; transport failure during continuation is not retried', async () => {
  assert.deepEqual(
    await ports(async () => json({ kind: 'unknown' })).outcomes.reconcile(pins, effect),
    { kind: 'unknown' },
  );
  let calls = 0;
  await assert.rejects(
    ports(async () => {
      if (++calls === 1) return json({ kind: 'unknown' });
      throw Error('lost reconcile');
    }).deployer.deploy(request),
    { code: 'MutationUnsettled' },
  );
  assert.equal(calls, 2);
});

test('mutation pre-aborted and registration-raced signals retain unsettled taxonomy and no dispatch', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const signal = {
    aborted: false,
    addEventListener(/** @type {'abort'} */ _type, /** @type {()=>void} */ listener) {
      this.aborted = true;
      listener();
    },
    removeEventListener() {},
  };
  for (const original of [controller.signal, signal])
    await assert.rejects(
      ports(async () => {
        calls++;
        return json(deploy);
      }).deployer.deploy({ ...request, signal: original }),
      { code: 'MutationUnsettled' },
    );
  assert.equal(calls, 0);
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
    test(`mutation invalid ${option} ${invalid} refuses at factory without dispatch`, () => {
      let calls = 0;
      assert.throws(
        () =>
          remoteHostMutationPorts('http://synthetic.invalid', {
            pins,
            token,
            [option]: invalid,
            fetch: async () => {
              calls++;
              return json(call);
            },
          }),
        { code: 'MutationUnsettled' },
      );
      assert.equal(calls, 0);
    });
  }
}

test('mutation captures bare fetch receiver and clears caller listener with maximum timer budgets', async () => {
  let adds = 0,
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
  const remote = ports(
    /** @this {undefined} */
    async function () {
      assert.equal(this, undefined);
      return json(call);
    },
    2_147_483_647,
    2_147_483_647,
  );
  assert.equal((await remote.outcomes.reconcile(pins, effect, { signal })).kind, 'confirmed');
  assert.equal(adds, 1);
  assert.equal(removes, 1);
});
