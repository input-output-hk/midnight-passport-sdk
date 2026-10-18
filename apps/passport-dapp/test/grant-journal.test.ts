import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrfKeySource } from '@input-output-hk/mn-passport-account/ports';
import { browserAccountRecords, browserGrantJournal } from '../src/grant-journal.ts';

const account = 'ab'.repeat(32);
const grantId = 'cd'.repeat(32);
const storage = () => {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    values: () => [...map.values()],
  };
};
const prf = (byte: number): PrfKeySource => ({
  withSession: (operation) => operation(),
  deviceSecret: async () => new Uint8Array(32).fill(byte),
  deriveSecret: async () => new Uint8Array(32).fill(byte),
});
const opening = {
  account,
  origin: 'localhost',
  scope: {
    grantee: { scheme: 'jubjub-schnorr' as const, publicKey: 'ef'.repeat(32) },
    operations: ['withdraw-unshielded' as const],
    color: '00'.repeat(32),
    recipient: { kind: 'user-address' as const, value: '12'.repeat(32) },
    maxCoinValue: '10',
    perCallCap: '5',
    cap: '10',
    expiresAt: null,
  },
  bookkeeping: {
    grantId,
    slot: 1,
    scopeSalt: '34'.repeat(32),
    granteePublicKey: 'ef'.repeat(32),
    object: {
      color: '00'.repeat(32),
      recipient: { kind: 'user-address' as const, value: '12'.repeat(32) },
      maxCoinValue: '10',
    },
  },
  scopeDigest: '56'.repeat(32),
};

test('encrypted grant journal survives reload, preserves pending state and keeps salt out of storage', async () => {
  const local = storage();
  const first = browserGrantJournal('undeployed', prf(7), local);
  await first.stage(opening);
  assert.deepEqual(await first.pending(account), [grantId]);
  assert.ok(local.values().every((value) => !value.includes(opening.bookkeeping.scopeSalt)));
  const reopened = browserGrantJournal('undeployed', prf(7), local);
  assert.deepEqual(await reopened.load(account, grantId), opening);
  await assert.rejects(
    browserGrantJournal('undeployed', prf(8), local).load(account, grantId),
    /could not be unlocked/,
  );
  await assert.rejects(reopened.stage(opening), /already exists/);
  await reopened.markPublished(account, grantId);
  assert.deepEqual(await reopened.pending(account), []);
  assert.deepEqual(await reopened.load(account, grantId), opening);
});

test('a failed journal write rejects staging before submission', async () => {
  const local = storage();
  const failing = {
    ...local,
    setItem: () => {
      throw new Error('storage full');
    },
  };
  await assert.rejects(
    browserGrantJournal('undeployed', prf(7), failing).stage(opening),
    /storage full/,
  );
  assert.equal(local.length, 0);
});

test('public account record is restored with counter and credential bytes', async () => {
  const local = storage();
  const records = browserAccountRecords('undeployed', local);
  await records.write({
    address: account,
    bindingId: 'acc-s3r1.1',
    scheme: 'p256-webauthn',
    credentialId: Uint8Array.of(1, 2, 3),
    localUseCounter: 3n,
  });
  assert.deepEqual(await browserAccountRecords('undeployed', local).read(), {
    address: account,
    bindingId: 'acc-s3r1.1',
    scheme: 'p256-webauthn',
    credentialId: Uint8Array.of(1, 2, 3),
    localUseCounter: 3n,
  });
});

test('journal status tampering cannot hide a pending opening or republish a completed one', async () => {
  const local = storage();
  const journal = browserGrantJournal('undeployed', prf(7), local);
  await journal.stage(opening);
  const key = local.key(0)!;
  const pending = local.getItem(key)!;
  local.setItem(key, JSON.stringify({ ...JSON.parse(pending), state: 'published' }));
  await assert.rejects(journal.pending(account), /could not be unlocked/);
  await assert.rejects(journal.markPublished(account, grantId), /could not be unlocked/);
  local.setItem(key, pending);
  await journal.markPublished(account, grantId);
  const published = local.getItem(key)!;
  assert.notEqual(JSON.parse(published).iv, JSON.parse(pending).iv);
  local.setItem(key, JSON.stringify({ ...JSON.parse(published), state: 'pending' }));
  await assert.rejects(journal.load(account, grantId), /could not be unlocked/);
});

test('legacy openings remain readable but their unauthenticated status is never used to hide recovery', async () => {
  const local = storage();
  const name = `mn-passport:grant-journal:v1:undeployed:${account}:${grantId}`;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(7), 'AES-GCM', false, [
    'encrypt',
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(name) },
      key,
      new TextEncoder().encode(JSON.stringify(opening)),
    ),
  );
  local.setItem(
    name,
    JSON.stringify({
      version: 1,
      state: 'published',
      iv: btoa(String.fromCharCode(...iv)),
      ciphertext: btoa(String.fromCharCode(...ciphertext)),
    }),
  );
  const journal = browserGrantJournal('undeployed', prf(7), local);
  assert.deepEqual(await journal.pending(account), [grantId]);
  assert.deepEqual(await journal.load(account, grantId), opening);
  await journal.markPublished(account, grantId);
  assert.equal(JSON.parse(local.getItem(name)!).version, 2);
  assert.deepEqual(await journal.pending(account), []);
});
