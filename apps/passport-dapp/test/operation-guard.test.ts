import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoOperationGuard } from '../src/operation-guard.ts';

test('authenticated/value operations require coordination while public reads and local lock remain usable', async () => {
  const guard = demoOperationGuard('undeployed', 'acc-s3r1.1', undefined);
  let count = 0;
  await assert.rejects(
    guard('withdraw', async () => {
      count++;
    }),
    { code: 'BindingUnsupported' },
  );
  for (const action of ['refresh', 'roster', 'grantRoster', 'walletRefresh', 'endSession'] as const)
    await guard(action, async () => {
      count++;
    });
  assert.equal(count, 5);
});

test('coordination excludes overlapping mutations and releases after both success and failure', async () => {
  const held = new Set<string>();
  const locks = {
    async request(name: string, _options: unknown, work: (lock: Lock | null) => Promise<void>) {
      if (held.has(name)) return work(null);
      held.add(name);
      try {
        return await work({ name, mode: 'exclusive' });
      } finally {
        held.delete(name);
      }
    },
  } as unknown as Pick<LockManager, 'request'>;
  const first = demoOperationGuard('undeployed', 'acc-s3r1.1', locks),
    second = demoOperationGuard('undeployed', 'acc-s3r1.1', locks);
  let release!: () => void;
  const pending = first(
    'startSession',
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  await assert.rejects(
    second('withdraw', async () => {
      assert.fail('overlap ran');
    }),
    /Another Passport tab/,
  );
  await second('endSession', async () => {});
  release();
  await pending;
  await assert.rejects(
    second('withdraw', async () => {
      throw Error('failure');
    }),
    /failure/,
  );
  await first('withdraw', async () => {});
  assert.equal(held.size, 0);
});
