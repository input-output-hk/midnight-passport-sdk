import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { openClaimJournal } from '../src/midnames/claim-journal.js';

const registry = '12'.repeat(32);
const account = '34'.repeat(32);
const credential = '56'.repeat(32);

test('a selected name survives database upgrade and reopen but stays scoped to one credential and ACC', async () => {
  const factory = new IDBFactory();
  const legacy = factory.open('mn-passport:midnames-claims', 1);
  await new Promise<void>((resolve, reject) => {
    legacy.onupgradeneeded = () => legacy.result.createObjectStore('claims');
    legacy.onsuccess = () => {
      legacy.result.close();
      resolve();
    };
    legacy.onerror = () => reject(legacy.error);
  });
  let journal = await openClaimJournal(factory);
  assert.equal(await journal.readSelection(registry, account, credential), undefined);
  assert.equal(
    await journal.selectName(registry, account, credential, 'alice.night'),
    'alice.night',
  );
  journal.close();
  journal = await openClaimJournal(factory);
  assert.equal(await journal.readSelection(registry, account, credential), 'alice.night');
  assert.equal(await journal.readSelection(registry, account, '78'.repeat(32)), undefined);
  assert.equal(await journal.readSelection(registry, '90'.repeat(32), credential), undefined);
  assert.equal(await journal.readSelection('ab'.repeat(32), account, credential), undefined);
  assert.equal(await journal.selectName(registry, account, credential, 'bob.night'), 'bob.night');
  journal.close();
});

test('a retained original quote prevents silently selecting another name', async () => {
  const factory = new IDBFactory();
  const journal = await openClaimJournal(factory);
  await journal.selectName(registry, account, credential, 'alice.night');
  await journal.reserve(
    {
      networkId: 'undeployed',
      registryAddress: registry,
      accountAddress: account,
      name: 'alice.night',
      id: 'aa'.repeat(32),
      sponsorAddress: 'bb'.repeat(32),
      sponsorPaymentAddress: 'cc'.repeat(32),
      registryPayee: 'dd'.repeat(32),
      night: '7',
      maximumDust: '10000',
      expiresAt: Date.now() + 60_000,
    },
    credential,
  );
  await assert.rejects(
    journal.selectName(registry, account, credential, 'bob.night'),
    /Recover the original claim/,
  );
  assert.equal(await journal.readSelection(registry, account, credential), 'alice.night');
  journal.close();
});

test('a pre-upgrade claim without a selection blocks a second pending name', async () => {
  const factory = new IDBFactory();
  const legacy = factory.open('mn-passport:midnames-claims', 1);
  await new Promise<void>((resolve, reject) => {
    legacy.onupgradeneeded = () => {
      const claims = legacy.result.createObjectStore('claims');
      claims.put(
        {
          credential,
          quote: {
            networkId: 'undeployed',
            registryAddress: registry,
            accountAddress: account,
            name: 'alice.night',
            id: 'aa'.repeat(32),
            sponsorAddress: 'bb'.repeat(32),
            sponsorPaymentAddress: 'cc'.repeat(32),
            registryPayee: 'dd'.repeat(32),
            night: '7',
            maximumDust: '10000',
            expiresAt: Date.now() + 60_000,
          },
        },
        JSON.stringify(['undeployed', registry, 'alice.night']),
      );
    };
    legacy.onsuccess = () => {
      legacy.result.close();
      resolve();
    };
    legacy.onerror = () => reject(legacy.error);
  });
  const journal = await openClaimJournal(factory);
  await assert.rejects(
    journal.selectName(registry, account, credential, 'bob.night'),
    /Recover the original claim/,
  );
  assert.equal(await journal.readSelection(registry, account, credential), undefined);
  assert.equal(
    await journal.selectName(registry, account, credential, 'alice.night'),
    'alice.night',
  );
  assert.equal(
    await journal.selectName(registry, '78'.repeat(32), credential, 'bob.night'),
    'bob.night',
  );
  journal.close();
});
