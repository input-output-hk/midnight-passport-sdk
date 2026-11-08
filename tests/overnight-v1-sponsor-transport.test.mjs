import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { remoteV1Sponsor } from '../packages/adapter-service/dist/index.js';

/** @typedef {import('../packages/account/dist/ports/index.js').FetchLike} FetchLike */
/** @typedef {Awaited<ReturnType<FetchLike>>} Reply */
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
const json = (value, status = 200) => ({ ok: status === 200, status, json: async () => value });
/** @param {FetchLike} fetch @param {number} [timeoutMs] */
const sponsor = (fetch, timeoutMs) =>
  remoteV1Sponsor('http://injected.invalid//', {
    fetch,
    ...(timeoutMs !== undefined && { timeoutMs }),
  });
/** @param {string} method @param {ReturnType<typeof sponsor>} remote @param {Uint8Array} [tx] */
const invoke = (method, remote, tx = Uint8Array.of(1)) =>
  method === 'balance' ? remote.balanceAndSign(tx) : remote.submit(tx);
/** @param {Promise<unknown>} task */
async function bounded(task) {
  let timer;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Owned sponsor observation did not settle')), 1500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

for (const method of ['balance', 'submit']) {
  test(`${method} unset timeout retains exact legacy request without signal or response cap`, async () => {
    /** @type {Parameters<FetchLike>[1]} */ let seen;
    /** @type {string[]} */ const calls = [];
    const remote = sponsor(async (url, init) => {
      calls.push(url);
      seen = init;
      return json(
        method === 'balance'
          ? { tx: 'ab'.repeat(20_000) }
          : { txId: 'arbitrary-provider-watch-id' },
      );
    });
    assert.equal(remote.supportsShieldedOffers, false);
    const result = await invoke(method, remote);
    assert.equal(
      method === 'balance' ? result.length : result,
      method === 'balance' ? 20_000 : 'arbitrary-provider-watch-id',
    );
    assert.deepEqual(calls, [`http://injected.invalid/v1/sponsor/${method}`]);
    assert.equal(seen?.method, 'POST');
    assert.deepEqual(seen?.headers, { 'content-type': 'application/json' });
    assert.equal(seen?.body, '{"tx":"01"}');
    assert.equal(Object.hasOwn(seen ?? {}, 'signal'), false);
  });
  for (const stall of ['headers', 'json', 'native-reader']) {
    test(`${method} explicit deadline settles uncooperative ${stall} with one POST`, async () => {
      let calls = 0,
        cancels = 0;
      /** @type {AbortSignal|undefined} */ let wire;
      const remote = sponsor(async (_url, init) => {
        calls++;
        assert.ok(init?.signal instanceof AbortSignal);
        wire = init.signal;
        if (stall === 'headers') return new Promise(() => {});
        if (stall === 'json') return { ok: true, status: 200, json: () => new Promise(() => {}) };
        return new Response(
          new ReadableStream({
            cancel() {
              cancels++;
              return new Promise(() => {});
            },
          }),
        );
      }, 20);
      await assert.rejects(bounded(invoke(method, remote)), {
        code: 'InternalError',
        message: `/v1/sponsor/${method}: no answer within 20 ms`,
      });
      assert.equal(calls, 1);
      assert.equal(wire?.aborted, true);
      assert.equal(cancels, stall === 'native-reader' ? 1 : 0);
      assert.equal(getEventListeners(wire, 'abort').length, 0);
    });
  }
  test(`${method} late headers cancel actual native body without JSON or replacement request`, async () => {
    const gate = deferred();
    let calls = 0,
      reads = 0,
      cancels = 0;
    const remote = sponsor(() => {
      calls++;
      return gate.promise;
    }, 15);
    await assert.rejects(bounded(invoke(method, remote)), { code: 'InternalError' });
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
        return method === 'balance' ? { tx: '01' } : { txId: 'late' };
      },
    });
    await delay(5);
    assert.equal(reads, 0);
    assert.equal(cancels, 1);
    assert.equal(body.locked, false);
    assert.equal(calls, 1);
  });
  for (const phase of ['headers', 'json', 'cancel']) {
    test(`${method} late ${phase} rejection is consumed without retry`, async () => {
      const losing = deferred();
      let calls = 0;
      /** @type {FetchLike} */ const fetch = async () => {
        calls++;
        if (phase === 'headers') return losing.promise;
        if (phase === 'json') return { ok: true, status: 200, json: () => losing.promise };
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          body: {
            getReader() {
              return {
                read: () => new Promise(() => {}),
                cancel: () => losing.promise,
                releaseLock() {
                  throw Error('Owned custom release failure');
                },
              };
            },
          },
        };
      };
      await assert.rejects(bounded(invoke(method, sponsor(fetch, 15))), { code: 'InternalError' });
      losing.reject(Error('Owned late host rejection'));
      await delay(5);
      assert.equal(calls, 1);
    });
  }
}

for (const status of [201, 204, 400, 401, 403, 429, 502]) {
  for (const body of ['unreadable', 'stalled']) {
    test(`known HTTP${status} ${body} optional diagnostics retain status classification`, async () => {
      let calls = 0;
      const remote = sponsor(async () => {
        calls++;
        return {
          ok: status < 400,
          status,
          json:
            body === 'stalled'
              ? () => new Promise(() => {})
              : async () => {
                  throw Error('Owned nonJSON proxy');
                },
        };
      }, 15);
      await assert.rejects(bounded(remote.submit(Uint8Array.of(1))), {
        code:
          status === 403 || status === 429 || status >= 500 ? 'SponsorRejected' : 'InternalError',
        message: `/v1/sponsor/submit failed: HTTP ${status}`,
      });
      assert.equal(calls, 1);
    });
  }
}

test('known native refusal is cancelled under deadline without leaking or retrying diagnostics', async () => {
  let cancels = 0;
  const body = new ReadableStream({
    cancel() {
      cancels++;
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    bounded(sponsor(async () => new Response(body, { status: 403 }), 15).submit(Uint8Array.of(1))),
    { code: 'SponsorRejected', message: '/v1/sponsor/submit failed: HTTP 403' },
  );
  assert.equal(cancels, 1);
  assert.equal(body.locked, false);
});

test('known status is captured before awaiting mutable structural JSON', async () => {
  const gate = deferred(),
    response = { ok: false, status: 403, json: () => gate.promise };
  const task = sponsor(async () => response, 1000).submit(Uint8Array.of(1));
  await delay(0);
  response.status = 200;
  response.ok = true;
  gate.resolve({ error: 'original policy refusal', txId: 'must-not-succeed' });
  await assert.rejects(task, { code: 'SponsorRejected', message: 'original policy refusal' });
});

for (const name of ['TimeoutError', 'AbortError', 'TypeError']) {
  for (const explicit of [false, true]) {
    test(`${name} fetch cause identity and wording remain compatible; explicit=${explicit}`, async () => {
      const cause = Object.assign(Error('Owned fetch failure'), { name });
      const remote = sponsor(
        async () => {
          throw cause;
        },
        explicit ? 1000 : undefined,
      );
      await assert.rejects(remote.submit(Uint8Array.of(1)), (error) => {
        assert.ok(error instanceof Error && 'code' in error);
        assert.equal(error.code, 'InternalError');
        assert.equal(error.cause, cause);
        assert.equal(
          error.message,
          explicit && name === 'TimeoutError'
            ? '/v1/sponsor/submit: no answer within 1000 ms'
            : '/v1/sponsor/submit: the service is unreachable',
        );
        return true;
      });
    });
  }
}

for (const explicit of [false, true]) {
  for (const answer of [undefined, null, [], 5]) {
    test(`200 nonobject ${JSON.stringify(answer)} keeps error; explicit=${explicit}`, async () => {
      await assert.rejects(
        sponsor(async () => json(answer), explicit ? 1000 : undefined).submit(Uint8Array.of(1)),
        {
          code: 'InternalError',
          message: '/v1/sponsor/submit answered a body that is not an object',
        },
      );
    });
  }
  for (const value of [undefined, '', 5, 'not-hex']) {
    test(`balance projection ${value} keeps error; explicit=${explicit}`, async () => {
      await assert.rejects(
        sponsor(async () => json({ tx: value }), explicit ? 1000 : undefined).balanceAndSign(
          Uint8Array.of(1),
        ),
        {
          code: 'InternalError',
          message:
            value === 'not-hex'
              ? '/v1/sponsor/balance answered a non-hex tx'
              : '/v1/sponsor/balance answered no "tx"',
        },
      );
    });
  }
  test(`submit projection and arbitrary provider ID remain compatible; explicit=${explicit}`, async () => {
    for (const value of [undefined, '', 5])
      await assert.rejects(
        sponsor(async () => json({ txId: value }), explicit ? 1000 : undefined).submit(
          Uint8Array.of(1),
        ),
        { code: 'InternalError', message: '/v1/sponsor/submit answered no "txId"' },
      );
    assert.equal(
      await sponsor(
        async () => json({ txId: 'provider-not-hex' }),
        explicit ? 1000 : undefined,
      ).submit(Uint8Array.of(1)),
      'provider-not-hex',
    );
  });
}

test('explicit sponsor captures factory fields once, ignores polling getter, and snapshots Buffer bytes', async () => {
  let fetchReads = 0,
    timeoutReads = 0;
  const gate = deferred();
  /** @type {Parameters<FetchLike>[1]} */ let seen;
  /** @type {FetchLike} */ let selected = async (_url, init) => {
    seen = init;
    return gate.promise;
  };
  let timeout = 1000;
  const options = {
    get fetch() {
      fetchReads++;
      return selected;
    },
    get timeoutMs() {
      timeoutReads++;
      return timeout;
    },
    /** @returns {number} */
    get pollIntervalMs() {
      throw Error('Irrelevant sponsor poll option');
    },
  };
  const remote = remoteV1Sponsor('http://injected.invalid', options);
  selected = async () => {
    throw Error('Replacement fetch');
  };
  timeout = 1;
  const tx = Buffer.from([1, 2]),
    task = remote.balanceAndSign(tx);
  tx.fill(255);
  gate.resolve(json({ tx: '0304' }));
  const result = await task;
  assert.deepEqual(result, Uint8Array.of(3, 4));
  result.fill(0);
  assert.deepEqual(tx, Buffer.from([255, 255]));
  assert.equal(seen?.body, '{"tx":"0102"}');
  assert.equal(fetchReads, 1);
  assert.equal(timeoutReads, 1);
});

test('unset timeout is captured as unset despite later options mutation', async () => {
  let seenSignal = false;
  const options = {
    fetch: async (/** @type {string} */ _url, /** @type {Parameters<FetchLike>[1]} */ init) => {
      seenSignal = Object.hasOwn(init ?? {}, 'signal');
      return json({ txId: 'original' });
    },
  };
  const remote = remoteV1Sponsor('http://injected.invalid', options);
  Object.assign(options, { timeoutMs: 1 });
  assert.equal(await remote.submit(Uint8Array.of(1)), 'original');
  assert.equal(seenSignal, false);
});

test('explicit native and structural large results retain no implicit response cap', async () => {
  for (const native of [false, true]) {
    const tx = 'ab'.repeat(4 * 1024 * 1024),
      body = { tx };
    const remote = sponsor(
      async () => (native ? new Response(JSON.stringify(body)) : json(body)),
      10_000,
    );
    const result = await remote.balanceAndSign(Uint8Array.of(1));
    assert.equal(result.length, 4 * 1024 * 1024);
    assert.equal(result[0], 0xab);
  }
});

test('deadline covers synchronous result projection without claiming to preempt host JS', async () => {
  const answer = {
    get txId() {
      const end = performance.now() + 30;
      while (performance.now() < end) {
        /* Owned blocking getter. */
      }
      return 'too-late';
    },
  };
  await assert.rejects(sponsor(async () => json(answer), 15).submit(Uint8Array.of(1)), {
    code: 'InternalError',
    message: '/v1/sponsor/submit: no answer within 15 ms',
  });
});

test('structural cyclic result extensions are not newly serialized for size admission', async () => {
  /** @type {Record<string,unknown>} */ const answer = { txId: 'original' };
  answer.self = answer;
  assert.equal(await sponsor(async () => json(answer), 1000).submit(Uint8Array.of(1)), 'original');
});

for (const invalid of [0, -1, 0.5, NaN, Infinity, 2_147_483_648]) {
  test(`explicit invalid timeout ${invalid} rejects before dispatch`, async () => {
    let calls = 0;
    const remote = sponsor(async () => {
      calls++;
      return json({ txId: 'bad' });
    }, invalid);
    await assert.rejects(remote.submit(Uint8Array.of(1)), {
      code: 'InternalError',
      message: 'Invalid v1 sponsor timeout.',
    });
    assert.equal(calls, 0);
  });
}

test('maximum explicit timer, bare fetch and JSON receiver are preserved and owned timer closes', async () => {
  /** @type {AbortSignal|undefined} */ let wire;
  const answer = { txId: 'ok' },
    response = {
      ok: true,
      status: 200,
      json: async function () {
        assert.equal(this, response);
        return answer;
      },
    };
  const remote = sponsor(
    /** @this {undefined} */ async function (_url, init) {
      assert.equal(this, undefined);
      assert.ok(init?.signal instanceof AbortSignal);
      wire = init.signal;
      return response;
    },
    2_147_483_647,
  );
  assert.equal(await remote.submit(Uint8Array.of(1)), 'ok');
  assert.equal(wire?.aborted, false);
  assert.equal(getEventListeners(wire, 'abort').length, 0);
});

for (const method of ['balance', 'submit']) {
  test(`${method} expiry during valid byte encoding keeps the public timeout and dispatches nothing`, async () => {
    let calls = 0;
    const remote = sponsor(async () => {
      calls++;
      return json(method === 'balance' ? { tx: '01' } : { txId: 'not-sent' });
    }, 1);
    await assert.rejects(invoke(method, remote, new Uint8Array(1024 * 1024).fill(1)), {
      code: 'InternalError',
      message: `/v1/sponsor/${method}: no answer within 1 ms`,
    });
    assert.equal(calls, 0);
  });
}

test('submit context signal stays outside this existing synchronous sponsor contract', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const remote = sponsor(async () => {
    calls++;
    return json({ txId: 'submitted' });
  }, 1000);
  assert.equal(
    await remote.submit(Uint8Array.of(1), {
      signal: controller.signal,
      address: 'ab'.repeat(32),
      circuit: 'append_inbox_with_jubjub',
      mutation: { requestId: 'cd'.repeat(16) + ':0', intentSha256: 'ef'.repeat(32) },
    }),
    'submitted',
  );
  assert.equal(calls, 1);
});
