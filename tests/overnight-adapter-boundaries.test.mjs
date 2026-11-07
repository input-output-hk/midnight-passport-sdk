import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { browserBackgroundPort } from '../packages/adapter-browser/dist/background.js';
import { createBackgroundClient } from '../packages/account/dist/background.js';
import {
  fetchCheckedConfig,
  fetchCheckedV1Config,
} from '../packages/adapter-service/dist/config.js';
import { fetchServiceConfig } from '../packages/adapter-service/dist/service-client.js';

const pin = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: 'ab'.repeat(32),
  artefactUrl: 'http://synthetic/v1/zk/acc-s3r1.1',
};
const config = {
  networkId: pin.networkId,
  bindingId: pin.bindingId,
  manifestSha256: pin.manifestSha256,
  indexerUri: 'http://indexer',
  indexerWsUri: 'ws://indexer',
  nodeUri: 'http://node',
  proofServerUri: 'http://proof',
  zkBaseUrl: pin.artefactUrl,
  coinPublicKey: 'aa',
  encryptionPublicKey: 'bb',
  apiVersions: ['1.0.0-pre.0'],
};
const clients = [fetchCheckedConfig, fetchCheckedV1Config];
/** @param {unknown} value */
const response = (value) => ({ ok: true, status: 200, json: async () => value });

test('MessagePort startup follows listener registration and partial initialization releases owned listeners', async () => {
  for (const fault of ['none', 'message', 'error', 'messageerror', 'start']) {
    const listeners = new Map();
    let starts = 0,
      closes = 0;
    const endpoint = {
      postMessage() {},
      addEventListener(/** @type {string} */ type, /** @type {unknown} */ listener) {
        listeners.set(type, listener);
        if (type === fault) throw Error('private registration detail');
      },
      removeEventListener(/** @type {string} */ type) {
        listeners.delete(type);
      },
      start() {
        starts++;
        assert.deepEqual([...listeners.keys()], ['message', 'error', 'messageerror']);
        if (fault === 'start') throw Error('private startup detail');
      },
    };
    const client = createBackgroundClient(
      browserBackgroundPort(endpoint, () => closes++),
      { channel: 'startup' },
    );
    if (fault !== 'none') await assert.rejects(client.request('read', null), { code: 'Closed' });
    client.close();
    assert.equal(listeners.size, 0);
    assert.equal(closes, 1);
    assert.equal(starts, fault === 'none' || fault === 'start' ? 1 : 0);
  }
});

test('startup failure closes the owned endpoint even when the subscriber does not close it', () => {
  const listeners = new Set();
  let failures = 0,
    closes = 0;
  const port = browserBackgroundPort(
    {
      postMessage() {},
      addEventListener(_type, listener) {
        listeners.add(listener);
      },
      removeEventListener(_type, listener) {
        listeners.delete(listener);
      },
      start() {
        throw Error('private provider detail');
      },
    },
    () => {
      closes++;
      throw Error('private teardown detail');
    },
  );
  const unsubscribe = port.subscribe(
    () => {},
    () => failures++,
  );
  assert.equal(failures, 1);
  assert.equal(closes, 1);
  assert.equal(listeners.size, 0);
  unsubscribe();
  port.close();
  assert.equal(closes, 1);
});

test('checked config validates timeout before fetch, forwards a signal and retains pin precedence', async () => {
  for (const client of clients) {
    let calls = 0;
    /** @type {import('../packages/account/dist/ports/index.js').FetchLike} */
    const fetch = async (_url, init) => {
      calls++;
      assert.equal(init?.signal?.aborted, false);
      return response(config);
    };
    for (const timeoutMs of [
      0,
      -1,
      NaN,
      Infinity,
      1.5,
      600001,
      Number.MAX_SAFE_INTEGER,
      null,
      '1',
      true,
    ])
      await assert.rejects(
        client('http://synthetic', pin, {
          fetch,
          timeoutMs: /** @type {number} */ (/** @type {unknown} */ (timeoutMs)),
        }),
        {
          code: 'InternalError',
          message: 'Invalid configuration read timeout.',
        },
      );
    assert.equal(calls, 0);
    await client('http://synthetic', pin, { fetch, timeoutMs: 600000 });
    assert.equal(calls, 1);
    await assert.rejects(
      client('http://synthetic', pin, { fetch: async () => response({ networkId: 'another' }) }),
      { code: 'NetworkMismatch' },
    );
  }
  const value = await fetchCheckedV1Config('http://synthetic', pin, {
    fetch: async () => response({ ...config, extension: 'kept' }),
  });
  assert.deepEqual(value, { ...config, extension: 'kept' });
  await assert.rejects(
    fetchCheckedV1Config('http://synthetic', pin, {
      fetch: async () => response({ ...config, apiVersions: ['1.0.0-pre.0', 7] }),
    }),
    { code: 'InternalError' },
  );
});

test('legacy three-argument config keeps plain GET and its permissive string fields', async () => {
  const { apiVersions: _versions, ...legacy } = config;
  const value = await fetchServiceConfig(
    'http://synthetic/',
    async (url, init) => {
      assert.equal(url, 'http://synthetic/config');
      assert.equal(init, undefined);
      return response({ ...legacy, indexerUri: '' });
    },
    pin.networkId,
  );
  assert.deepEqual(value, { ...legacy, indexerUri: '' });
});

test('config deadlines reject uncooperative fetch and JSON promises, cancel late responses and discard late data', async () => {
  for (const client of clients) {
    /** @type {import('../packages/account/dist/ports/index.js').FetchAbortSignal[]} */
    const signals = [];
    await assert.rejects(
      client('http://synthetic', pin, {
        timeoutMs: 5,
        fetch: async (_url, init) => {
          if (init?.signal) signals.push(init.signal);
          return new Promise(() => {});
        },
      }),
      { code: 'InternalError', message: /read timeout/ },
    );
    assert.equal(signals[0]?.aborted, true);
    await assert.rejects(
      client('http://synthetic', pin, {
        timeoutMs: 5,
        fetch: async () => ({ ok: true, status: 200, json: async () => new Promise(() => {}) }),
      }),
      { code: 'InternalError', message: /read timeout/ },
    );
    /** @type {(response: Awaited<ReturnType<import('../packages/account/dist/ports/index.js').FetchLike>>) => void} */
    let deliver = () => {
      throw Error('Response release not initialized.');
    };
    /** @type {Promise<Awaited<ReturnType<import('../packages/account/dist/ports/index.js').FetchLike>>>} */
    const held = new Promise((resolve) => {
      deliver = resolve;
    });
    const late = client('http://synthetic', pin, { timeoutMs: 5, fetch: async () => held });
    await assert.rejects(late, { code: 'InternalError', message: /read timeout/ });
    let cancelled = 0;
    const stream = new ReadableStream({
      cancel() {
        cancelled++;
      },
    });
    deliver(new Response(stream));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(cancelled, 1);
    assert.equal(stream.locked, false);
  }
});

test('config bounds native response bytes, cancels oversized streams, releases readers and rejects invalid JSON', async () => {
  for (const client of clients) {
    for (const announced of [false, true]) {
      let cancelled = 0;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(65537));
        },
        cancel() {
          cancelled++;
        },
      });
      const reply = new Response(stream, {
        headers: announced ? { 'content-length': '65537' } : {},
      });
      await assert.rejects(client('http://synthetic', pin, { fetch: async () => reply }), {
        code: 'InternalError',
      });
      assert.equal(cancelled, 1);
      assert.equal(stream.locked, false);
    }
    for (const body of ['{invalid', JSON.stringify({ ...config, padding: 'é'.repeat(33000) })])
      await assert.rejects(
        client('http://synthetic', pin, { fetch: async () => new Response(body) }),
        { code: 'InternalError' },
      );
    const baseline = JSON.stringify({ ...config, padding: '' });
    const exact = {
      ...config,
      padding: 'x'.repeat(65536 - new TextEncoder().encode(baseline).length),
    };
    await client('http://synthetic', pin, {
      fetch: async () => new Response(JSON.stringify(exact)),
    });
    await assert.rejects(
      client('http://synthetic', pin, {
        fetch: async () => response({ ...config, padding: 'x'.repeat(65537) }),
      }),
      { code: 'InternalError' },
    );
  }
});

test(
  'config aborts actual local HTTP header/body stalls and closes the owned connections',
  { timeout: 10000 },
  async (t) => {
    let mode = 'headers',
      seen = 0,
      closed = 0;
    const server = createServer((_req, res) => {
      seen++;
      res.once('close', () => closed++);
      if (mode === 'success') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(config));
      }
      if (mode === 'body') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.write('{');
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    mode = 'success';
    for (const client of clients)
      await client(`http://127.0.0.1:${address.port}`, pin, { timeoutMs: 1000 });
    for (const client of clients)
      for (const stage of ['headers', 'body']) {
        mode = stage;
        await assert.rejects(client(`http://127.0.0.1:${address.port}`, pin, { timeoutMs: 100 }), {
          code: 'InternalError',
          message: /read timeout/,
        });
      }
    for (let attempt = 0; closed < 6 && attempt < 20; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(seen, 6);
    assert.equal(closed, 6);
  },
);
