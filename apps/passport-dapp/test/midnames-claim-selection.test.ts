import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { openClaimJournal } from '../src/midnames/claim-journal.js';

const registry = '12'.repeat(32);
const account = '34'.repeat(32);
const credential = '56'.repeat(32);
const quoteFor = (name: string) => ({
  networkId: 'undeployed' as const,
  registryAddress: registry,
  accountAddress: account,
  name,
  id: 'aa'.repeat(32),
  sponsorAddress: 'bb'.repeat(32),
  sponsorPaymentAddress: 'cc'.repeat(32),
  registryPayee: 'dd'.repeat(32),
  night: '7',
  maximumDust: '10000',
  expiresAt: Date.now() + 60_000,
});

const receiptFor = (name: string) => ({
  networkId: 'undeployed' as const,
  registryAddress: registry,
  accountAddress: account,
  name,
  ownerCommitment: '78'.repeat(32),
  transaction: { identifiers: ['00' + '90'.repeat(32)], sha256: 'ab'.repeat(32) },
});

test('importing a receipt does not select its name on reopen', async () => {
  const factory = new IDBFactory();
  let journal = await openClaimJournal(factory);
  await journal.retain(receiptFor('alice.night'), credential);
  journal.close();
  journal = await openClaimJournal(factory);
  assert.equal(await journal.readSelection(registry, account, credential), undefined);
  assert.equal((await journal.read(registry, 'alice.night', credential))?.name, 'alice.night');
  await assert.rejects(
    journal.selectName(registry, account, credential, 'bob.night'),
    /Recover the original claim/,
  );
  journal.close();
});

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
  assert.equal(await journal.readSelection(registry, account, credential), 'alice.night');
  await assert.rejects(
    journal.selectName(registry, account, credential, 'bob.night'),
    /Recover the original claim/,
  );
  assert.equal(await journal.readSelection(registry, account, credential), 'alice.night');
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

test('two tabs cannot reserve different pending names for one ACC', async () => {
  const factory = new IDBFactory();
  const first = await openClaimJournal(factory);
  const second = await openClaimJournal(factory);
  await first.selectName(registry, account, credential, 'alice.night');
  await second.selectName(registry, account, credential, 'bob.night');
  const attempts = await Promise.allSettled([
    first.reserve(quoteFor('alice.night'), credential),
    second.reserve(quoteFor('bob.night'), credential),
  ]);
  assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((result) => result.status === 'rejected').length, 1);
  const retained = await Promise.all([
    first.readPreparation(registry, 'alice.night', credential),
    second.readPreparation(registry, 'bob.night', credential),
  ]);
  assert.equal(retained.filter(Boolean).length, 1);
  first.close();
  second.close();
});

test('a later tab selection invalidates a stale tab before reservation', async () => {
  const factory = new IDBFactory();
  const first = await openClaimJournal(factory);
  const second = await openClaimJournal(factory);
  await first.selectName(registry, account, credential, 'alice.night');
  await second.selectName(registry, account, credential, 'bob.night');
  await assert.rejects(
    first.reserve(quoteFor('alice.night'), credential),
    /Review and select this name/,
  );
  await second.reserve(quoteFor('bob.night'), credential);
  assert.equal(await first.readPreparation(registry, 'alice.night', credential), undefined);
  assert.equal(
    (await second.readPreparation(registry, 'bob.night', credential))?.quote.name,
    'bob.night',
  );
  first.close();
  second.close();
});

test('two legacy originals remain inspectable but cannot authorize a third name', async () => {
  const factory = new IDBFactory();
  const legacy = factory.open('mn-passport:midnames-claims', 1);
  await new Promise<void>((resolve, reject) => {
    legacy.onupgradeneeded = () => {
      const store = legacy.result.createObjectStore('claims');
      for (const name of ['alice.night', 'bob.night'])
        store.put(
          { credential, quote: quoteFor(name) },
          JSON.stringify(['undeployed', registry, name]),
        );
    };
    legacy.onsuccess = () => {
      legacy.result.close();
      resolve();
    };
    legacy.onerror = () => reject(legacy.error);
  });
  const journal = await openClaimJournal(factory);
  await assert.rejects(journal.readSelection(registry, account, credential), /manual recovery/);
  assert.equal(
    (await journal.readPreparation(registry, 'alice.night', credential))?.quote.name,
    'alice.night',
  );
  assert.equal(
    (await journal.readPreparation(registry, 'bob.night', credential))?.quote.name,
    'bob.night',
  );
  assert.equal(await journal.selectName(registry, account, credential, 'bob.night'), 'bob.night');
  await assert.rejects(
    journal.selectName(registry, account, credential, 'carol.night'),
    /Recover the original claim/,
  );
  await assert.rejects(journal.reserve(quoteFor('carol.night'), credential));
  journal.close();
});

test('verified failed original can be archived without losing its receipt, then retried', async () => {
  const factory = new IDBFactory();
  const first = await openClaimJournal(factory);
  const original = receiptFor('alice.night');
  await first.selectName(registry, account, credential, original.name);
  await first.retain(original, credential);
  await assert.rejects(
    first.releaseFailed(
      { ...original, transaction: { ...original.transaction, sha256: 'cd'.repeat(32) } },
      credential,
    ),
    /failed original changed/,
  );
  assert.deepEqual(await first.read(registry, original.name, credential), original);
  const second = await openClaimJournal(factory);
  await second.releaseFailed(original, credential);
  assert.equal(await first.read(registry, original.name, credential), undefined);
  assert.equal(await first.readSelection(registry, account, credential), undefined);
  assert.deepEqual(await first.readReleased(registry, original.name, account, credential), [
    original,
  ]);
  await assert.rejects(first.retain(original, credential), /already released/);
  await assert.rejects(first.reserve(quoteFor(original.name), credential), /Review and select/);
  second.close();
  first.close();

  const reopened = await openClaimJournal(factory);
  assert.deepEqual(await reopened.readReleased(registry, original.name, account, credential), [
    original,
  ]);
  await reopened.selectName(registry, account, credential, original.name);
  const next = { ...quoteFor(original.name), id: 'ef'.repeat(32) };
  await reopened.reserve(next, credential);
  assert.deepEqual(await reopened.readPreparation(registry, original.name, credential), {
    quote: next,
    ownerCommitment: undefined,
  });
  assert.deepEqual(await reopened.readReleased(registry, original.name, account, credential), [
    original,
  ]);
  assert.deepEqual(
    await reopened.readReleased(registry, original.name, 'ab'.repeat(32), credential),
    [],
  );
  reopened.close();
});

test('release refuses a changed selection or an unsubmitted quote', async () => {
  const factory = new IDBFactory();
  const journal = await openClaimJournal(factory);
  await journal.selectName(registry, account, credential, 'alice.night');
  await journal.reserve(quoteFor('alice.night'), credential);
  await assert.rejects(
    journal.releaseFailed(receiptFor('alice.night'), credential),
    /failed original changed/,
  );
  assert.deepEqual(await journal.readReleased(registry, 'alice.night', account, credential), []);
  journal.close();
});

test('released history remains ordered across two fast failed attempts at one name', async () => {
  const factory = new IDBFactory();
  const journal = await openClaimJournal(factory);
  const first = {
    ...receiptFor('alice.night'),
    transaction: { ...receiptFor('alice.night').transaction, sha256: 'ff'.repeat(32) },
  };
  const second = {
    ...receiptFor('alice.night'),
    transaction: { ...receiptFor('alice.night').transaction, sha256: '00'.repeat(32) },
  };
  for (const original of [first, second]) {
    await journal.selectName(registry, account, credential, original.name);
    await journal.retain(original, credential);
    await journal.releaseFailed(original, credential);
  }
  assert.deepEqual(await journal.readReleased(registry, 'alice.night', account, credential), [
    first,
    second,
  ]);
  journal.close();
});

test('selection skips corrupt rows belonging to another registry or credential', async () => {
  const factory = new IDBFactory();
  const legacy = factory.open('mn-passport:midnames-claims', 1);
  await new Promise<void>((resolve, reject) => {
    legacy.onupgradeneeded = () => {
      const store = legacy.result.createObjectStore('claims');
      store.put({ broken: true }, 'not-json');
      store.put({ broken: true }, 42);
      store.put({ broken: true }, JSON.stringify(['undeployed', 'ab'.repeat(32), 'bad.night']));
      store.put(
        { credential: '78'.repeat(32), broken: true },
        JSON.stringify(['undeployed', registry, 'other.night']),
      );
      store.put(
        { credential, quote: quoteFor('alice.night') },
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
  assert.equal(await journal.readSelection(registry, account, credential), 'alice.night');
  assert.equal(
    await journal.selectName(registry, account, credential, 'alice.night'),
    'alice.night',
  );
  await assert.rejects(
    journal.selectName(registry, account, credential, 'bob.night'),
    /Recover the original claim/,
  );
  journal.close();
});
