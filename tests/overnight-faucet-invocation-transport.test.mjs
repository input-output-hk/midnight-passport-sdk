import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { remoteFaucet } from '../packages/adapter-service/dist/index.js';
import {
  original,
  changedId,
  result,
  json,
  deferred,
  client,
  failure,
  bounded,
} from './fixtures/overnight-faucet-transport.mjs';
/** @typedef {import('../packages/adapter-service/dist/faucet.js').FaucetClientOptions} Options */
/** @typedef {import('../packages/account/dist/ports/index.js').FetchLike} FetchLike */

test('request snapshot precedes headers: every wire field and original ID stay admitted', async () => {
  const gate = deferred(),
    request = { ...original };
  let calls = 0;
  /** @type {Record<string,unknown>|undefined} */ let wire;
  const remote = client(
    async (url, init) => {
      calls++;
      assert.equal(url, 'http://injected.invalid/v1/faucet/fund');
      assert.equal(init?.method, 'POST');
      wire = JSON.parse(init?.body ?? '');
      assert.equal(init?.headers?.['content-type'], 'application/json');
      return json(result);
    },
    undefined,
    () => gate.promise,
  );
  const task = remote.fund(request);
  Object.assign(request, {
    requestId: changedId,
    accountAddress: 'de'.repeat(32),
    amount: '20',
    networkId: 'other',
    bindingId: 'other',
    manifestSha256: '11'.repeat(32),
    color: '22'.repeat(32),
  });
  gate.resolve({ 'content-type': 'wrong', authorization: 'fresh' });
  assert.deepEqual(await task, result);
  assert.deepEqual(wire, original);
  assert.equal(calls, 1);
});

for (const replyId of [original.requestId, changedId]) {
  test(`post-wire caller ID change does not redirect receipt binding to ${replyId}`, async () => {
    const gate = deferred(),
      started = deferred(),
      request = { ...original };
    let calls = 0;
    const remote = client(async (_url, init) => {
      calls++;
      assert.equal(JSON.parse(init?.body ?? '').requestId, original.requestId);
      started.resolve(undefined);
      return { ok: true, status: 200, json: () => gate.promise };
    });
    const task = remote.fund(request);
    await started.promise;
    request.requestId = changedId;
    gate.resolve({ ...result, requestId: replyId });
    if (replyId === original.requestId) assert.deepEqual(await task, result);
    else
      await assert.rejects(task, (error) =>
        failure(error, 200, 'funding service answered an invalid result'),
      );
    assert.equal(calls, 1);
  });
}

test('request getters are captured once, not serialized after credentials through caller toJSON', async () => {
  const gate = deferred();
  /** @type {Record<string,number>} */ const reads = {};
  const descriptors = Object.fromEntries(
    Object.entries(original).map(([key, value]) => [
      key,
      {
        get() {
          reads[key] = (reads[key] ?? 0) + 1;
          return reads[key] === 1 ? value : 'changed';
        },
      },
    ]),
  );
  const request = Object.defineProperties({ ...original }, descriptors);
  Object.assign(request, {
    toJSON() {
      throw Error('Must not serialize the caller');
    },
  });
  const remote = client(
    async (_url, init) => {
      assert.deepEqual(JSON.parse(init?.body ?? ''), original);
      return json(result);
    },
    undefined,
    () => gate.promise,
  );
  const task = remote.fund(request);
  gate.resolve({});
  await task;
  assert.deepEqual(reads, Object.fromEntries(Object.keys(original).map((key) => [key, 1])));
});

test('factory captures options once and original header receiver while credentials stay fresh', async () => {
  let fetchReads = 0,
    headerReads = 0,
    timeReads = 0,
    authCalls = 0,
    timeout = 1000;
  /** @type {string[]} */ const values = [];
  /** @type {FetchLike} */ let selected = /** @this {undefined} */ async function (_url, init) {
    assert.equal(this, undefined);
    values.push(init?.headers?.authorization ?? '');
    return json(result);
  };
  let replacementCalls = 0;
  const provider = /** @this {Options} */ async function () {
    assert.equal(this, options);
    return { authorization: 'fresh-' + ++authCalls };
  };
  /** @type {Options['headers']} */ let read = provider;
  const options = {
    get fetch() {
      fetchReads++;
      return selected;
    },
    get headers() {
      headerReads++;
      return read;
    },
    get timeoutMs() {
      timeReads++;
      return timeout;
    },
  };
  const remote = remoteFaucet('http://injected.invalid', options);
  selected = async () => {
    throw Error('Replacement fetch');
  };
  timeout = 1;
  read = async () => {
    replacementCalls++;
    return {};
  };
  await remote.fund({ ...original });
  await remote.fund({ ...original });
  assert.deepEqual(values, ['fresh-1', 'fresh-2']);
  assert.equal(replacementCalls, 0);
  assert.deepEqual([fetchReads, headerReads, timeReads], [1, 1, 1]);
});

for (const phase of ['headers', 'fetch', 'json', 'native']) {
  test(`explicit total deadline settles ${phase} stall without another POST`, async () => {
    let calls = 0,
      cancels = 0;
    /** @type {AbortSignal|undefined} */ let wire;
    // This case measures a stalled body after headers, not cold Undici setup.
    // Construct before the client's total budget starts (not inside fetch).
    const native =
      phase === 'native'
        ? new Response(
            new ReadableStream({
              cancel() {
                cancels++;
                return new Promise(() => {});
              },
            }),
          )
        : undefined;
    const remote = client(
      async (_url, init) => {
        calls++;
        assert.ok(init?.signal instanceof AbortSignal);
        wire = init.signal;
        if (phase === 'fetch') return new Promise(() => {});
        if (native) return native;
        return { ok: true, status: 200, json: () => new Promise(() => {}) };
      },
      20,
      phase === 'headers' ? () => new Promise(() => {}) : async () => ({}),
    );
    await assert.rejects(bounded(remote.fund({ ...original })), (error) =>
      failure(
        error,
        phase === 'headers' || phase === 'fetch' ? 0 : 200,
        phase === 'headers' || phase === 'fetch'
          ? 'funding service is unreachable'
          : 'funding service answered invalid JSON',
      ),
    );
    assert.equal(calls, phase === 'headers' ? 0 : 1);
    assert.equal(wire?.aborted, phase === 'headers' ? undefined : true);
    assert.equal(cancels, phase === 'native' ? 1 : 0);
    if (wire) assert.equal(getEventListeners(wire, 'abort').length, 0);
  });
}

for (const late of ['resolve', 'reject']) {
  test(`late credentials ${late} cannot dispatch after expiry`, async () => {
    const gate = deferred();
    let calls = 0;
    const remote = client(
      async () => {
        calls++;
        return json(result);
      },
      15,
      () => gate.promise,
    );
    await assert.rejects(bounded(remote.fund({ ...original })), (error) =>
      failure(error, 0, 'funding service is unreachable'),
    );
    if (late === 'resolve') gate.resolve({ authorization: 'late' });
    else gate.reject(Error('Late credential provider'));
    await delay(5);
    assert.equal(calls, 0);
  });
}

for (const phase of ['fetch', 'json', 'cancel']) {
  test(`late ${phase} rejection is consumed without replay`, async () => {
    const gate = deferred();
    let calls = 0;
    /** @type {FetchLike} */ const fetch = async () => {
      calls++;
      if (phase === 'fetch') return gate.promise;
      if (phase === 'json') return { ok: true, status: 200, json: () => gate.promise };
      return {
        ok: true,
        status: 200,
        json: async () => result,
        body: {
          getReader() {
            return {
              read: () => new Promise(() => {}),
              cancel: () => gate.promise,
              releaseLock() {
                throw Error('Custom lock');
              },
            };
          },
        },
      };
    };
    await assert.rejects(bounded(client(fetch, 15).fund({ ...original })));
    gate.reject(Error('Late owned rejection'));
    await delay(5);
    assert.equal(calls, 1);
  });
}

test('late headers cancel the newly arrived native body without JSON', async () => {
  const gate = deferred();
  let reads = 0,
    cancels = 0,
    calls = 0;
  const task = client(() => {
    calls++;
    return gate.promise;
  }, 15).fund({ ...original });
  await assert.rejects(bounded(task));
  const body = new ReadableStream({
      cancel() {
        cancels++;
      },
    }),
    response = new Response(body);
  gate.resolve({
    ok: response.ok,
    status: response.status,
    headers: response.headers,
    body: response.body,
    json: async () => {
      reads++;
      return result;
    },
  });
  await delay(5);
  assert.equal(calls, 1);
  assert.equal(reads, 0);
  assert.equal(cancels, 1);
  assert.equal(body.locked, false);
});

test('unset timeout stays intentionally unbounded with no signal when later options change', async () => {
  const gate = deferred();
  let calls = 0,
    hasSignal = true,
    settled = false;
  const options = {
    headers: () => gate.promise,
    fetch: async (/** @type {string} */ _url, /** @type {Parameters<FetchLike>[1]} */ init) => {
      calls++;
      hasSignal = Object.hasOwn(init ?? {}, 'signal');
      return json(result);
    },
  };
  const remote = remoteFaucet('http://injected.invalid', options);
  Object.assign(options, { timeoutMs: 1 });
  const task = remote.fund({ ...original }).finally(() => {
    settled = true;
  });
  await delay(25);
  assert.equal(settled, false);
  assert.equal(calls, 0);
  gate.resolve({});
  assert.deepEqual(await task, result);
  assert.equal(hasSignal, false);
  assert.equal(calls, 1);
});

for (const status of [200, 201, 400, 403, 409, 429, 502]) {
  for (const mode of ['invalid', 'stalled']) {
    test(
      `HTTP${status} ${mode} JSON retains known-status body failure`,
      { timeout: 1500 },
      async (t) => {
        let now = 1000,
          calls = 0,
          reads = 0;
        const bodyEntered = deferred();
        /** @type {AbortSignal|undefined} */ let wire;
        // This matrix checks a known response status. Hold the whole-observation
        // clock until body entry, then expire stalled bodies deliberately.
        t.mock.method(performance, 'now', () => now);
        t.mock.timers.enable({ apis: ['setTimeout'] });
        t.after(() => t.mock.timers.reset());
        const remote = client(async (_url, init) => {
          calls++;
          assert.equal(init?.method, 'POST');
          assert.ok(init?.signal instanceof AbortSignal);
          wire = init.signal;
          return {
            ok: status < 400,
            status,
            json: async () => {
              reads++;
              bodyEntered.resolve(undefined);
              if (mode === 'invalid') throw Error('Owned bad JSON');
              return new Promise(() => {});
            },
          };
        }, 15);
        const task = remote.fund({ ...original });
        const observed = assert.rejects(task, (error) =>
          failure(error, status, 'funding service answered invalid JSON'),
        );
        await bodyEntered.promise;
        assert.equal(calls, 1);
        assert.equal(reads, 1);
        if (mode === 'stalled') {
          now += 15;
          t.mock.timers.tick(15);
        }
        await observed;
        assert.ok(wire);
        assert.equal(wire.aborted, mode === 'stalled');
        assert.equal(getEventListeners(wire, 'abort').length, 0);
        now += 30;
        t.mock.timers.tick(30);
        assert.equal(calls, 1);
        assert.equal(reads, 1);
        assert.equal(wire.aborted, mode === 'stalled');
      },
    );
  }
}

test('parsed refusals keep empty/server/fallback messages, never sponsor error codes', async () => {
  for (const [body, message] of [
    [{ error: '' }, ''],
    [{ error: 'pending' }, 'pending'],
    [{}, 'funding request failed: HTTP 409'],
  ])
    await assert.rejects(client(async () => json(body, 409)).fund({ ...original }), (error) =>
      failure(error, 409, String(message)),
    );
});

test('ok/status are captured before body await;201ok remains compatible', async () => {
  const gate = deferred(),
    response = { ok: false, status: 409, json: () => gate.promise };
  const task = client(async () => response).fund({ ...original });
  await delay(0);
  response.ok = true;
  response.status = 200;
  gate.resolve({ error: 'pending' });
  await assert.rejects(task, (error) => failure(error, 409, 'pending'));
  assert.deepEqual(await client(async () => json(result, 201)).fund({ ...original }), result);
});

test('header/fetch failure preserves original cause and status0', async () => {
  for (const phase of ['headers', 'fetch']) {
    const cause = Error('Owned provider failure');
    let calls = 0;
    const remote = client(
      async () => {
        calls++;
        throw cause;
      },
      undefined,
      phase === 'headers'
        ? async () => {
            throw cause;
          }
        : async () => ({}),
    );
    await assert.rejects(remote.fund({ ...original }), (error) => {
      failure(error, 0, 'funding service is unreachable');
      assert.ok(error instanceof Error);
      assert.equal(error.cause, cause);
      return true;
    });
    assert.equal(calls, phase === 'headers' ? 0 : 1);
  }
});

test('deadline is rechecked after materializing fresh credential headers', async () => {
  let calls = 0;
  const remote = client(
    async () => {
      calls++;
      return json(result);
    },
    1,
    async () => ({
      get authorization() {
        const end = performance.now() + 20;
        while (performance.now() < end) {
          /* Owned provider work cannot be preempted. */
        }
        return 'token';
      },
    }),
  );
  await assert.rejects(remote.fund({ ...original }), (error) =>
    failure(error, 0, 'funding service is unreachable'),
  );
  assert.equal(calls, 0);
});
