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
    read: async (/** @type {any} */ i) => structuredClone(records.get(i.requestId)),
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
  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve(undefined)));
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    base,
    driver,
    executor,
    records,
    store,
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

for (const kind of ['reconcile', 'submit'])
  test(`remote host ${kind} propagates cancellation`, async () => {
    const controller = new AbortController();
    /** @type {AbortSignal|undefined} */ let wireSignal;
    const remote = remoteHostMutationPorts('http://127.0.0.1:9999', {
      pins,
      token,
      fetch: async (_url, init) => {
        wireSignal = /** @type {AbortSignal} */ (init?.signal);
        const signal = wireSignal;
        assert.ok(signal);
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }),
        );
      },
    });
    const result =
      kind === 'reconcile'
        ? remote.outcomes.reconcile(
            pins,
            { key: mutation.requestId, digest: mutation.intentSha256, kind: 'deploy', input: {} },
            { signal: controller.signal },
          )
        : remote.submitter.submit(new Uint8Array([1]), {
            mutation,
            address: 'ab'.repeat(32),
            circuit: 'append_inbox_with_jubjub',
            signal: controller.signal,
          });
    controller.abort();
    await assert.rejects(result, { code: 'MutationUnsettled' });
    assert.equal(wireSignal?.aborted, true);
  });

const callInput = { tx: '010203', address: 'ab'.repeat(32), circuit: 'append_inbox_with_jubjub' };
const callIdentity = { pins, ...mutation, kind: /** @type {const} */ ('call') };
const callEffect = {
  kind: /** @type {const} */ ('call'),
  key: mutation.requestId,
  digest: mutation.intentSha256,
  input: {},
};
const rawCall = (
  /** @type {string} */ base,
  /** @type {string} */ path,
  /** @type {unknown} */ body,
  auth = token,
) =>
  fetch(`${base}/v1/mutations/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      connection: 'close',
      authorization: `Bearer ${auth}`,
    },
    body: JSON.stringify(body),
  });
function gate() {
  let release = () => {};
  const promise = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  return { promise, release };
}

test('HTTP call preparation retries only original bytes through a fresh executor; auth/conflicts cannot trigger it', async (t) => {
  const f = await fixture(t);
  /** @type {unknown[]} */ const inputs = [];
  f.driver.prepare = async (_i, value) => {
    inputs.push(value);
    if (inputs.length === 1) throw new Error('protected preparation diagnostic');
    return { address: callInput.address, steps: 1, context: { original: value } };
  };
  await assert.rejects(
    f.ports.submitter.submit(Uint8Array.of(1, 2, 3), {
      mutation,
      address: callInput.address,
      circuit: callInput.circuit,
    }),
    { code: 'MutationUnsettled' },
  );
  assert.equal(f.records.get(mutation.requestId)?.phase, 'preparing');
  const before = structuredClone(f.records.get(mutation.requestId));
  const wrong = await rawCall(f.base, 'execute', {
    identity: callIdentity,
    input: { ...callInput, tx: 'ff' },
  });
  assert.equal(wrong.status, 409);
  assert.ok(!(await wrong.text()).includes('protected preparation diagnostic'));
  assert.equal(
    (await rawCall(f.base, 'reconcile', { identity: callIdentity }, '00'.repeat(32))).status,
    401,
  );
  assert.equal(
    (
      await rawCall(f.base, 'reconcile', {
        identity: { ...callIdentity, pins: { ...pins, networkId: 'preprod' } },
      })
    ).status,
    409,
  );
  assert.deepEqual(f.records.get(mutation.requestId), before);
  assert.equal(inputs.length, 1);
  assert.equal(f.sends(), 0);
  const fresh = createHostMutationExecutor(f.store, f.driver);
  f.executor.resume = (...args) => fresh.resume(...args);
  const result = await f.ports.outcomes.reconcile(pins, callEffect);
  assert.equal(result.kind, 'confirmed');
  assert.deepEqual(inputs, [callInput, callInput]);
  assert.equal(f.sends(), 1);
  assert.deepEqual(await f.ports.outcomes.reconcile(pins, callEffect), result);
  assert.equal(inputs.length, 2);
  assert.equal(f.sends(), 1);
});

test('HTTP persistent call preparation refusal is sanitised and never becomes a no-send or replacement answer', async (t) => {
  const f = await fixture(t);
  let attempts = 0;
  f.driver.prepare = async () => {
    attempts++;
    throw new Error('secret diagnostic fixture');
  };
  for (const path of ['execute', 'reconcile', 'reconcile']) {
    const response = await rawCall(f.base, path, {
      identity: callIdentity,
      ...(path === 'execute' && { input: callInput }),
    });
    assert.equal(response.status, 409);
    const body = await response.text();
    assert.ok(!body.includes('secret diagnostic fixture'));
    assert.match(body, /original request ID/);
  }
  assert.equal(attempts, 3);
  assert.equal(f.sends(), 0);
  assert.equal(f.records.get(mutation.requestId)?.phase, 'preparing');
  assert.deepEqual(f.records.get(mutation.requestId)?.input, callInput);
});

test('HTTP reconciliation preserves ready call bytes when its dispatch validation refuses', async (t) => {
  const f = await fixture(t);
  let attempts = 0,
    expired = false;
  f.driver.prepare = async () => {
    if (++attempts === 1) throw new Error('temporary preparation outage');
    return { address: callInput.address, steps: 1, context: {} };
  };
  f.driver.prepareStep = async () => {
    expired = true;
    return { tx: callInput.tx, identifiers: [txid(1)] };
  };
  f.driver.check = async () => !expired;
  assert.equal(
    (await rawCall(f.base, 'execute', { identity: callIdentity, input: callInput })).status,
    409,
  );
  assert.deepEqual(await f.ports.outcomes.reconcile(pins, callEffect), { kind: 'unknown' });
  const before = structuredClone(f.records.get(mutation.requestId));
  assert.deepEqual(await f.ports.outcomes.reconcile(pins, callEffect), { kind: 'unknown' });
  assert.deepEqual(f.records.get(mutation.requestId), before);
  assert.equal(before?.steps[0]?.tx, callInput.tx);
  assert.equal(f.sends(), 0);
  assert.equal(attempts, 2);
});

for (const failure of ['cancellation', 'timeout'])
  test(
    `HTTP ${failure} during call preparation retains output and allows only explicit same-ID continuation`,
    { timeout: 10000 },
    async (t) => {
      const f = await fixture(t),
        entered = gate(),
        released = gate(),
        aborted = gate(),
        persisted = gate();
      const controller = new AbortController();
      let attempts = 0,
        posts = 0;
      const execute = f.executor.execute;
      let receivedSignal = false;
      f.executor.execute = (i, input, options) => {
        receivedSignal = !!options?.signal;
        if (!receivedSignal) {
          entered.release();
          aborted.release();
          return Promise.reject(new Error('Route omitted the abort signal.'));
        }
        options?.signal?.aborted
          ? aborted.release()
          : /** @type {AbortSignal} */ (options?.signal)?.addEventListener(
              'abort',
              aborted.release,
              { once: true },
            );
        return execute(i, input, options);
      };
      const save = f.store.compareAndSwap;
      f.store.compareAndSwap = async (revision, record) => {
        const ok = await save(revision, record);
        if (ok && record.phase === 'active') persisted.release();
        return ok;
      };
      f.driver.prepare = async (_i, input) => {
        attempts++;
        assert.deepEqual(input, callInput);
        entered.release();
        await released.promise;
        return { address: callInput.address, steps: 1, context: { original: input } };
      };
      const ports = remoteHostMutationPorts(f.base, {
        pins,
        token,
        timeoutMs: failure === 'timeout' ? 1000 : 5000,
        fetch: async (url, init) => {
          posts++;
          return fetch(url, {
            .../** @type {RequestInit} */ (init),
            headers: { ...init?.headers, connection: 'close' },
          });
        },
      });
      const pending = ports.submitter.submit(Uint8Array.of(1, 2, 3), {
        mutation,
        address: callInput.address,
        circuit: callInput.circuit,
        signal: controller.signal,
      });
      const refused = assert.rejects(pending, { code: 'MutationUnsettled' });
      try {
        await entered.promise;
        assert.ok(receivedSignal, 'Route must pass its abort signal to the executor.');
        if (failure === 'cancellation') controller.abort();
        await refused;
        await aborted.promise;
        assert.equal(posts, 1, 'Transport failure never automatically repeats execute.');
        released.release();
        await persisted.promise;
        assert.equal(f.sends(), 0);
        assert.equal((await ports.outcomes.reconcile(pins, callEffect)).kind, 'confirmed');
        assert.equal(posts, 2);
        assert.equal(attempts, 1);
        assert.equal(f.sends(), 1);
        assert.deepEqual(f.records.get(mutation.requestId)?.input, callInput);
      } finally {
        released.release();
        await Promise.allSettled([pending]);
      }
    },
  );
