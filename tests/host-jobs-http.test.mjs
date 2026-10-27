import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, hostJobRoute } from '../packages/service/dist/index.js';
import { fixture, descriptor, servicePins, barrier } from './fixtures/host-jobs.mjs';
const token = 'ab'.repeat(32);
/** @param {import('node:test').TestContext} t */
async function serverFixture(t) {
  const f = fixture(),
    server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
      hostJobRoute({
        jobs: f.jobs,
        pins: servicePins,
        token: new Uint8Array(Buffer.from(token, 'hex')),
      }),
    ]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  t.after(async () => {
    f.jobs.stopAdmission();
    await f.jobs.drain();
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
      server.closeAllConnections();
    });
  });
  const base = `http://127.0.0.1:${address.port}/v1/host-jobs/`;
  const request = async (
    /** @type {string} */ path,
    /** @type {unknown} */ body = undefined,
    auth = true,
  ) =>
    fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        ...(auth ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { ...f, request };
}
test(
  'authenticated HTTP acceptance and asynchronous start expose bounded public status',
  { timeout: 10000 },
  async (t) => {
    const f = await serverFixture(t),
      entered = barrier(),
      release = barrier(),
      prepare = f.driver.prepare;
    f.driver.prepare = async (...args) => {
      entered.release();
      await release.promise;
      return prepare(...args);
    };
    try {
      assert.equal((await f.request('accept', descriptor(), false)).status, 401);
      assert.equal(f.counts().executions, 0);
      assert.equal(
        (
          await f.request('accept', {
            ...descriptor(),
            identity: {
              ...descriptor().identity,
              pins: { ...descriptor().identity.pins, networkId: 'preview' },
            },
          })
        ).status,
        409,
      );
      const accepted = await f.request('accept', descriptor());
      assert.equal(accepted.status, 202);
      const a = /** @type {{jobId:string}} */ (await accepted.json());
      assert.equal((await f.request('start', { jobId: a.jobId })).status, 202);
      await entered.promise;
      const active = /** @type {import('../packages/service/dist/index.js').HostJobView} */ (
        await (await f.request(a.jobId)).json()
      );
      assert.equal(active.state, 'running');
      assert.ok(!JSON.stringify(active).includes('append_inbox'));
      assert.equal(f.counts().sends, 0);
      assert.equal((await f.request(a.jobId + '?after=-1')).status, 400);
      assert.equal((await f.request(a.jobId + '?after=0&after=0')).status, 400);
      assert.equal((await f.request('start', { jobId: a.jobId, extra: 'refuse' })).status, 400);
      release.release();
      await f.jobs.drain();
      const done = /** @type {import('../packages/service/dist/index.js').HostJobView} */ (
        await (await f.request(a.jobId)).json()
      );
      assert.equal(done.state, 'done');
      assert.ok(done.outcome && 'txHash' in done.outcome.result);
      assert.equal(done.outcome.result.txHash, 'ef'.repeat(32));
      assert.equal((await f.request('reconcile', { jobId: a.jobId })).status, 202);
      await f.jobs.drain();
      assert.equal(f.counts().sends, 1);
      assert.equal((await f.request(a.jobId, undefined, false)).status, 401);
    } finally {
      release.release();
      await f.jobs.drain();
    }
  },
);
test('lost acceptance response is recovered by original descriptor; errors disclose no backend details', async (t) => {
  const f = await serverFixture(t),
    d = descriptor();
  const first = /** @type {{jobId:string}} */ (await (await f.request('accept', d)).json());
  const retry = await (await f.request('accept', d)).json();
  assert.deepEqual(retry, first);
  assert.equal(f.counts().executions, 0);
  f.driver.prepare = async () => {
    throw new Error('protected sponsor key and private proof diagnostics');
  };
  await f.request('start', { jobId: first.jobId });
  await f.jobs.drain();
  const unknown = /** @type {import('../packages/service/dist/index.js').HostJobView} */ (
    await (await f.request(first.jobId)).json()
  );
  assert.equal(unknown.state, 'unknown');
  assert.equal(unknown.error?.code, 'MutationUnsettled');
  assert.ok(!JSON.stringify(unknown).includes('protected'));
  await f.request('start', { jobId: first.jobId });
  await f.jobs.drain();
  assert.equal(f.counts().executions, 1);
  assert.equal((await f.request('start', { jobId: 'not-an-id' })).status, 400);
  assert.equal((await f.request('start', { jobId: '45'.repeat(16) })).status, 404);
});
