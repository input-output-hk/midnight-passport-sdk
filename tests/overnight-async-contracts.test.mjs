import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import {
  createBackgroundClient,
  serveBackgroundTasks,
} from '../packages/account/dist/background.js';

const unavailable = (/** @type {unknown} */ error) => {
  assert.ok(error instanceof Error && 'code' in error);
  assert.equal(error.code, 'Unavailable');
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(String(error), /private/);
  return true;
};

for (const api of ['client', 'server']) {
  for (const inlineFailure of [false, true])
    test(`${api}: subscription throw${inlineFailure ? ' after failure' : ''} sanitizes and closes once`, () => {
      let closes = 0;
      const listeners = new Set();
      /** @type {import('../packages/account/dist/background.js').BackgroundPort} */
      const port = {
        post() {},
        subscribe(receive, fail) {
          listeners.add(receive);
          if (inlineFailure) fail();
          throw Error('private subscribe detail');
        },
        close() {
          closes++;
          listeners.clear();
          throw Error('private close detail');
        },
      };
      assert.throws(
        () =>
          api === 'client'
            ? createBackgroundClient(port, { channel: 'init' })
            : serveBackgroundTasks(port, { channel: 'init', methods: {} }),
        unavailable,
      );
      assert.equal(closes, 1);
      assert.equal(listeners.size, 0);
    });
  test(`${api}: synchronous fail still runs returned throwing unsubscribe and closes only once`, () => {
    let closes = 0,
      unsubscribes = 0;
    /** @type {import('../packages/account/dist/background.js').BackgroundPort} */
    const port = {
      post() {},
      subscribe(_receive, fail) {
        fail();
        fail();
        return () => {
          unsubscribes++;
          throw Error('private unsubscribe detail');
        };
      },
      close() {
        closes++;
        throw Error('private close detail');
      },
    };
    if (api === 'client') createBackgroundClient(port, { channel: 'init' }).close();
    else serveBackgroundTasks(port, { channel: 'init', methods: {} })();
    assert.equal(closes, 1);
    assert.equal(unsubscribes, 1);
  });
}

test('explicit server stop only unsubscribes, preserving host endpoint ownership', () => {
  let closes = 0,
    unsubscribes = 0;
  const stop = serveBackgroundTasks(
    {
      post() {},
      subscribe() {
        return () => unsubscribes++;
      },
      close() {
        closes++;
      },
    },
    { channel: 'stop', methods: {} },
  );
  stop();
  stop();
  assert.equal(unsubscribes, 1);
  assert.equal(closes, 0);
});

test('transport failure releases pending requests despite throwing cleanup', async () => {
  let closes = 0;
  let fail = () => {};
  const client = createBackgroundClient(
    {
      post() {},
      subscribe(_receive, failed) {
        fail = failed;
        return () => {
          throw Error('private unsubscribe');
        };
      },
      close() {
        closes++;
        throw Error('private close');
      },
    },
    { channel: 'pending' },
  );
  const pending = assert.rejects(client.request('read', null), unavailable);
  fail();
  fail();
  client.close();
  await pending;
  assert.equal(closes, 1);
});

/** @param {import('node:worker_threads').MessagePort} port @param {()=>void} onClose */
const bridge = (port, onClose) => ({
  post: (/** @type {unknown} */ value) => port.postMessage(value),
  subscribe: (/** @type {(message: unknown)=>void} */ receive, /** @type {()=>void} */ fail) => {
    port.on('message', receive);
    port.on('close', fail);
    port.on('messageerror', fail);
    return () => {
      port.off('message', receive);
      port.off('close', fail);
      port.off('messageerror', fail);
    };
  },
  close() {
    onClose();
    port.close();
  },
});

test(
  'native uncloneable replies fail promptly, close owned channels and produce no unhandled rejection',
  { timeout: 5000 },
  async () => {
    const { port1, port2 } = new MessageChannel();
    const closed = [port1, port2].map(
      (port) => new Promise((resolve) => port.once('close', resolve)),
    );
    let clientCloses = 0,
      serverCloses = 0;
    const unhandled = /** @type {unknown[]} */ ([]);
    const onUnhandled = (/** @type {unknown} */ error) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    const client = createBackgroundClient(
      bridge(port1, () => clientCloses++),
      { channel: 'native', timeoutMs: 2000 },
    );
    const stop = serveBackgroundTasks(
      bridge(port2, () => serverCloses++),
      {
        channel: 'native',
        methods: {
          async read() {
            return () => 1;
          },
        },
      },
    );
    try {
      await assert.rejects(client.request('read', null), unavailable);
      await assert.rejects(client.request('read', null), { code: 'Closed' });
      assert.equal(serverCloses, 1);
      assert.equal(clientCloses, 1);
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      client.close();
      stop();
      port2.close();
      await Promise.all(closed);
    }
  },
);

test(
  'normal handler rejection keeps native transport usable and explicit stop leaves closure to its host',
  { timeout: 5000 },
  async () => {
    const { port1, port2 } = new MessageChannel();
    const closed = [port1, port2].map(
      (port) => new Promise((resolve) => port.once('close', resolve)),
    );
    let serverCloses = 0;
    const client = createBackgroundClient(
      bridge(port1, () => {}),
      { channel: 'usable', timeoutMs: 2000 },
    );
    const stop = serveBackgroundTasks(
      bridge(port2, () => serverCloses++),
      {
        channel: 'usable',
        methods: {
          async fault() {
            throw Error('private handler');
          },
          async read(input) {
            return input;
          },
        },
      },
    );
    try {
      await assert.rejects(client.request('fault', null), { code: 'Rejected' });
      assert.deepEqual(await client.request('read', { value: 1 }), { value: 1 });
      stop();
      assert.equal(serverCloses, 0);
    } finally {
      client.close();
      stop();
      port2.close();
      await Promise.all(closed);
    }
  },
);
