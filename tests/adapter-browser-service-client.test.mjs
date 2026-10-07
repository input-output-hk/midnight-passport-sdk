// The browser adapter's service client (packages/adapter-browser/src/service-client.ts) on its own:
// the status-to-error mapping at the edge of each class (Ruling R16(b)), how a body that is not
// the expected JSON reads, timeouts, string members, and /config validation. The service is a
// fake fetch; nothing here needs a ledger.
import { mock, test } from 'node:test';
import assert from 'node:assert/strict';

const b = await import(new URL('../packages/adapter-browser/dist/index.js', import.meta.url).href);

/**
 * @typedef {{ method?: string; headers?: Record<string, string>; body?: string; signal?: { aborted: boolean } }} Init
 * @typedef {{ status: number; body?: unknown; unreadable?: boolean }} Reply
 */

/**
 * A fetch answering with `reply`, remembering what it was asked.
 * @param {Reply} reply
 */
function answering(reply) {
  /** @type {{ url: string; init: Init | undefined }[]} */
  const calls = [];
  const fn = async (/** @type {string} */ url, /** @type {Init | undefined} */ init) => {
    calls.push({ url, init });
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => {
        if (reply.unreadable) throw new SyntaxError('Unexpected token <');
        return reply.body;
      },
    };
  };
  return { fn, calls };
}

/** @param {Reply} reply @param {'prover' | 'sponsor'} role */
const post = (reply, role) => b.postService(answering(reply).fn, 'http://svc', '/x', {}, role);

/** @type {readonly [number, string][]} */
const PROVER = [
  [400, 'InternalError'],
  [401, 'InternalError'],
  [403, 'InternalError'],
  [404, 'InternalError'],
  [408, 'InternalError'],
  [413, 'InternalError'],
  [422, 'InternalError'],
  [499, 'InternalError'],
  [500, 'ProverUnavailable'],
  [502, 'ProverUnavailable'],
  [503, 'ProverUnavailable'],
  [504, 'ProverUnavailable'],
  [599, 'ProverUnavailable'],
];
/** @type {readonly [number, string][]} */
const SPONSOR = [
  [400, 'InternalError'],
  [401, 'InternalError'],
  [404, 'InternalError'],
  [408, 'InternalError'],
  [409, 'InternalError'],
  [413, 'InternalError'],
  [415, 'InternalError'],
  [422, 'InternalError'],
  [499, 'InternalError'],
  [403, 'SponsorRejected'],
  [429, 'SponsorRejected'],
  [500, 'SponsorRejected'],
  [502, 'SponsorRejected'],
  [503, 'SponsorRejected'],
  [599, 'SponsorRejected'],
];

test('the prover reads 5xx as unavailable and every 4xx as a defect of this adapter', () => {
  for (const [status, code] of PROVER) {
    assert.equal(
      b.serviceFailure('prover', status, undefined, '/prove').code,
      code,
      String(status),
    );
  }
});

test('the sponsor reads 403, 429 and 5xx as a refusal and every other 4xx as a defect of this adapter', () => {
  for (const [status, code] of SPONSOR) {
    assert.equal(
      b.serviceFailure('sponsor', status, undefined, '/deploy').code,
      code,
      String(status),
    );
  }
});

test('the failure names the server text when there is one, else the endpoint and the status', () => {
  const message = (/** @type {unknown} */ body) =>
    b.serviceFailure('sponsor', 403, body, '/sponsor/balance').message;
  assert.equal(message({ error: 'not a Passport account' }), 'not a Passport account');
  const fallback = '/sponsor/balance failed: HTTP 403';
  for (const body of [
    { error: '' },
    { error: 5 },
    { error: null },
    {},
    null,
    undefined,
    'text',
    7,
    ['x'],
  ]) {
    assert.equal(message(body), fallback, JSON.stringify(body));
  }
});

test('every failure is a typed connector error', () => {
  const e = b.serviceFailure('prover', 503, { error: 'busy' }, '/prove');
  assert.equal(e.type, 'PassportConnectorError');
  assert.equal(e.name, 'PassportConnectorError');
  assert.ok(e instanceof Error);
});

test('only a 200 answers: another 2xx is a failure too, named by its status', async () => {
  for (const status of [201, 202, 204]) {
    await assert.rejects(post({ status, body: {} }, 'prover'), {
      code: 'InternalError',
      message: `/x failed: HTTP ${status}`,
    });
  }
  assert.deepEqual(await post({ status: 200, body: { ok: 1 } }, 'prover'), { ok: 1 });
});

test('a 200 whose body is not an object is InternalError, whatever else it is', async () => {
  for (const reply of /** @type {Reply[]} */ ([
    { status: 200, body: null },
    { status: 200, body: ['a'] },
    { status: 200, body: 'ok' },
    { status: 200, body: 5 },
    { status: 200, body: undefined },
    { status: 200, unreadable: true },
  ])) {
    for (const role of /** @type {const} */ (['prover', 'sponsor'])) {
      await assert.rejects(post(reply, role), {
        code: 'InternalError',
        message: '/x answered a body that is not an object',
      });
    }
  }
});

test('a refusal with an HTML body falls back to the status line, for either role', async () => {
  await assert.rejects(post({ status: 502, unreadable: true }, 'sponsor'), {
    code: 'SponsorRejected',
    message: '/x failed: HTTP 502',
  });
  await assert.rejects(post({ status: 404, unreadable: true }, 'prover'), {
    code: 'InternalError',
    message: '/x failed: HTTP 404',
  });
});

test('a request is a JSON POST to the trimmed base, with no abort signal unless a timeout is given', async () => {
  const f = answering({ status: 200, body: {} });
  await b.postService(f.fn, 'http://svc//', '/deploy', { n: 'x' }, 'sponsor');
  assert.equal(f.calls[0]?.url, 'http://svc/deploy');
  assert.equal(f.calls[0]?.init?.method, 'POST');
  assert.deepEqual(f.calls[0]?.init?.headers, { 'content-type': 'application/json' });
  assert.deepEqual(JSON.parse(f.calls[0]?.init?.body ?? ''), { n: 'x' });
  assert.equal(f.calls[0]?.init?.signal, undefined);

  await b.postService(f.fn, 'http://svc', '/prove', {}, 'prover', 1000);
  const signal = f.calls[1]?.init?.signal;
  assert.ok(signal instanceof AbortSignal, 'a real AbortSignal');
  assert.equal(signal.aborted, false);
});

test('an unreachable service is ProverUnavailable for the prover and InternalError for the sponsor, keeping the cause', async () => {
  const cause = new TypeError('fetch failed');
  const down = async () => {
    throw cause;
  };
  await assert.rejects(b.postService(down, 'http://svc', '/prove', {}, 'prover'), (e) => {
    assert.equal(/** @type {{ code: string }} */ (e).code, 'ProverUnavailable');
    assert.equal(/** @type {Error} */ (e).message, '/prove: the service is unreachable');
    assert.equal(/** @type {Error} */ (e).cause, cause);
    return true;
  });
  await assert.rejects(b.postService(down, 'http://svc', '/deploy', {}, 'sponsor'), {
    code: 'InternalError',
    message: '/deploy: the service is unreachable',
  });
});

test('a timeout reads as no answer within the limit; any other abort reason reads as unreachable', async () => {
  const failWith = (/** @type {string} */ name) => async () => {
    throw Object.assign(new Error('aborted'), { name });
  };
  await assert.rejects(
    b.postService(failWith('TimeoutError'), 'http://svc', '/prove', {}, 'prover', 250),
    { code: 'ProverUnavailable', message: '/prove: no answer within 250 ms' },
  );
  await assert.rejects(
    b.postService(failWith('TimeoutError'), 'http://svc', '/x', {}, 'sponsor', 250),
    { code: 'InternalError', message: '/x: no answer within 250 ms' },
  );
  // A caller's own abort is not the timeout.
  await assert.rejects(
    b.postService(failWith('AbortError'), 'http://svc', '/prove', {}, 'prover', 250),
    { code: 'ProverUnavailable', message: '/prove: the service is unreachable' },
  );
  // Without a timeout there is no limit to name, even for an error called TimeoutError.
  await assert.rejects(
    b.postService(failWith('TimeoutError'), 'http://svc', '/prove', {}, 'prover'),
    {
      message: '/prove: the service is unreachable',
    },
  );
});

test('the timeout really aborts a request that a service never answers', async () => {
  /** @type {Init | undefined} */
  let seen;
  const hang = (/** @type {string} */ _url, /** @type {Init | undefined} */ init) => {
    seen = init;
    const signal = /** @type {AbortSignal} */ (init?.signal);
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason));
    });
  };
  // AbortSignal.timeout's timer is unref'd, so a test with nothing else pending must hold the loop.
  const keepAlive = setTimeout(() => {}, 5000);
  try {
    await assert.rejects(b.postService(hang, 'http://svc', '/prove', {}, 'prover', 15), {
      code: 'ProverUnavailable',
      message: '/prove: no answer within 15 ms',
    });
    assert.equal(seen?.signal?.aborted, true);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('stringMember returns a non-empty string and refuses a missing, empty or non-string member', () => {
  assert.equal(b.stringMember({ tx: 'ab' }, 'tx', '/prove-tx'), 'ab');
  for (const answer of [{}, { tx: '' }, { tx: 5 }, { tx: null }, { tx: ['ab'] }, { other: 'ab' }]) {
    assert.throws(() => b.stringMember(answer, 'tx', '/prove-tx'), {
      code: 'InternalError',
      message: '/prove-tx answered no "tx"',
    });
  }
});

test('trimBase drops every trailing slash and nothing else', () => {
  assert.equal(b.trimBase('http://svc'), 'http://svc');
  assert.equal(b.trimBase('http://svc///'), 'http://svc');
  assert.equal(b.trimBase('http://svc/a/b/'), 'http://svc/a/b');
  assert.equal(b.trimBase('http://svc//a'), 'http://svc//a');
});

test('the default fetch hands the URL and the init to the global fetch', async () => {
  const seen = mock.method(globalThis, 'fetch', async () => ({ ok: true }));
  try {
    const init = { method: 'POST' };
    await b.defaultFetch('http://svc/x', init);
    assert.deepEqual(seen.mock.calls[0]?.arguments, ['http://svc/x', init]);
  } finally {
    seen.mock.restore();
  }
});

const CONFIG = {
  networkId: 'undeployed',
  bindingId: 'acc',
  manifestSha256: 'ab'.repeat(32),
  indexerUri: 'http://indexer/graphql',
  indexerWsUri: 'ws://indexer/graphql/ws',
  nodeUri: 'http://node',
  proofServerUri: 'http://prover',
  zkBaseUrl: 'http://svc/zk/acc',
  coinPublicKey: 'cpk',
  encryptionPublicKey: 'epk',
};

test('/config is read from the trimmed base with a plain GET', async () => {
  const f = answering({ status: 200, body: CONFIG });
  assert.deepEqual(await b.fetchServiceConfig('http://svc//', f.fn, 'undeployed'), CONFIG);
  assert.equal(f.calls[0]?.url, 'http://svc/config');
  assert.equal(f.calls[0]?.init, undefined);
});

test('a service on another network is NetworkMismatch naming both, even when the rest is missing', async () => {
  for (const body of [{ networkId: 'preview' }, { ...CONFIG, networkId: 'preview' }, {}]) {
    await assert.rejects(
      b.fetchServiceConfig('http://svc', answering({ status: 200, body }).fn, 'undeployed'),
      {
        code: 'NetworkMismatch',
        message: `service is on ${/** @type {{ networkId?: string }} */ (body).networkId}, connector is bound to undeployed`,
      },
    );
  }
});

test('every member of /config is required: a missing or non-string one is InternalError naming it', async () => {
  for (const field of Object.keys(CONFIG)) {
    for (const value of [undefined, null, 7, ['x'], { v: 'x' }]) {
      const body = { ...CONFIG, [field]: value };
      await assert.rejects(
        b.fetchServiceConfig('http://svc', answering({ status: 200, body }).fn, 'undeployed'),
        {
          code: field === 'networkId' ? 'NetworkMismatch' : 'InternalError',
          ...(field === 'networkId' ? {} : { message: `service /config has no "${field}"` }),
        },
        `${field}=${JSON.stringify(value)}`,
      );
    }
  }
});

test('the proof server address is part of the configuration the wallet and prover need', async () => {
  const { proofServerUri: _omitted, ...without } = CONFIG;
  await assert.rejects(
    b.fetchServiceConfig('http://svc', answering({ status: 200, body: without }).fn, 'undeployed'),
    { code: 'InternalError', message: 'service /config has no "proofServerUri"' },
  );
});

test('/config that is not an object, is unreadable, fails, or does not answer is InternalError', async () => {
  for (const body of [null, ['a'], 'text', 5]) {
    await assert.rejects(
      b.fetchServiceConfig('http://svc', answering({ status: 200, body }).fn, 'undeployed'),
      { code: 'InternalError', message: 'service /config answered a body that is not an object' },
    );
  }
  await assert.rejects(
    b.fetchServiceConfig(
      'http://svc',
      answering({ status: 200, unreadable: true }).fn,
      'undeployed',
    ),
    { code: 'InternalError', message: 'service /config answered a body that is not an object' },
  );
  for (const status of [301, 404, 500, 503]) {
    await assert.rejects(
      b.fetchServiceConfig('http://svc', answering({ status, body: CONFIG }).fn, 'undeployed'),
      { code: 'InternalError', message: `service /config failed: ${status}` },
    );
  }
  const cause = new TypeError('fetch failed');
  await assert.rejects(
    b.fetchServiceConfig(
      'http://svc',
      async () => {
        throw cause;
      },
      'undeployed',
    ),
    (e) => {
      assert.equal(/** @type {{ code: string }} */ (e).code, 'InternalError');
      assert.equal(/** @type {Error} */ (e).message, 'service /config is unreachable');
      assert.equal(/** @type {Error} */ (e).cause, cause);
      return true;
    },
  );
});
