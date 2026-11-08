import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { MessageChannel, Worker } from 'node:worker_threads';
import { browserBackgroundPort } from '../packages/adapter-browser/dist/background.js';
import {
  createBackgroundClient,
  serveBackgroundTasks,
} from '../packages/account/dist/background.js';

/** @param {import('node:worker_threads').MessagePort} port */
const bridge = (port) => ({
  post: (/** @type {unknown} */ value) => port.postMessage(value),
  subscribe: (/** @type {(message:unknown)=>void} */ receive, /** @type {()=>void} */ fail) => {
    port.on('message', receive);
    port.on('messageerror', fail);
    port.on('close', fail);
    return () => {
      port.off('message', receive);
      port.off('messageerror', fail);
      port.off('close', fail);
    };
  },
  close: () => port.close(),
});

test('worker channel correlates out-of-order reads, filters unrelated envelopes and sanitizes errors', async () => {
  const { port1, port2 } = new MessageChannel();
  const client = createBackgroundClient(bridge(port1), { channel: 'unit' });
  const stop = serveBackgroundTasks(bridge(port2), {
    channel: 'unit',
    methods: {
      async read(input) {
        if (input === 'slow') await new Promise((r) => setTimeout(r, 20));
        return input;
      },
      async fault() {
        throw Error('private witness');
      },
    },
  });
  try {
    port2.postMessage({ protocol: 'wrong', channel: 'unit', id: 1, ok: true, value: 'forged' });
    port2.postMessage({
      protocol: 'passport-background-v1',
      channel: 'other',
      id: 1,
      ok: true,
      value: 'forged',
    });
    assert.deepEqual(
      await Promise.all([client.request('read', 'slow'), client.request('read', 'fast')]),
      ['slow', 'fast'],
    );
    await assert.rejects(client.request('fault', undefined), (error) => {
      assert.ok(error instanceof Error && 'code' in error);
      assert.equal(error.code, 'Rejected');
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(String(error), /witness/);
      return true;
    });
    await assert.rejects(client.request('unknown', undefined), { code: 'Rejected' });
    await assert.rejects(client.request('bad method', undefined), { code: 'InvalidMessage' });
  } finally {
    client.close();
    stop();
    port2.close();
  }
  await assert.rejects(client.request('read', null), { code: 'Closed' });
});

test('timeouts and close reject pending reads; late replies cannot resurrect state', async () => {
  const { port1, port2 } = new MessageChannel();
  const client = createBackgroundClient(bridge(port1), {
    channel: 'timeout',
    timeoutMs: 20,
    maxPending: 1,
  });
  try {
    const first = client.request('read', null);
    await assert.rejects(client.request('read', null), { code: 'Busy' });
    await assert.rejects(first, { code: 'Timeout' });
    port2.postMessage({
      protocol: 'passport-background-v1',
      channel: 'timeout',
      id: 1,
      ok: true,
      value: 'late',
    });
    const second = client.request('read', null);
    client.close();
    await assert.rejects(second, { code: 'Closed' });
  } finally {
    client.close();
    port2.close();
  }
});

test('worker failure or uncloneable requests close the channel and release pending work', async () => {
  const { port1, port2 } = new MessageChannel();
  const client = createBackgroundClient(bridge(port1), { channel: 'failure' });
  const pending = client.request('read', null);
  port2.close();
  await assert.rejects(pending, { code: 'Unavailable' });
  const next = new MessageChannel();
  const invalid = createBackgroundClient(bridge(next.port1), { channel: 'failure' });
  await assert.rejects(
    invalid.request('read', () => {}),
    { code: 'Unavailable' },
  );
  next.port2.close();
  for (const options of [
    { channel: '' },
    { channel: 'x', timeoutMs: NaN },
    { channel: 'x', timeoutMs: 0 },
    { channel: 'x', maxPending: 129 },
  ])
    assert.throws(() => createBackgroundClient(bridge(next.port1), options), {
      code: 'InvalidMessage',
    });
});

test('server refuses replay and saturation without evaluating a handler twice', async () => {
  const { port1, port2 } = new MessageChannel();
  let release = () => {};
  const held = new Promise((r) => {
    release = () => r(undefined);
  });
  let count = 0;
  const stop = serveBackgroundTasks(bridge(port2), {
    channel: 'server',
    maxPending: 1,
    methods: {
      async read() {
        count++;
        await held;
        return 'done';
      },
    },
  });
  const replies = /** @type {unknown[]} */ ([]);
  port1.on('message', (value) => replies.push(value));
  const envelope = {
    protocol: 'passport-background-v1',
    channel: 'server',
    id: 1,
    method: 'read',
    input: null,
  };
  const saturated = once(port1, 'message');
  port1.postMessage({ ...envelope, protocol: 'wrong' });
  port1.postMessage(envelope);
  port1.postMessage(envelope);
  port1.postMessage({ ...envelope, id: 2 });
  await saturated;
  assert.equal(count, 1);
  assert.deepEqual(replies, [
    { protocol: 'passport-background-v1', channel: 'server', id: 2, ok: false },
  ]);
  const completed = once(port1, 'message');
  release();
  await completed;
  assert.equal(replies.length, 2);
  stop();
  stop();
  port1.close();
  port2.close();
});

test('actual Node worker runs the SDK read protocol while the host event loop advances', async () => {
  const { port1, port2 } = new MessageChannel();
  const moduleUrl = new URL('../packages/account/dist/background.js', import.meta.url).href;
  const code = `const {parentPort,workerData:port}=require('node:worker_threads');
    import(${JSON.stringify(moduleUrl)}).then(({serveBackgroundTasks})=>{
      serveBackgroundTasks({post:(m)=>port.postMessage(m),subscribe:(receive,fail)=>{port.on('message',receive);port.on('messageerror',fail);return()=>{port.off('message',receive);port.off('messageerror',fail);};},close:()=>port.close()},
        {channel:'cpu',methods:{async busy(input){const until=Date.now()+120;while(Date.now()<until){}return {thread:true,input};}}});
      parentPort.postMessage('ready');
    }).catch(()=>process.exit(1));`;
  const worker = new Worker(code, { eval: true, workerData: port2, transferList: [port2] });
  const client = createBackgroundClient(bridge(port1), { channel: 'cpu', timeoutMs: 10_000 });
  let ticks = 0;
  let timer;
  try {
    await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', (code) => {
        if (code !== 0) reject(Error('Worker failed to initialize.'));
      });
    });
    timer = setInterval(() => ticks++, 5);
    assert.deepEqual(await client.request('busy', 7), { thread: true, input: 7 });
    assert.ok(ticks >= 3, 'host timer should advance during actual SDK worker work');
  } finally {
    clearInterval(timer);
    client.close();
    await worker.terminate();
  }
});

test('browser bridge forwards messages, failures and owned teardown without global access', () => {
  const target = new EventTarget();
  const sent = /** @type {unknown[]} */ ([]),
    received = /** @type {unknown[]} */ ([]);
  let failures = 0,
    closed = 0;
  const endpoint = {
    postMessage: (/** @type {unknown} */ value) => {
      sent.push(value);
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
  };
  const port = browserBackgroundPort(endpoint, () => closed++);
  const unsubscribe = port.subscribe(
    (value) => received.push(value),
    () => failures++,
  );
  port.post('out');
  target.dispatchEvent(Object.assign(new Event('message'), { data: 'in' }));
  target.dispatchEvent(new Event('messageerror'));
  target.dispatchEvent(new Event('error'));
  unsubscribe();
  target.dispatchEvent(Object.assign(new Event('message'), { data: 'late' }));
  target.dispatchEvent(new Event('error'));
  port.close();
  assert.deepEqual(sent, ['out']);
  assert.deepEqual(received, ['in']);
  assert.equal(failures, 2);
  assert.equal(closed, 1);
});

test('synchronous transport failure and throwing teardown still close the client', async () => {
  let unsubscribed = 0,
    closed = 0;
  const client = createBackgroundClient(
    {
      post() {},
      subscribe(_receive, fail) {
        fail();
        return () => {
          unsubscribed++;
          throw Error('private teardown');
        };
      },
      close() {
        closed++;
        throw Error('private close');
      },
    },
    { channel: 'failed' },
  );
  await assert.rejects(client.request('read', null), { code: 'Closed' });
  assert.equal(unsubscribed, 1);
  assert.equal(closed, 1);
});
