import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createServer,
  createHostMutationExecutor,
  hostMutationRoute,
  createDeploymentBudget,
} from '../packages/service/dist/index.js';
import { remoteHostMutationPorts } from '../packages/adapter-service/dist/index.js';
const pins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  scheme: /** @type {const} */ ('jubjub-schnorr'),
};
const token = '12'.repeat(32),
  mutation = { requestId: '34'.repeat(16) + ':0', intentSha256: '56'.repeat(32) };
const txid = (/** @type {number} */ n) => n.toString(16).padStart(64, '0');
/** @param {import('node:test').TestContext} t */
async function fixture(t, tagged = false) {
  const watch = (/** @type {number} */ n) => (tagged ? '00' : '') + txid(n);
  /** @type {Map<string,import('../packages/service/dist/index.js').HostMutationRecord>} */ const records =
    new Map();
  let sends = 0;
  const store = {
    read: async (/** @type {any} */ i) => records.get(i.requestId),
    compareAndSwap: async (/** @type {number|undefined} */ old, /** @type {any} */ next) => {
      if (records.get(next.identity.requestId)?.revision !== old) return false;
      records.set(next.identity.requestId, structuredClone(next));
      return true;
    },
  };
  /** @type {import('../packages/service/dist/index.js').HostMutationDriver} */
  const driver = {
    prepare: async (i) => ({
      address: 'ab'.repeat(32),
      steps: i.kind === 'deploy' ? 3 : 1,
      context: {},
    }),
    prepareStep: async (_r, index) => ({ tx: 'ab', identifiers: [watch(index + 1)] }),
    submit: async (p) => {
      sends++;
      return /** @type {string} */ (p.identifiers[0]);
    },
    lookup: async (p) => ({
      identifier: /** @type {string} */ (p.identifiers[0]),
      txHash: txid(99),
      blockHeight: 7,
      succeeded: true,
    }),
    check: async () => true,
  };
  const executor = createHostMutationExecutor(store, driver),
    budget = createDeploymentBudget(1);
  const server = createServer({ host: '127.0.0.1', corsOrigin: 'http://localhost:5173' }, [
    hostMutationRoute({
      executor,
      pins: {
        networkId: pins.networkId,
        bindingId: pins.bindingId,
        manifestSha256: pins.manifestSha256,
      },
      token: new Uint8Array(Buffer.from(token, 'hex')),
      acceptDeployment: () => budget.accept(),
    }),
  ]);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    driver,
    executor,
    records,
    sends: () => sends,
    ports: remoteHostMutationPorts(base, { pins, token, timeoutMs: 1000, pollIntervalMs: 0 }),
  };
}
test('authenticated host deployer resumes the same request and does not consume budget twice', async (t) => {
  const f = await fixture(t),
    request = {
      boot: new Uint8Array(32).fill(1),
      encKey: new Uint8Array(32).fill(2),
      retireAuthority: true,
      firstArm: /** @type {const} */ ('jubjub'),
      mutation,
    };
  const result = await f.ports.deployer.deploy(request);
  assert.deepEqual(result, { address: 'ab'.repeat(32), txIds: [txid(1), txid(2), txid(3)] });
  assert.deepEqual(await f.ports.deployer.deploy(request), result);
  assert.equal(f.sends(), 3);
  await assert.rejects(f.ports.deployer.deploy({ ...request, retireAuthority: false }), {
    code: 'MutationUnsettled',
  });
  const status = await f.executor.inspect({ pins, ...mutation, kind: 'deploy' });
  assert.deepEqual(status, { phase: 'complete', preparedSteps: 3, confirmedSteps: 3 });
  const response = await fetch(f.base + '/v1/mutations/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(response.status, 401);
  assert.equal(f.sends(), 3);
});
test('submitter returns a watch identifier separately from included transaction hash; outcomes preserve finality', async (t) => {
  const f = await fixture(t),
    context = { mutation, address: 'ab'.repeat(32), circuit: 'append_inbox_with_jubjub' };
  assert.equal(await f.ports.submitter.submit(Uint8Array.of(1), context), txid(1));
  const result = await f.ports.outcomes.reconcile(pins, {
    kind: 'call',
    key: mutation.requestId,
    digest: mutation.intentSha256,
    input: {},
  });
  assert.deepEqual(result, {
    kind: 'confirmed',
    digest: mutation.intentSha256,
    result: { txHash: txid(99), blockHeight: 7 },
  });
  assert.equal(f.sends(), 1);
  await assert.rejects(f.ports.submitter.submit(Uint8Array.of(2)), { code: 'MutationUnsettled' });
  await assert.rejects(
    f.ports.outcomes.reconcile(
      { ...pins, networkId: 'preprod' },
      { kind: 'call', key: mutation.requestId, digest: mutation.intentSha256, input: {} },
    ),
    { code: 'MutationUnsettled' },
  );
});
test('lost initial HTTP response is not automatically re-POSTed; explicit reconcile finds its durable receipt', async (t) => {
  const f = await fixture(t);
  let posts = 0;
  const ports = remoteHostMutationPorts(f.base, {
    pins,
    token,
    fetch: async (url, init) => {
      posts++;
      const response = await fetch(url, /** @type {RequestInit} */ (init));
      if (url.endsWith('/execute')) throw new Error('lost response after acceptance');
      return response;
    },
  });
  await assert.rejects(
    ports.deployer.deploy({
      boot: new Uint8Array(32),
      encKey: new Uint8Array(32),
      retireAuthority: true,
      firstArm: 'jubjub',
      mutation,
    }),
    { code: 'MutationUnsettled' },
  );
  assert.equal(posts, 1);
  assert.equal(f.sends(), 3);
  const result = await ports.outcomes.reconcile(pins, {
    kind: 'deploy',
    key: mutation.requestId,
    digest: mutation.intentSha256,
    input: {},
  });
  assert.equal(result.kind, 'confirmed');
  assert.equal(f.sends(), 3);
  assert.equal(posts, 2);
});
test('unknown finality stays unknown through authenticated reconciliation without more submissions', async (t) => {
  const f = await fixture(t);
  f.driver.lookup = async () => undefined;
  const raw = await fetch(f.base + '/v1/mutations/execute', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      identity: { pins, ...mutation, kind: 'deploy' },
      input: { retireAuthority: true },
    }),
  });
  assert.deepEqual(await raw.json(), { kind: 'unknown' });
  assert.equal(f.sends(), 1);
  assert.deepEqual(
    await f.ports.outcomes.reconcile(pins, {
      kind: 'deploy',
      key: mutation.requestId,
      digest: mutation.intentSha256,
      input: {},
    }),
    { kind: 'unknown' },
  );
  assert.equal(f.sends(), 1);
  const unknown = await f.ports.outcomes.reconcile(pins, {
    kind: 'deploy',
    key: '99'.repeat(16) + ':0',
    digest: mutation.intentSha256,
    input: {},
  });
  assert.deepEqual(unknown, { kind: 'unknown' }, 'absence never becomes no-send');
});

test('native 33-byte tagged watch IDs survive host persistence and both RPC result shapes', async (t) => {
  const f = await fixture(t, true);
  const deployed = await f.ports.deployer.deploy({
    boot: new Uint8Array(32).fill(1),
    encKey: new Uint8Array(32).fill(2),
    firstArm: 'jubjub',
    retireAuthority: true,
    mutation,
  });
  assert.deepEqual(
    deployed.txIds,
    [1, 2, 3].map((n) => '00' + txid(n)),
  );
  const call = await fixture(t, true);
  assert.equal(
    await call.ports.submitter.submit(Uint8Array.of(1), {
      mutation,
      address: 'ab'.repeat(32),
      circuit: 'append_inbox_with_jubjub',
    }),
    '00' + txid(1),
  );
  const outcome = await call.ports.outcomes.reconcile(pins, {
    kind: 'call',
    key: mutation.requestId,
    digest: mutation.intentSha256,
    input: {},
  });
  assert.equal(outcome.kind, 'confirmed');
  if (outcome.kind === 'confirmed' && 'txHash' in outcome.result)
    assert.equal(outcome.result.txHash, txid(99));
});
