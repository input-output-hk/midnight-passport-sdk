import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFundingBalanceReader } from '../src/funding-balances.js';

const address = 'ab'.repeat(32),
  color = '00'.repeat(32);
const response = (night: string) => ({
  ok: true,
  json: async () => ({
    accountAddress: address,
    assets: [{ color, amount: '10', availability: 'available' }],
    balanceAssetColor: color,
    balances: { night, fundedAsset: '0' },
  }),
});
function deferred() {
  let resolve: (value: ReturnType<typeof response>) => void = () => {},
    reject: (reason: Error) => void = () => {};
  const promise = new Promise<ReturnType<typeof response>>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test('actual balance reader ignores out-of-order results and responses for replaced account leases', async () => {
  let current = { address };
  const shows: string[] = [],
    errors: string[] = [];
  const reads = [deferred(), deferred(), deferred()];
  let index = 0;
  const read = createFundingBalanceReader({
    current: () => current,
    color: () => color,
    url: new URL('http://localhost/v1/demo/funding'),
    fetch: () => {
      const item = reads[index++];
      assert.ok(item);
      return item.promise;
    },
    show: (view) => shows.push(view.night),
    unavailable: (value) => errors.push(value),
  });
  const old = read(address),
    latest = read(address);
  reads[1]?.resolve(response('20'));
  assert.equal((await latest)?.night, '20');
  reads[0]?.resolve(response('10'));
  assert.equal(await old, undefined);
  const replaced = read(address);
  current = { address };
  reads[2]?.resolve(response('30'));
  assert.equal(await replaced, undefined);
  assert.deepEqual(shows, ['20']);
  assert.deepEqual(errors, []);
});
test('stale read errors are suppressed while current errors report unavailable once', async () => {
  const current = { address };
  const shows: string[] = [],
    errors: string[] = [];
  const reads = [deferred(), deferred(), deferred()];
  let index = 0;
  const read = createFundingBalanceReader({
    current: () => current,
    color: () => color,
    url: new URL('http://localhost/v1/demo/funding'),
    fetch: () => {
      const item = reads[index++];
      assert.ok(item);
      return item.promise;
    },
    show: (view) => shows.push(view.night),
    unavailable: (value) => errors.push(value),
  });
  const old = read(address),
    latest = read(address);
  reads[0]?.reject(Error('old transport error'));
  assert.equal(await old, undefined);
  reads[1]?.resolve(response('20'));
  await latest;
  const failed = read(address);
  const rejected = assert.rejects(failed, /current transport error/);
  reads[2]?.reject(Error('current transport error'));
  await rejected;
  assert.deepEqual(shows, ['20']);
  assert.deepEqual(errors, [address]);
});
