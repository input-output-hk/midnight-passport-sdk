import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from '@input-output-hk/mn-passport-service';
import { inventoryRoute, walletInventory } from '../src/inventory.ts';

const night = '00'.repeat(32),
  color = 'ab'.repeat(32);
const state = () => ({
  unshielded: { progress: { isStrictlyComplete: () => true }, balances: { [night]: 100n } },
});

test('throwing teardown rejects synchronous, asynchronous and timed-out reads instead of hanging', async (t) => {
  for (const mode of ['synchronous', 'asynchronous', 'timeout']) {
    if (mode === 'timeout') t.mock.timers.enable({ apis: ['setTimeout'] });
    let attempts = 0;
    const pending = walletInventory({
      state: () => ({
        subscribe(observer) {
          if (mode === 'synchronous') observer.next(state());
          if (mode === 'asynchronous') queueMicrotask(() => observer.next(state()));
          return {
            unsubscribe() {
              attempts++;
              throw Error('private teardown details');
            },
          };
        },
      }),
    });
    const refused = assert.rejects(pending, { code: 'FundingWalletUnavailable' });
    if (mode === 'timeout') t.mock.timers.tick(5000);
    await refused;
    assert.equal(attempts, 1);
  }
});
test('wallet inventory releases synchronous and asynchronous subscriptions and copies spendable balances', async () => {
  for (const synchronous of [true, false]) {
    let unsubscribed = 0;
    const original = state();
    const result = await walletInventory({
      state: () => ({
        subscribe(observer) {
          if (synchronous) observer.next(original);
          else queueMicrotask(() => observer.next(original));
          return {
            unsubscribe() {
              unsubscribed++;
            },
          };
        },
      }),
    });
    original.unshielded.balances[night] = 0n;
    assert.equal(result.balances[night], 100n);
    assert.equal(result.synced, true);
    assert.equal(unsubscribed, 1);
  }
});
test('unsynced observations are distinct from zero; stream failures discard provider details', async () => {
  const original = state();
  original.unshielded.progress.isStrictlyComplete = () => false;
  assert.equal(
    (
      await walletInventory({
        state: () => ({
          subscribe(observer) {
            observer.next(original);
            return { unsubscribe() {} };
          },
        }),
      })
    ).synced,
    false,
  );
  for (const throwing of [true, false]) {
    await assert.rejects(
      walletInventory({
        state: () => ({
          subscribe(observer) {
            if (throwing) throw Error('private SDK details');
            observer.error(Error('private SDK details'));
            return { unsubscribe() {} };
          },
        }),
      }),
      {
        code: 'FundingWalletUnavailable',
        message: 'The funding wallet inventory is unavailable or not synchronized.',
      },
    );
  }
});
test('a silent wallet snapshot times out and releases its subscription', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let unsubscribed = 0;
  const pending = walletInventory({
    state: () => ({
      subscribe() {
        return {
          unsubscribe() {
            unsubscribed++;
          },
        };
      },
    }),
  });
  const rejected = assert.rejects(pending, { code: 'FundingWalletUnavailable' });
  t.mock.timers.tick(5000);
  await rejected;
  assert.equal(unsubscribed, 1);
});
test('private inventory endpoint is pinned, authenticated, advisory and does not expose wallet balances', async (t) => {
  let ready = true,
    reads = 0;
  const config = {
    host: '127.0.0.1',
    corsOrigin: 'http://localhost:5173',
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    manifestSha256: 'cd'.repeat(32),
    assets: [
      { color: night, maxPerRequest: 10n, maxPerUtcDay: 100n },
      { color, maxPerRequest: 20n, maxPerUtcDay: 100n },
    ],
  };
  const server = createServer(config, [
    inventoryRoute(
      config,
      async () => {
        reads++;
        return { synced: ready, balances: { [night]: 100n } };
      },
      (header) => header === 'Bearer synthetic',
    ),
  ]);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const bound = server.address();
  assert.ok(bound && typeof bound !== 'string');
  const url = `http://127.0.0.1:${bound.port}/v1/faucet/assets`;
  assert.equal((await fetch(url)).status, 403);
  assert.equal(reads, 0);
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    405,
  );
  assert.equal(reads, 0);
  const first = await (await fetch(url, { headers: { authorization: 'Bearer synthetic' } })).json();
  assert.deepEqual(first, {
    networkId: config.networkId,
    bindingId: config.bindingId,
    manifestSha256: config.manifestSha256,
    assets: [
      { color: night, amount: '10', availability: 'available' },
      { color, amount: '10', availability: 'insufficient' },
    ],
  });
  assert.doesNotMatch(JSON.stringify(first), /balances|100|synthetic/);
  ready = false;
  const second = await (
    await fetch(url, { headers: { authorization: 'Bearer synthetic' } })
  ).json();
  assert.ok(
    second && typeof second === 'object' && 'assets' in second && Array.isArray(second.assets),
  );
  assert.deepEqual(second.assets, [
    { color: night, amount: '10', availability: 'unavailable' },
    { color, amount: '10', availability: 'unavailable' },
  ]);
});
