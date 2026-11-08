// Isolated rejection observation: no user workers, credentials, storage or timers survive.
import assert from 'node:assert/strict';
import {
  BackgroundError,
  createBackgroundClient,
  serveBackgroundTasks,
} from '../../packages/account/dist/background.js';

const [action, mode, startup] = process.argv.slice(2);
/** @type {string[]} */
const unhandled = [];
process.on('unhandledRejection', (error) => unhandled.push(String(error)));
let detachCount = 0;
let closeCount = 0;
/** @type {(() => void)|undefined} */
let fail;
const secret = new Error('private provider teardown');
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
        /** @param {unknown} _ok @param {(reason: unknown) => void} reject */
        then(_ok, reject) {
          reject(secret);
        },
      };
    case 'never':
      return new Promise(() => {});
    default:
      throw new Error('Unknown fixture mode');
  }
}
const port = {
  post() {},
  /** @param {(message: unknown) => void} _receive @param {() => void} onFail */
  subscribe(_receive, onFail) {
    fail = onFail;
    if (startup === 'immediate') onFail();
    return () => {
      detachCount++;
      return teardown();
    };
  },
  close() {
    closeCount++;
    return teardown();
  },
};
if (action === 'client-close' || action === 'client-fatal') {
  const client = createBackgroundClient(port, { channel: 'fixture', timeoutMs: 1000 });
  if (startup !== 'immediate') {
    const pending = client.request('read', {});
    const rejected = assert.rejects(
      pending,
      (error) =>
        error instanceof BackgroundError &&
        error.code === (action === 'client-close' ? 'Closed' : 'Unavailable'),
    );
    if (action === 'client-close') client.close();
    else fail?.();
    await rejected;
  }
  client.close();
  fail?.();
  await assert.rejects(
    client.request('read', {}),
    (error) => error instanceof BackgroundError && error.code === 'Closed',
  );
  assert.equal(closeCount, 1);
} else if (action === 'server-close' || action === 'server-fatal') {
  const stop = serveBackgroundTasks(port, { channel: 'fixture', methods: { read: async () => 1 } });
  if (action === 'server-close') stop();
  else fail?.();
  stop();
  fail?.();
  assert.equal(closeCount, startup === 'immediate' || action === 'server-fatal' ? 1 : 0);
} else throw new Error('Unknown fixture action');
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(unhandled, []);
assert.equal(detachCount, 1);
console.log(JSON.stringify({ action, mode, startup, detachCount, closeCount, unhandled }));
