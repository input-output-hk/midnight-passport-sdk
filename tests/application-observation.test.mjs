import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  merchantContinuation,
  confirmedCredit,
} from '../examples/application-acc/native-observation.mjs';
const hash = (/** @type {number} */ n) => n.toString(16).padStart(64, '0');
function fixture() {
  const source = 'a'.repeat(40),
    identity = { commit: source, dirty: false, workspaceSha256: hash(90) };
  /** @type {any[]} */
  const events = [
    {
      stage: 'account-deployed',
      accountAddress: hash(1),
      verifiedOperations: 52,
      maintenanceRetired: true,
    },
    {
      stage: 'merchants-deployed',
      accountAddress: hash(1),
      merchant: hash(2),
      wrongMerchant: hash(3),
      recipient: hash(4),
    },
  ];
  for (let i = 1; i <= 16; i++)
    events.push(
      {
        stage: 'submission-retained-before-send',
        ordinal: i,
        hash: hash(10 + i),
        bytesSha256: hash(10 + i),
      },
      { stage: 'node-submit-returned', ordinal: i, hash: hash(10 + i), id: '00' + hash(30 + i) },
    );
  events.push({ stage: 'failed', phase: 'confirmation' });
  return {
    source,
    events,
    parent: {
      outcome: 'failed',
      interrupted: false,
      source: identity,
      end: { ...identity },
      cleanup: Array.from({ length: 3 }, () => ({ stopped: true })),
    },
    walletCleanup: [{ stopped: true }, { stopped: true }],
  };
}
test('only the retained post-payment boundary can prepare a separate intent', () => {
  const f = fixture(),
    result = merchantContinuation(f);
  assert.equal(result.account, hash(1));
  assert.equal(result.transactions.length, 16);
  assert.equal(result.ownerCounter, 1n);
  assert.equal(result.expectedBalance, 8n);
});
/** @type {[string, (f: ReturnType<typeof fixture>) => unknown][]} */
const controls = [
  ['unknown last submission', (f) => f.events.splice(f.events.length - 2, 1)],
  ['retained bytes mismatch', (f) => (f.events[2].bytesSha256 = hash(100))],
  ['another returned intent', (f) => (f.events[3].hash = hash(100))],
  ['wrong original source', (f) => (f.source = 'b'.repeat(40))],
  ['source drift', (f) => (f.parent.end.workspaceSha256 = hash(100))],
  ['dirty source', (f) => (f.parent.source.dirty = true)],
  ['interruption', (f) => (f.parent.interrupted = true)],
  [
    'live wallet',
    (f) => {
      const entry = f.walletCleanup[0];
      assert.ok(entry);
      entry.stopped = false;
    },
  ],
  [
    'live container',
    (f) => {
      const entry = f.parent.cleanup[0];
      assert.ok(entry);
      entry.stopped = false;
    },
  ],
  ['earlier phase', (f) => (f.events.at(-1).phase = 'wallet-sync')],
  ['unverified ACC keys', (f) => (f.events[0].verifiedOperations = 51)],
  ['maintenance retained', (f) => (f.events[0].maintenanceRetired = false)],
  ['duplicate merchant', (f) => (f.events[1].wrongMerchant = f.events[1].merchant)],
  ['ambiguous account', (f) => f.events.unshift({ ...f.events[0] })],
];
for (const [label, mutate] of controls)
  test(`continuation refuses ${label}`, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() => merchantContinuation(f));
  });

test('a live credit observation needs no reconnect', async () => {
  /** @type {string[]} */
  const calls = [];
  const result = await confirmedCredit({
    wait: async () => 4n,
    confirm: async () => calls.push('confirm'),
    event: () => calls.push('event'),
    reconnect: async () => {
      calls.push('reconnect');
    },
  });
  assert.deepEqual(result, { state: 4n, reconnected: false });
  assert.deepEqual(calls, []);
});
test('a timeout confirms the ORIGINAL payment before observer reconnect, with no send port', async () => {
  /** @type {string[]} */
  const calls = [];
  let n = 0;
  const result = await confirmedCredit({
    wait: async () => {
      calls.push('wait');
      if (n++ === 0) throw Object.assign(new Error('private'), { name: 'TimeoutError' });
      return 4n;
    },
    confirm: async () => calls.push('confirm-original'),
    event: () => calls.push('event'),
    reconnect: async () => {
      calls.push('stop-old-then-reconnect');
    },
  });
  assert.deepEqual(result, { state: 4n, reconnected: true });
  assert.deepEqual(calls, ['wait', 'confirm-original', 'event', 'stop-old-then-reconnect', 'wait']);
});
test('unknown/forked original outcome prevents reconnect and never dispatches', async () => {
  let reconnect = 0;
  await assert.rejects(
    confirmedCredit({
      wait: async () => {
        throw Object.assign(new Error(), { name: 'TimeoutError' });
      },
      confirm: async () => {
        throw Error('unknown original');
      },
      event: () => {},
      reconnect: async () => {
        reconnect++;
      },
    }),
    /unknown original/,
  );
  assert.equal(reconnect, 0);
});
test('non-timeout observer failures and a second timeout are preserved without loops', async () => {
  let confirms = 0,
    reconnects = 0;
  const ports = {
    wait: async () => {
      throw Error('transport');
    },
    confirm: async () => {
      confirms++;
    },
    event: () => {},
    reconnect: async () => {
      reconnects++;
    },
  };
  await assert.rejects(confirmedCredit(ports), /transport/);
  assert.equal(confirms, 0);
  ports.wait = async () => {
    throw Object.assign(new Error('still pending'), { name: 'TimeoutError' });
  };
  await assert.rejects(confirmedCredit(ports), /still pending/);
  assert.equal(confirms, 1);
  assert.equal(reconnects, 1);
});
