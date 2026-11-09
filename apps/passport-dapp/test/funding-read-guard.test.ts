import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fundingReadGuard } from '../src/funding-read-guard.js';

test('late balance success and failure cannot overwrite a newer read or reopened account', async () => {
  let account: { address: string } | undefined = { address: 'original' };
  const begin = fundingReadGuard(() => account);
  const old = begin('original'),
    current = begin('original');
  assert.equal(old(), false);
  assert.equal(current(), true);
  // Both projection and catch paths use the same guard after asynchronous work settles.
  let resolveOld: (value: string) => void = () => {};
  const values: string[] = [];
  const pending = new Promise<string>((resolve) => {
    resolveOld = resolve;
  }).then((value) => {
    if (old()) values.push(value);
  });
  values.push('current');
  resolveOld('stale');
  await pending;
  assert.deepEqual(values, ['current']);
  account = { address: 'original' };
  assert.equal(current(), false, 'same address in a fresh account lease is still a replacement');
  const reopened = begin('original');
  assert.equal(reopened(), true);
  account = undefined;
  assert.equal(reopened(), false);
  assert.equal(begin('original')(), false);
});

test('a read for a previously selected ACC cannot change the active account options', () => {
  const begin = fundingReadGuard(() => ({ address: 'active' }));
  assert.equal(begin('previous')(), false);
});
