import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dustRegistrationJournal } from '../src/wallet/dust-registration-journal.js';

test('a DUST registration keeps its original ID through uncertain submission and exact finality', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const address = `mn_addr_undeployed1${'a'.repeat(50)}`;
  const first = dustRegistrationJournal(storage, 'undeployed', address);
  const original = { hash: 'b'.repeat(64), identifiers: [`00${'c'.repeat(64)}`] };
  first.create(original);
  const reopened = dustRegistrationJournal(storage, 'undeployed', address);
  assert.deepEqual(reopened.read()?.original, original);
  assert.throws(
    () => reopened.create({ hash: 'd'.repeat(64), identifiers: [`00${'e'.repeat(64)}`] }),
    /Reconcile/,
  );
  assert.throws(
    () => reopened.archive({ hash: 'd'.repeat(64), identifiers: original.identifiers }),
    /original.*changed/,
  );
  assert.deepEqual(reopened.read()?.original, original);
  reopened.archive(original);
  assert.equal(reopened.read(), undefined);
  const archived = [...values.entries()].find(([key]) => key.includes(':history:'));
  assert.ok(archived);
  assert.equal(JSON.parse(archived[1]).original.hash, original.hash);
});
