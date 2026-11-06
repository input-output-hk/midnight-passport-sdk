import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transactionReceipts, receiptStorageRequired } from '../src/transaction-receipts.js';
import type { PassportEvent } from '@input-output-hk/mn-passport-protocol';
const event: PassportEvent = {
  id: 'one',
  flowId: 'flow',
  step: 'sponsor.submit',
  phase: 'end',
  at: 10,
  clock: 'client',
  detail: { txId: 'ab'.repeat(32), circuit: 'rotate_enc_key_with_jubjub' },
};
function fixture() {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  return { data, storage, journal: transactionReceipts(storage, 'undeployed', 'acc-s3r1.1') };
}
test('intermediate submission survives reload independently of composite completion, without retaining unknown fields', () => {
  const f = fixture();
  f.journal.assertWritable();
  assert.equal(f.data.size, 0);
  const saved = f.journal.observe(event);
  assert.equal(saved?.txId, event.detail!.txId);
  f.journal.observe({ ...event, flowId: 'replacement' });
  const reopened = transactionReceipts(f.storage, 'undeployed', 'acc-s3r1.1');
  assert.deepEqual(reopened.load(), [saved]);
  const [key, raw] = [...f.data][0]!;
  f.data.set(key, JSON.stringify({ ...JSON.parse(raw), privateSeed: 'never expose' }));
  assert.ok(!JSON.stringify(reopened.load()).includes('privateSeed'));
  assert.deepEqual(transactionReceipts(f.storage, 'other', 'acc-s3r1.1').load(), []);
});
test('receipt errors preserve prior references and refuse corrupt identities and unwritable storage', () => {
  const f = fixture();
  f.journal.observe(event);
  const before = [...f.data];
  assert.throws(
    () => f.journal.observe({ ...event, detail: { txId: 'bad\nidentity' } }),
    /Invalid/,
  );
  assert.deepEqual([...f.data], before);
  f.storage.setItem = () => {
    throw Error('quota');
  };
  assert.throws(() => f.journal.assertWritable(), /quota/);
  assert.equal(f.journal.load()[0]!.txId, event.detail!.txId);
  const [key, raw] = before[0]!;
  f.data.set(key, raw.replace('ab'.repeat(32), 'cd'.repeat(32)));
  assert.throws(() => f.journal.load(), /mismatch/);
});

test('local lock and public wallet refresh never require receipt storage; owner operations do', () => {
  for (const action of ['endSession', 'walletRefresh', 'refresh', 'roster', 'grantRoster'])
    assert.equal(receiptStorageRequired(action), false, action);
  for (const action of ['unlockOwner', 'rotate', 'withdraw', 'startSession', 'enrollDevice'])
    assert.equal(receiptStorageRequired(action), true, action);
});
