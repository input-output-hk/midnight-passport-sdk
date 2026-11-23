import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { openBrowserNightSendJournal } from '../src/midnames/night-send-journal.js';
import { NIGHT_SEND_OPERATIONS, type NightSendIntent } from '../src/midnames/night-send.js';

const source = 'a'.repeat(64);
const credentialId = '1'.repeat(32);
const scope = { networkId: 'undeployed' as const, source, credentialId };
const candidateScope = {
  ...scope,
  bindingId: 'acc-s3r1.1-zkir036',
  manifestSha256: '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f',
};
const intent: NightSendIntent = {
  requestId: 'a1234567-a123-4123-8123-a123456789ab',
  name: 'alice.night',
  networkId: 'undeployed',
  source,
  bridge: 'b'.repeat(64),
  target: 'c'.repeat(64),
  asset: 'NIGHT',
  amount: '4',
  providerId: `midnames:${'d'.repeat(64)}`,
  namespace: 'night',
  operations: NIGHT_SEND_OPERATIONS,
};
const withdrawal = { hash: 'e'.repeat(64), identifiers: ['0'.repeat(66)] };
const deposit = { hash: 'f'.repeat(64), identifiers: ['1'.repeat(66)] };

test('candidate originals retain their binding pin and cannot cross a stable or changed profile', async () => {
  const factory = new IDBFactory();
  const candidate = await openBrowserNightSendJournal(factory, candidateScope);
  await candidate.createIntent(intent);
  assert.equal((await candidate.readActive())?.bindingId, candidateScope.bindingId);
  assert.equal((await candidate.readActive())?.manifestSha256, candidateScope.manifestSha256);
  candidate.close();
  const stable = await openBrowserNightSendJournal(factory, scope);
  await assert.rejects(stable.readIntent(), /another binding/);
  await assert.rejects(stable.createIntent(intent), /another binding/);
  stable.close();
  await assert.rejects(
    openBrowserNightSendJournal(factory, { ...candidateScope, manifestSha256: '0'.repeat(64) }),
    /Invalid browser NIGHT payment scope/,
  );
  const reopened = await openBrowserNightSendJournal(factory, candidateScope);
  assert.deepEqual(await reopened.readIntent(), intent);
  reopened.close();

  const legacyFactory = new IDBFactory();
  const legacy = await openBrowserNightSendJournal(legacyFactory, scope);
  await legacy.createIntent(intent);
  legacy.close();
  const afterUpgrade = await openBrowserNightSendJournal(legacyFactory, candidateScope);
  await assert.rejects(afterUpgrade.readIntent(), /another binding/);
  await assert.rejects(afterUpgrade.createIntent(intent), /another binding/);
  afterUpgrade.close();
});

test('one source ACC keeps one active intent across tabs, reload and credential changes', async () => {
  const factory = new IDBFactory();
  const first = await openBrowserNightSendJournal(factory, scope);
  const second = await openBrowserNightSendJournal(factory, scope);
  const results = await Promise.allSettled([
    first.createIntent(intent),
    second.createIntent(intent),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ['fulfilled', 'rejected']);
  assert.deepEqual(await first.readIntent(), intent);
  first.close();
  second.close();

  const reopened = await openBrowserNightSendJournal(factory, scope);
  assert.deepEqual(await reopened.readIntent(), intent);
  await assert.rejects(
    reopened.createIntent({ ...intent, requestId: 'b1234567-a123-4123-8123-a123456789ab' }),
    /Reconcile the original/,
  );
  reopened.close();

  const otherCredential = await openBrowserNightSendJournal(factory, {
    ...scope,
    credentialId: '2'.repeat(32),
  });
  await assert.rejects(otherCredential.readIntent(), /another credential/);
  await assert.rejects(otherCredential.createIntent(intent), /another credential/);
  otherCredential.close();
});

test('each transaction fence is durable, ordered and never replaced after a lost reply', async () => {
  const factory = new IDBFactory();
  let journal = await openBrowserNightSendJournal(factory, scope);
  await journal.createIntent(intent);
  await assert.rejects(journal.fenceLeg('deposit', deposit), /cannot be fenced/);
  await journal.fenceLeg('withdraw', withdrawal);
  journal.close();

  journal = await openBrowserNightSendJournal(factory, scope);
  assert.deepEqual(await journal.readLeg('withdraw'), withdrawal);
  assert.equal(await journal.readLeg('deposit'), undefined);
  await assert.rejects(journal.fenceLeg('withdraw', withdrawal), /already fenced/);
  await assert.rejects(
    journal.fenceLeg('deposit', { ...deposit, hash: withdrawal.hash }),
    /cannot be fenced/,
  );
  await journal.fenceLeg('deposit', deposit);
  await assert.rejects(journal.fenceLeg('deposit', deposit), /cannot be fenced/);
  assert.deepEqual(await journal.readActive(), {
    version: 1,
    credentialId,
    intent,
    withdrawal,
    deposit,
  });
  journal.close();
});

test('post-withdrawal recovery observations survive reload and completion', async () => {
  const factory = new IDBFactory();
  let journal = await openBrowserNightSendJournal(factory, candidateScope);
  await journal.createIntent(intent);
  await assert.rejects(
    journal.recordRecoveryReview(intent, { ...intent, target: '6'.repeat(64) }, withdrawal),
    /cannot be recorded/,
  );
  await journal.fenceLeg('withdraw', withdrawal);
  await assert.rejects(
    journal.recordRecoveryReview(
      intent,
      { ...intent, providerId: `midnames:${'8'.repeat(64)}`, target: '6'.repeat(64) },
      withdrawal,
    ),
    /differs from the original scope/,
  );
  await journal.recordRecoveryReview(intent, { ...intent, target: '6'.repeat(64) }, withdrawal);
  journal.close();

  journal = await openBrowserNightSendJournal(factory, candidateScope);
  const reviewed = (await journal.readActive())?.recoveryReviews;
  assert.ok(reviewed && reviewed.length === 1);
  const first = reviewed[0];
  assert.ok(first);
  assert.deepEqual((({ approvedAt: _approvedAt, ...rest }) => rest)(first), {
    name: intent.name,
    networkId: intent.networkId,
    providerId: intent.providerId,
    namespace: intent.namespace,
    originalTarget: intent.target,
    currentTarget: '6'.repeat(64),
    withdrawalHash: withdrawal.hash,
  });
  assert.ok(Number.isFinite(Date.parse(first.approvedAt)));
  await journal.fenceLeg('deposit', deposit);
  await journal.archiveCompleted(intent, withdrawal, deposit, async () => true);
  assert.deepEqual((await journal.readArchived(intent.requestId))?.recoveryReviews, reviewed);
  await assert.rejects(
    journal.recordRecoveryReview(intent, { ...intent, target: '7'.repeat(64) }, withdrawal),
    /cannot be recorded/,
  );
  journal.close();
});

test('a known pre-owner refusal retires only the exact no-leg intent and retains its audit', async () => {
  const factory = new IDBFactory();
  let journal = await openBrowserNightSendJournal(factory, scope);
  await journal.createIntent(intent);
  await assert.rejects(
    journal.retireRefused({ ...intent, bridge: 'e'.repeat(64) }, 'name-recheck'),
    /exact unsubmitted/,
  );
  assert.deepEqual(await journal.readIntent(), intent);
  await journal.retireRefused(intent, 'name-recheck');
  assert.equal(await journal.readActive(), undefined);
  journal.close();

  journal = await openBrowserNightSendJournal(factory, scope);
  const refused = await journal.readRefused(intent.requestId);
  assert.equal(refused?.reason, 'name-recheck');
  assert.deepEqual(refused?.intent, intent);
  assert.equal(refused?.withdrawal, undefined);
  assert.equal(refused?.deposit, undefined);
  assert.ok(Number.isFinite(Date.parse(refused?.refusedAt ?? '')));
  await assert.rejects(journal.createIntent(intent), /already archived/);
  const next = { ...intent, requestId: 'b1234567-a123-4123-8123-a123456789ab' };
  await journal.createIntent(next);
  assert.deepEqual(await journal.readIntent(), next);
  await assert.rejects(journal.retireRefused(intent, 'name-recheck'), /exact unsubmitted/);
  journal.close();

  const other = await openBrowserNightSendJournal(new IDBFactory(), scope);
  await other.createIntent(intent);
  await other.fenceLeg('withdraw', withdrawal);
  await assert.rejects(other.retireRefused(intent, 'name-recheck'), /exact unsubmitted/);
  assert.deepEqual(await other.readLeg('withdraw'), withdrawal);
  other.close();
});

test('a proven pre-credential fence rejection retains the started attempt in history', async () => {
  const factory = new IDBFactory();
  const journal = await openBrowserNightSendJournal(factory, scope);
  await journal.createIntent(intent);
  await assert.rejects(journal.retireUnsupportedFence(intent), /pre-submission/);
  await journal.markOwnerStarted(intent);
  await assert.rejects(
    journal.retireUnsupportedFence({ ...intent, amount: '5' }),
    /pre-submission/,
  );
  await journal.retireUnsupportedFence(intent);
  assert.equal(await journal.readActive(), undefined);
  const refusal = await journal.readRefused(intent.requestId);
  assert.equal(refusal?.reason, 'unsupported-fence');
  assert.ok(refusal?.ownerStartedAt);
  await assert.rejects(journal.createIntent(intent), /already archived/);
  journal.close();
});

test('an owner-start marker survives reload and prevents retiring an uncertain no-ID attempt', async () => {
  const factory = new IDBFactory();
  let journal = await openBrowserNightSendJournal(factory, scope);
  await journal.createIntent(intent);
  await journal.markOwnerStarted(intent);
  await assert.rejects(journal.markOwnerStarted(intent), /cannot start/);
  await assert.rejects(journal.retireRefused(intent, 'name-recheck'), /exact unsubmitted/);
  journal.close();

  journal = await openBrowserNightSendJournal(factory, scope);
  assert.ok(Number.isFinite(Date.parse((await journal.readActive())?.ownerStartedAt ?? '')));
  assert.equal(await journal.readRefused(intent.requestId), undefined);
  await journal.fenceLeg('withdraw', withdrawal);
  assert.deepEqual(await journal.readLeg('withdraw'), withdrawal);
  journal.close();
});

test('completed original is archived without losing its IDs; a new request can then start', async () => {
  const factory = new IDBFactory();
  const journal = await openBrowserNightSendJournal(factory, scope);
  await journal.createIntent(intent);
  await journal.fenceLeg('withdraw', withdrawal);
  const finalized = async () => true;
  await assert.rejects(
    journal.archiveCompleted(intent, withdrawal, deposit, finalized),
    /not ready to archive/,
  );
  await journal.fenceLeg('deposit', deposit);
  await assert.rejects(
    journal.archiveCompleted(intent, withdrawal, deposit, async () => false),
    /must be final/,
  );
  await assert.rejects(
    journal.archiveCompleted({ ...intent, amount: '5' }, withdrawal, deposit, finalized),
    /not ready to archive/,
  );
  await assert.rejects(
    journal.archiveCompleted(intent, withdrawal, { ...deposit, hash: '8'.repeat(64) }, finalized),
    /not ready to archive/,
  );
  await journal.archiveCompleted(intent, withdrawal, deposit, finalized);
  assert.equal(await journal.readActive(), undefined);
  assert.deepEqual(
    (({ archivedAt: _archivedAt, ...rest }) => rest)(
      (await journal.readArchived(intent.requestId))!,
    ),
    { version: 1, credentialId, intent, withdrawal, deposit },
  );
  await assert.rejects(journal.createIntent(intent), /already archived/);
  const next = { ...intent, requestId: 'b1234567-a123-4123-8123-a123456789ab' };
  await journal.createIntent(next);
  assert.deepEqual(await journal.readIntent(), next);
  await assert.rejects(journal.createIntent(intent), /Reconcile the original/);
  journal.close();
});

test('malformed retained original fails closed before payment preparation', async () => {
  const factory = new IDBFactory();
  const journal = await openBrowserNightSendJournal(factory, scope);
  await journal.createIntent(intent);
  journal.close();
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('mn-passport:night-send', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('active', 'readwrite');
    tx.objectStore('active').put(
      { version: 1, credentialId, intent: { ...intent, target: '0'.repeat(63) } },
      JSON.stringify(['undeployed', source]),
    );
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  const reopened = await openBrowserNightSendJournal(factory, scope);
  await assert.rejects(reopened.readIntent(), /Stored NIGHT intent is invalid/);
  await assert.rejects(reopened.fenceLeg('withdraw', withdrawal), /Stored NIGHT intent is invalid/);
  reopened.close();
});
