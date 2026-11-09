import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fundingInventory,
  FundingPreflightError,
  createWalletFundingBackend,
} from '../packages/service/dist/index.js';

const color = 'cd'.repeat(32);
const request = {
  requestId: '12345678-1234-1234-1234-123456789abc',
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: 'ef'.repeat(32),
  accountAddress: 'ab'.repeat(32),
  color,
  amount: '10',
};

test('inventory snapshots are copied; missing colors are zero only in a synchronized observation', async () => {
  const source = { [color]: 10n };
  const result = await fundingInventory(async () => ({ synced: true, balances: source }));
  source[color] = 0n;
  assert.equal(result.balances[color], 10n);
  assert.equal(Object.isFrozen(result.balances), true);
});

test('unreadable, unsynced and malformed inventory are unavailable, never insufficient funds', async () => {
  for (const snapshot of [
    null,
    {},
    { synced: false, balances: {} },
    { synced: true, balances: [] },
    { synced: true, balances: { [color]: -1n } },
    { synced: true, balances: { [color]: '10' } },
    { synced: true, balances: { bad: 10n } },
  ]) {
    await assert.rejects(
      fundingInventory(
        // @ts-expect-error Exercise malformed runtime host observations.
        async () => snapshot,
      ),
      { code: 'FundingWalletUnavailable' },
    );
  }
  await assert.rejects(
    fundingInventory(async () => {
      throw Error('private witness');
    }),
    (error) => {
      assert.ok(error instanceof FundingPreflightError);
      assert.equal(error.code, 'FundingWalletUnavailable');
      assert.doesNotMatch(error.message, /private witness/);
      return true;
    },
  );
});

test('queued inventory preflight refuses an absent token before preparation or deposit', async () => {
  let writes = 0;
  for (const balances of [{}, { [color]: 9n }]) {
    /** @type {import('../packages/service/dist/index.js').FundingProgress[]} */
    const progress = [];
    const backend = createWalletFundingBackend({
      deployed: () => true,
      inventory: async () => ({ synced: true, balances }),
      connect: async () => ({
        ledgerState: async () => ({
          spec_version: 3n,
          unshielded_balances: { member: () => false, lookup: () => 0n },
        }),
        depositUnshielded: async () => {
          writes++;
          return { txId: 'never' };
        },
      }),
      prepareDeposit: async () => {
        writes++;
        return undefined;
      },
    });
    await assert.rejects(
      backend.fund(request, async (event) => {
        progress.push(event);
      }),
      { code: 'FundingAssetUnavailable' },
    );
    assert.deepEqual(progress, [{ stage: 'no-submit' }]);
  }
  assert.equal(writes, 0);
});

test('inventory is sampled again inside the queue, so two deposits cannot use one stale snapshot', async () => {
  let available = 10n,
    credited = 0n,
    deposits = 0;
  const backend = createWalletFundingBackend({
    deployed: () => true,
    inventory: async () => ({ synced: true, balances: { [color]: available } }),
    connect: async () => ({
      ledgerState: async () => ({
        spec_version: 3n,
        unshielded_balances: { member: () => credited > 0n, lookup: () => credited },
      }),
      depositUnshielded: async () => {
        available = 0n;
        credited += 10n;
        deposits++;
        return { txId: 'one' };
      },
    }),
  });
  const results = await Promise.allSettled([
    backend.fund(request),
    backend.fund({ ...request, requestId: 'other' }),
  ]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, 'FundingAssetUnavailable');
  assert.equal(deposits, 1);
});

test('inventory failure remains a typed refusal only while no value-moving wallet work has started', async () => {
  const backend = createWalletFundingBackend({
    deployed: () => true,
    inventory: async () => ({ synced: false, balances: {} }),
    connect: async () => ({
      ledgerState: async () => ({
        spec_version: 3n,
        unshielded_balances: { member: () => false, lookup: () => 0n },
      }),
      depositUnshielded: async () => {
        throw Error('must not run');
      },
    }),
  });
  await assert.rejects(backend.fund(request), FundingPreflightError);
});
