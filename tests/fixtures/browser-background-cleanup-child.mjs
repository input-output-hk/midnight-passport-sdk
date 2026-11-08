// Isolated synthetic bridge; no user worker, storage or credentials.
import assert from 'node:assert/strict';
import { browserBackgroundPort } from '../../packages/adapter-browser/dist/background.js';
import {
  createBackgroundClient,
  serveBackgroundTasks,
} from '../../packages/account/dist/background.js';

const [action, mode, startup = 'normal'] = process.argv.slice(2);
/** @type {string[]} */
const unhandled = [];
process.on('unhandledRejection', (error) => unhandled.push(String(error)));
const secret = new Error('private synthetic browser teardown');
/** @returns {unknown} */
function teardown() {
  switch (mode) {
    case 'throw':
      throw secret;
    case 'reject':
      return Promise.reject(secret);
    case 'native-catch':
    case 'native-then': {
      const promise = Promise.reject(secret);
      return Object.defineProperty(promise, mode === 'native-catch' ? 'catch' : 'then', {
        get() {
          throw secret;
        },
      });
    }
    case 'then-getter':
      return Object.defineProperty({}, 'then', {
        get() {
          throw secret;
        },
      });
    case 'then-reject':
      return {
        /** @param {unknown} _resolve @param {(reason: unknown) => void} reject */
        then(_resolve, reject) {
          reject(secret);
        },
      };
    case 'never':
      return new Promise(() => {});
    default:
      throw new Error('Unknown cleanup mode');
  }
}
const target = new EventTarget();
/** @type {string[]} */
const trace = [];
let removes = 0,
  closes = 0,
  received = 0,
  failures = 0;
const endpoint = {
  postMessage() {},
  /** @param {string} type @param {Parameters<typeof target.addEventListener>[1]} listener */
  addEventListener(type, listener) {
    trace.push(`add:${type}`);
    target.addEventListener(type, listener);
    if (startup === 'registration' && type === 'error') throw secret;
  },
  /** @param {string} type @param {Parameters<typeof target.addEventListener>[1]} listener */
  removeEventListener(type, listener) {
    trace.push(`remove:${type}`);
    target.removeEventListener(type, listener);
    removes++;
    return teardown();
  },
  start() {
    trace.push('start');
    if (startup === 'start') throw secret;
  },
};
const port = browserBackgroundPort(endpoint, () => {
  trace.push('close');
  closes++;
  return teardown();
});
if (action === 'direct') {
  const unsubscribe = port.subscribe(
    () => received++,
    () => failures++,
  );
  target.dispatchEvent(Object.assign(new Event('message'), { data: 'before' }));
  unsubscribe();
  unsubscribe(); // Existing unsubscribe behavior repeats listener release.
  if (mode === 'throw' && startup === 'normal') assert.throws(() => port.close(), secret);
  else port.close();
  port.close();
  assert.equal(closes, 1);
  assert.equal(received, startup === 'normal' ? 1 : 0);
  assert.equal(failures, startup === 'normal' ? 0 : 1);
} else if (action === 'client-close' || action === 'client-fatal') {
  const client = createBackgroundClient(port, { channel: 'bridge', timeoutMs: 1000 });
  if (startup === 'normal') {
    const rejected = assert.rejects(client.request('read', {}), {
      code: action === 'client-close' ? 'Closed' : 'Unavailable',
    });
    if (action === 'client-close') client.close();
    else target.dispatchEvent(new Event('error'));
    await rejected;
  }
  client.close();
  client.close();
  await assert.rejects(client.request('read', {}), { code: 'Closed' });
  assert.equal(closes, 1);
} else if (action === 'server-stop' || action === 'server-fatal') {
  const stop = serveBackgroundTasks(port, {
    channel: 'bridge',
    methods: { read: async () => 1 },
  });
  if (action === 'server-stop') stop();
  else target.dispatchEvent(new Event('error'));
  stop();
  stop();
  assert.equal(closes, startup !== 'normal' || action === 'server-fatal' ? 1 : 0);
} else throw new Error('Unknown bridge action');
target.dispatchEvent(Object.assign(new Event('message'), { data: 'late' }));
target.dispatchEvent(new Event('error'));
assert.equal(received, action === 'direct' && startup === 'normal' ? 1 : 0);
assert.equal(
  removes,
  action === 'direct' ? (startup === 'normal' ? 6 : 9) : startup === 'normal' ? 3 : 6,
);
assert.deepEqual(
  trace.slice(0, startup === 'registration' ? 2 : 4),
  startup === 'registration'
    ? ['add:message', 'add:error']
    : ['add:message', 'add:error', 'add:messageerror', 'start'],
);
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(unhandled, []);
console.log(JSON.stringify({ action, mode, startup, removes, closes, unhandled }));
