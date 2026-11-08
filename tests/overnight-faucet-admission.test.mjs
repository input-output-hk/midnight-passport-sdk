import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { test } from 'node:test';
import {
  original,
  changedId,
  max,
  result,
  json,
  client,
  failure,
} from './fixtures/overnight-faucet-transport.mjs';

for (const amount of [
  '0',
  '01',
  '-1',
  '1.0',
  '',
  max.slice(0, -1) + '6',
  '1' + '0'.repeat(39),
  '9'.repeat(1_000_000),
]) {
  test(`invalid amount of ${amount.length} digits refuses before credentials`, async () => {
    let auth = 0,
      calls = 0;
    await assert.rejects(
      client(
        async () => {
          calls++;
          return json(result);
        },
        undefined,
        async () => {
          auth++;
          return {};
        },
      ).fund({ ...original, amount }),
      (error) => failure(error, 0, 'invalid funding request'),
    );
    assert.equal(auth, 0);
    assert.equal(calls, 0);
  });
}

for (const field of ['requestId', 'manifestSha256', 'accountAddress', 'color']) {
  test(`malformed ${field} refuses before credentials`, async () => {
    let auth = 0;
    await assert.rejects(
      client(
        async () => json(result),
        undefined,
        async () => {
          auth++;
          return {};
        },
      ).fund({ ...original, [field]: 'UPPER-invalid' }),
      (error) => failure(error, 0, 'invalid funding request'),
    );
    assert.equal(auth, 0);
  });
}

test('nonprimitive inputs are not coerced and throwing getters expose only fixed admission error', async () => {
  let coercions = 0,
    auth = 0;
  const remote = client(
    async () => json(result),
    undefined,
    async () => {
      auth++;
      return {};
    },
  );
  for (const candidate of [
    null,
    [],
    { ...original, amount: Buffer.from('10') },
    {
      ...original,
      amount: {
        toString() {
          coercions++;
          throw Error('private');
        },
      },
    },
    new Proxy(
      { ...original },
      {
        get(target, key, receiver) {
          if (key === 'amount') throw Error('PRIVATE_INPUT');
          return Reflect.get(target, key, receiver);
        },
      },
    ),
  ])
    await assert.rejects(Reflect.apply(remote.fund, remote, [candidate]), (error) =>
      failure(error, 0, 'invalid funding request'),
    );
  assert.equal(coercions, 0);
  assert.equal(auth, 0);
});

test('canonical UUID shape, generic strings and Uint128 maximum remain supported', async () => {
  const request = {
    ...original,
    requestId: '00000000-0000-0000-0000-000000000000',
    networkId: 'n'.repeat(5000),
    bindingId: '',
    amount: max,
  };
  const answer = { ...result, requestId: request.requestId, creditedBalance: max };
  assert.deepEqual(
    await client(async (_url, init) => {
      assert.deepEqual(JSON.parse(init?.body ?? ''), request);
      return json(answer);
    }).fund(request),
    answer,
  );
});

for (const patch of [
  { requestId: changedId },
  { txId: '' },
  { txId: 5 },
  { creditedBalance: '0' },
  { creditedBalance: '9'.repeat(100) },
  { preparationTxId: 5 },
]) {
  test(`malformed result ${JSON.stringify(patch).slice(0, 90)} refuses with known status`, async () => {
    await assert.rejects(
      client(async () => json({ ...result, ...patch })).fund({ ...original }),
      (error) => failure(error, 200, 'funding service answered an invalid result'),
    );
  });
}

test('result projection is owned, retains optional empty string and removes extensions', async () => {
  const body = { ...result, preparationTxId: '', privateExtension: 'synthetic' };
  const returned = await client(async () => json(body)).fund({ ...original });
  body.txId = 'changed';
  body.preparationTxId = 'changed';
  assert.deepEqual(returned, { ...result, preparationTxId: '' });
  assert.equal(returned === body, false);
});

test('large arbitrary provider IDs stay valid without an implicit native response cap', async () => {
  const body = { ...result, txId: 'provider-'.repeat(20_000) };
  assert.deepEqual(
    await client(async () => new Response(JSON.stringify(body)), 10_000).fund({ ...original }),
    body,
  );
});

test('expiry during synchronous request admission is public status0 and no authentication/fetch', async () => {
  let auth = 0,
    calls = 0;
  const request = {
    ...original,
    get amount() {
      const end = performance.now() + 20;
      while (performance.now() < end) {
        /* Owned caller work cannot be preempted. */
      }
      return '10';
    },
  };
  await assert.rejects(
    client(
      async () => {
        calls++;
        return json(result);
      },
      1,
      async () => {
        auth++;
        return {};
      },
    ).fund(request),
    (error) => failure(error, 0, 'funding service is unreachable'),
  );
  assert.equal(auth, 0);
  assert.equal(calls, 0);
});

test('expiry during result projection keeps known-status invalidJSON shape', async () => {
  const body = {
    ...result,
    get txId() {
      const end = performance.now() + 30;
      while (performance.now() < end) {
        /* Owned host getter. */
      }
      return 'late';
    },
  };
  await assert.rejects(client(async () => json(body), 15).fund({ ...original }), (error) =>
    failure(error, 200, 'funding service answered invalid JSON'),
  );
});

for (const timeoutMs of [0, -1, 0.5, NaN, Infinity, 2_147_483_648]) {
  test(`invalid timeout ${timeoutMs} refuses before credentials`, async () => {
    let auth = 0,
      calls = 0;
    await assert.rejects(
      client(
        async () => {
          calls++;
          return json(result);
        },
        timeoutMs,
        async () => {
          auth++;
          return {};
        },
      ).fund({ ...original }),
      (error) => failure(error, 0, 'invalid funding timeout'),
    );
    assert.equal(auth, 0);
    assert.equal(calls, 0);
  });
}

test('maximum explicit timer closes after accepted result and releases native abort listeners', async () => {
  /** @type {AbortSignal|undefined} */ let wire;
  const response = {
    ok: true,
    status: 200,
    async json() {
      assert.equal(this, response);
      return result;
    },
  };
  assert.deepEqual(
    await client(async (_url, init) => {
      assert.ok(init?.signal instanceof AbortSignal);
      wire = init.signal;
      return response;
    }, 2_147_483_647).fund({ ...original }),
    result,
  );
  assert.equal(wire?.aborted, false);
  assert.equal(getEventListeners(wire, 'abort').length, 0);
});

test('result getters are captured once into the owned public projection', async () => {
  const values = { ...result, preparationTxId: '' };
  /** @type {Record<string,number>} */ const reads = {};
  const body = Object.defineProperties(
    { ...values },
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        {
          get() {
            reads[key] = (reads[key] ?? 0) + 1;
            return reads[key] === 1 ? value : 'changed';
          },
        },
      ]),
    ),
  );
  assert.deepEqual(await client(async () => json(body)).fund({ ...original }), values);
  assert.deepEqual(reads, Object.fromEntries(Object.keys(values).map((key) => [key, 1])));
});

test('nonnumber timeout refuses without coercion or credentials', async () => {
  let auth = 0,
    coercions = 0;
  for (const timeoutMs of [
    1n,
    '20',
    true,
    {
      valueOf() {
        coercions++;
        throw Error('private');
      },
    },
  ]) {
    const options = {
      headers: async () => {
        auth++;
        return {};
      },
      fetch: async () => json(result),
      timeoutMs,
    };
    const remote = Reflect.apply(
      (await import('../packages/adapter-service/dist/index.js')).remoteFaucet,
      undefined,
      ['http://injected.invalid', options],
    );
    await assert.rejects(remote.fund({ ...original }), (error) =>
      failure(error, 0, 'invalid funding timeout'),
    );
  }
  assert.equal(auth, 0);
  assert.equal(coercions, 0);
});
