import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { openDustRegistrationJournal } from '../src/wallet/dust-registration-journal.js';

const address = `mn_addr_undeployed1${'a'.repeat(50)}`;
const original = { hash: 'b'.repeat(64), identifiers: [`00${'c'.repeat(64)}`] };
const alternate = { hash: 'd'.repeat(64), identifiers: [`00${'e'.repeat(64)}`] };

test('a DUST registration keeps its original ID through uncertain submission and exact finality', async () => {
  const factory = new IDBFactory();
  const first = await openDustRegistrationJournal(factory, 'undeployed', address);
  await first.create(original);
  first.close();
  const reopened = await openDustRegistrationJournal(factory, 'undeployed', address);
  assert.deepEqual((await reopened.read())?.original, original);
  await assert.rejects(() => reopened.create(alternate), /Reconcile/);
  await assert.rejects(
    () => reopened.archive({ hash: alternate.hash, identifiers: original.identifiers }),
    /original.*changed/,
  );
  assert.deepEqual((await reopened.read())?.original, original);
  await reopened.archive(original);
  assert.equal(await reopened.read(), undefined);
  reopened.close();
});

test('competing tabs cannot both reserve different DUST originals', async () => {
  const factory = new IDBFactory();
  const first = await openDustRegistrationJournal(factory, 'undeployed', address);
  const second = await openDustRegistrationJournal(factory, 'undeployed', address);
  const results = await Promise.allSettled([first.create(original), second.create(alternate)]);
  assert.deepEqual(
    results.map((result) => result.status),
    ['fulfilled', 'rejected'],
  );
  assert.deepEqual((await second.read())?.original, original);
  first.close();
  second.close();
});

test('a pending localStorage original migrates before a new registration can start', async () => {
  const factory = new IDBFactory();
  const values = new Map<string, string>();
  const key = `mn-passport:dust-registration:v1:undeployed:${address}:active`;
  values.set(
    key,
    JSON.stringify({
      version: 1,
      networkId: 'undeployed',
      address,
      original,
      createdAt: new Date().toISOString(),
    }),
  );
  const legacy = {
    getItem: (name: string) => values.get(name) ?? null,
    removeItem: (name: string) => {
      values.delete(name);
    },
  };
  const journal = await openDustRegistrationJournal(factory, 'undeployed', address, legacy);
  assert.deepEqual((await journal.read())?.original, original);
  assert.equal(values.has(key), true, 'older tabs must still observe the pending original');
  await assert.rejects(() => journal.create(alternate), /Reconcile/);
  await journal.archive(original);
  assert.equal(values.has(key), false);
  journal.close();
});

test('a crash after finality commit cannot resurrect a migrated registration', async () => {
  const factory = new IDBFactory();
  const values = new Map<string, string>();
  const key = `mn-passport:dust-registration:v1:undeployed:${address}:active`;
  values.set(
    key,
    JSON.stringify({
      version: 1,
      networkId: 'undeployed',
      address,
      original,
      createdAt: new Date().toISOString(),
    }),
  );
  let failRemoval = true;
  const legacy = {
    getItem: (name: string) => values.get(name) ?? null,
    removeItem: (name: string) => {
      if (failRemoval) {
        failRemoval = false;
        throw new Error('tab closed after the IndexedDB commit');
      }
      values.delete(name);
    },
  };
  const journal = await openDustRegistrationJournal(factory, 'undeployed', address, legacy);
  await assert.rejects(() => journal.archive(original), /tab closed/);
  journal.close();
  assert.equal(values.has(key), true);
  const reopened = await openDustRegistrationJournal(factory, 'undeployed', address, legacy);
  assert.equal(await reopened.read(), undefined);
  assert.equal(values.has(key), false);
  reopened.close();
});

test('stale legacy history does not hide a newer pending registration', async () => {
  const factory = new IDBFactory();
  const values = new Map<string, string>();
  const key = `mn-passport:dust-registration:v1:undeployed:${address}:active`;
  values.set(
    key,
    JSON.stringify({
      version: 1,
      networkId: 'undeployed',
      address,
      original,
      createdAt: new Date().toISOString(),
    }),
  );
  let failRemoval = true;
  const legacy = {
    getItem: (name: string) => values.get(name) ?? null,
    removeItem: (name: string) => {
      if (failRemoval) {
        failRemoval = false;
        throw new Error('tab closed after the IndexedDB commit');
      }
      values.delete(name);
    },
  };
  const first = await openDustRegistrationJournal(factory, 'undeployed', address, legacy);
  const second = await openDustRegistrationJournal(factory, 'undeployed', address, legacy);
  await assert.rejects(() => first.archive(original), /tab closed/);
  await second.create(alternate);
  first.close();
  second.close();
  const reopened = await openDustRegistrationJournal(factory, 'undeployed', address, legacy);
  assert.deepEqual((await reopened.read())?.original, alternate);
  assert.equal(values.has(key), false);
  reopened.close();
});
