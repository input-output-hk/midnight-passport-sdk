import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassportConnectorError } from '../packages/account/dist/errors.js';
import { remoteHostJobs, remoteHostJobId } from '../packages/adapter-service/dist/index.js';
import { hostHash } from '../packages/service/dist/index.js';
import { descriptor, barrier } from './fixtures/host-jobs.mjs';
const d = descriptor(),
  common = {
    pins: d.identity.pins,
    token: 'cd'.repeat(32),
    timeoutMs: 200,
    requestTimeoutMs: 100,
    pollIntervalMs: 0,
  };
async function doneSnapshot() {
  return {
    jobId: await remoteHostJobId(d.identity),
    identitySha256: hostHash(d.identity),
    state: 'done',
    milestones: { preparedSteps: 1, confirmedSteps: 1 },
    events: [{ sequence: 1, state: 'done', at: 0, preparedSteps: 1, confirmedSteps: 1 }],
    cursor: '1',
    firstCursor: '0',
    outcome: {
      kind: 'confirmed',
      digest: d.identity.intentSha256,
      result: { txHash: 'ab'.repeat(32), submissionId: 'cd'.repeat(32) },
    },
  };
}

test('async observer is awaited and can mutate only its cloned public snapshot', async () => {
  const snapshot = await doneSnapshot(),
    entered = barrier(),
    release = barrier();
  let settled = false,
    calls = 0;
  const client = remoteHostJobs('https://unused.invalid', {
    ...common,
    fetch: async () => {
      calls++;
      return { ok: true, status: 200, json: async () => snapshot };
    },
    onSnapshot: async (value) => {
      entered.release();
      await release.promise;
      Object.assign(value, { state: 'queued' });
    },
  });
  const work = client.wait(d.identity).finally(() => {
    settled = true;
  });
  try {
    await entered.promise;
    assert.equal(settled, false);
    release.release();
    assert.equal((await work)?.state, 'done');
    assert.equal(snapshot.state, 'done');
    assert.equal(calls, 1);
  } finally {
    release.release();
    await work;
  }
});

for (const asyncObserver of [false, true])
  test(`observer rejection refuses observation without replay (async=${asyncObserver})`, async () => {
    const snapshot = await doneSnapshot();
    let calls = 0;
    const reject = () => {
      throw Error('protected observer detail');
    };
    const client = remoteHostJobs('https://unused.invalid', {
      ...common,
      fetch: async () => {
        calls++;
        return { ok: true, status: 200, json: async () => snapshot };
      },
      onSnapshot: asyncObserver ? async () => reject() : reject,
    });
    await assert.rejects(client.wait(d.identity), (error) => {
      assert.ok(error instanceof PassportConnectorError);
      assert.equal(error.code, 'MutationUnsettled');
      assert.doesNotMatch(error.message, /protected observer detail/);
      return true;
    });
    assert.equal(calls, 1);
    assert.equal(snapshot.state, 'done');
    // A fresh explicit read retains the original completed result and does not invoke the observer.
    assert.equal((await client.get(d.identity))?.state, 'done');
    assert.equal(calls, 2);
  });

test('never-settling observer is bounded by total invocation timeout', async () => {
  const snapshot = await doneSnapshot();
  let calls = 0;
  const client = remoteHostJobs('https://unused.invalid', {
    ...common,
    timeoutMs: 20,
    fetch: async () => {
      calls++;
      return { ok: true, status: 200, json: async () => snapshot };
    },
    onSnapshot: () => new Promise(() => {}),
  });
  await assert.rejects(client.wait(d.identity), { code: 'MutationUnsettled' });
  assert.equal(calls, 1);
  assert.equal(snapshot.state, 'done');
});

test('abort while observing settles promptly and consumes a later rejection', async () => {
  const snapshot = await doneSnapshot(),
    entered = barrier(),
    release = barrier(),
    controller = new AbortController();
  let calls = 0;
  const client = remoteHostJobs('https://unused.invalid', {
    ...common,
    fetch: async () => {
      calls++;
      return { ok: true, status: 200, json: async () => snapshot };
    },
    onSnapshot: async () => {
      entered.release();
      await release.promise;
      throw Error('late synthetic observer rejection');
    },
  });
  const operation = client.wait(d.identity, controller.signal),
    refused = assert.rejects(operation, { code: 'MutationUnsettled' });
  try {
    await entered.promise;
    controller.abort();
    await refused;
  } finally {
    release.release();
  }
  // node:test treats an unhandled late rejection as test failure; give its event a complete turn.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(snapshot.state, 'done');
});

test('total deadline consumes a later observer rejection without another request', async () => {
  const snapshot = await doneSnapshot(),
    release = barrier();
  let calls = 0;
  const client = remoteHostJobs('https://unused.invalid', {
    ...common,
    timeoutMs: 20,
    fetch: async () => {
      calls++;
      return { ok: true, status: 200, json: async () => snapshot };
    },
    onSnapshot: async () => {
      await release.promise;
      throw Error('late synthetic observer rejection');
    },
  });
  try {
    await assert.rejects(client.wait(d.identity), { code: 'MutationUnsettled' });
  } finally {
    release.release();
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
});

test('observer retains its options receiver while using the captured callback', async () => {
  const snapshot = await doneSnapshot();
  const options = {
    ...common,
    observations: 0,
    fetch: async () => ({ ok: true, status: 200, json: async () => snapshot }),
    onSnapshot() {
      this.observations++;
    },
  };
  const client = remoteHostJobs('https://unused.invalid', options);
  await client.wait(d.identity);
  assert.equal(options.observations, 1);
});
