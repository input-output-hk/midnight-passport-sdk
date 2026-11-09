import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFundingBalanceReader } from '../src/funding-balances.js';

const address = 'ab'.repeat(32),
  color = '00'.repeat(32);
function response(availability: string, night = '20') {
  return {
    ok: true,
    json: async () => ({
      accountAddress: address,
      assets: [{ color, amount: '10', availability }],
      balanceAssetColor: color,
      balances: { night, fundedAsset: '0' },
    }),
  };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

test('post-deposit unavailable inventory is refreshed with GET observations until synchronized', async () => {
  const account = { address },
    views: string[] = [],
    states: string[] = [],
    waits: number[] = [];
  const observations = [response('unavailable'), response('available')];
  let reads = 0;
  const read = createFundingBalanceReader({
    current: () => account,
    color: () => color,
    url: new URL('http://local/v1/demo/funding'),
    fetch: async (url, init) => {
      assert.equal(new URL(url).searchParams.get('accountAddress'), address);
      assert.deepEqual(Object.keys(init ?? {}), ['signal']);
      const next = observations[reads++];
      assert.ok(next);
      return next;
    },
    show: (view) => views.push(view.assets[0]?.availability ?? ''),
    unavailable: () => assert.fail('valid balance read must not become unavailable'),
    state: (state) => states.push(state),
    pause: async (ms) => {
      waits.push(ms);
    },
  });
  assert.deepEqual(await read(address), { night: '20', fundedAsset: '0' });
  assert.equal(reads, 2);
  assert.deepEqual(waits, [1000]);
  assert.deepEqual(views, ['unavailable', 'available']);
  assert.deepEqual(states, ['checking', 'waiting', 'checking', 'ready']);
});

test('unknown inventory has a finite recovery budget and an explicit later read can restore it', async () => {
  const account = { address },
    waits: number[] = [],
    states: string[] = [];
  let availability = 'unavailable',
    reads = 0;
  const read = createFundingBalanceReader({
    current: () => account,
    color: () => color,
    url: new URL('http://local/'),
    fetch: async () => {
      reads++;
      return response(availability);
    },
    show: () => {},
    unavailable: () => assert.fail('balances still known'),
    state: (state) => states.push(state),
    pause: async (ms) => {
      waits.push(ms);
    },
  });
  await read(address);
  assert.equal(reads, 3);
  assert.deepEqual(waits, [1000, 2000]);
  assert.equal(states.at(-1), 'unavailable');
  availability = 'available';
  await read(address);
  assert.equal(reads, 4);
  assert.equal(states.at(-1), 'ready');
});

test('insufficient stock is not a synchronization retry', async () => {
  const account = { address };
  let reads = 0;
  const read = createFundingBalanceReader({
    current: () => account,
    color: () => color,
    url: new URL('http://local/'),
    fetch: async () => {
      reads++;
      return response('insufficient');
    },
    show: () => {},
    unavailable: () => assert.fail('known balances'),
    pause: async () => assert.fail('do not poll insufficient inventory'),
  });
  await read(address);
  assert.equal(reads, 1);
});

test('manual observation supersedes a delayed recovery without a stale UI projection', async () => {
  const account = { address },
    pause = deferred<void>(),
    views: string[] = [];
  let reads = 0;
  const read = createFundingBalanceReader({
    current: () => account,
    color: () => color,
    url: new URL('http://local/'),
    fetch: async () => response(reads++ === 0 ? 'unavailable' : 'available', String(reads)),
    show: (view) => views.push(view.night),
    unavailable: () => assert.fail('stale error'),
    pause: () => pause.promise,
  });
  const old = read(address);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(views, ['1']);
  await read(address);
  pause.resolve();
  assert.equal(await old, undefined);
  assert.deepEqual(views, ['1', '2']);
  assert.equal(reads, 2);
});

test('same-address account replacement fences the pending recovery', async () => {
  let current = { address },
    reads = 0;
  const pause = deferred<void>(),
    states: string[] = [];
  const read = createFundingBalanceReader({
    current: () => current,
    color: () => color,
    url: new URL('http://local/'),
    fetch: async () => {
      reads++;
      return response('unavailable');
    },
    show: () => {},
    unavailable: () => assert.fail('replaced account'),
    state: (state) => states.push(state),
    pause: () => pause.promise,
  });
  const pending = read(address);
  await new Promise<void>((resolve) => setImmediate(resolve));
  current = { address };
  pause.resolve();
  assert.equal(await pending, undefined);
  assert.equal(reads, 1);
  assert.deepEqual(states, ['checking', 'waiting']);
});

test('stop cancels a body decoder that ignores abort and suppresses late completion', async () => {
  const account = { address },
    body = deferred<unknown>(),
    shows: string[] = [];
  const read = createFundingBalanceReader({
    current: () => account,
    color: () => color,
    url: new URL('http://local/'),
    fetch: async () => ({ ok: true, json: () => body.promise }),
    show: (view) => shows.push(view.night),
    unavailable: () => assert.fail('stopped read'),
  });
  const pending = read(address);
  await new Promise<void>((resolve) => setImmediate(resolve));
  read.stop();
  assert.equal(await pending, undefined);
  body.resolve(await response('available').json());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(shows, []);
});

test('the deadline covers response decoding and a later explicit read can recover', async () => {
  const account = { address },
    errors: string[] = [];
  let stalled = true;
  const read = createFundingBalanceReader({
    current: () => account,
    color: () => color,
    url: new URL('http://local/'),
    timeoutMs: 10,
    fetch: async () =>
      stalled ? { ok: true, json: () => new Promise<unknown>(() => {}) } : response('available'),
    show: () => {},
    unavailable: (value) => errors.push(value),
  });
  await assert.rejects(read(address), /read unavailable/);
  assert.deepEqual(errors, [address]);
  stalled = false;
  assert.equal((await read(address))?.night, '20');
});

test('HTTP and malformed-response failures refuse immediately without polling a transfer', async () => {
  for (const result of [
    { ok: false, json: async () => ({}) },
    { ok: true, json: async () => null },
    {
      ok: true,
      json: async () => ({ accountAddress: address, balances: { night: '-1', fundedAsset: '0' } }),
    },
    response('bogus'),
    {
      ok: true,
      json: async () => ({
        ...(await response('available').json()),
        assets: [{ color, amount: '10' }],
      }),
    },
  ]) {
    const account = { address },
      projections: unknown[] = [];
    let failures = 0,
      reads = 0,
      waits = 0;
    const read = createFundingBalanceReader({
      current: () => account,
      color: () => color,
      url: new URL('http://local/'),
      fetch: async () => {
        reads++;
        return result;
      },
      show: (view) => {
        projections.push(view);
      },
      unavailable: () => {
        failures++;
      },
      pause: async () => {
        waits++;
      },
    });
    await assert.rejects(read(address));
    assert.equal(failures, 1);
    assert.equal(reads, 1);
    assert.equal(waits, 0);
    assert.deepEqual(projections, []);
  }
});
