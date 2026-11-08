import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encryptedMutationJournal } from '../packages/keys/dist/index.js';
import {
  controlledSource,
  pins,
  mutationDocument,
  mutationId,
  memoryStore,
} from './fixtures/overnight-keys-ownership-fixture.mjs';

test('journal plaintext, AAD and strict CAS metadata retain one admitted document revision', async () => {
  const control = controlledSource(),
    memory = memoryStore(),
    next = mutationDocument();
  const journal = encryptedMutationJournal(pins, control.source, memory.store);
  const expected = structuredClone(next);
  try {
    control.pause();
    const pending = journal.compareAndSwap(mutationId, undefined, next);
    next.revision = 1;
    next.intent.userName = 'changed';
    next.randomSeed.fill(22);
    next.pins.networkId = 'different';
    // Reusing the same request after key scope completion previously mixed revision1 AAD
    // with revision0 storage/plaintext, even though the byte store checks transitions.
    control.after(() => {
      next.revision = 0;
    });
    control.release();
    assert.equal(await pending, true);
    control.after(undefined);
    assert.equal(memory.saved()?.revision, 0);
    const opened = await journal.read(mutationId);
    try {
      assert.deepEqual(opened, expected);
    } finally {
      opened?.randomSeed.fill(0);
    }
    assert.ok(
      next.randomSeed.every((v) => v === 22),
      'caller seed remains caller-owned',
    );
    assert.ok(control.outputs.every((v) => v.every((byte) => byte === 0)));
  } finally {
    next.randomSeed.fill(0);
    expected.randomSeed.fill(0);
    memory.close();
    control.release();
  }
});

test('journal captures returned Buffer ciphertext and revision before decrypting across a session', async () => {
  const control = controlledSource(),
    memory = memoryStore(),
    next = mutationDocument();
  const journal = encryptedMutationJournal(pins, control.source, memory.store);
  try {
    assert.equal(await journal.compareAndSwap(mutationId, undefined, next), true);
    const saved = memory.saved();
    assert.ok(saved);
    control.pause();
    const pending = journal.read(mutationId);
    // Allow the byte-store read to resolve and the journal to enter its paused key scope.
    await Promise.resolve();
    saved.revision = 9;
    saved.bytes.fill(0);
    control.release();
    const opened = await pending;
    try {
      assert.deepEqual(opened, structuredClone(next));
    } finally {
      opened?.randomSeed.fill(0);
    }
    assert.ok(
      saved.bytes.every((v) => v === 0),
      'journal does not mutate storage-owned bytes',
    );
  } finally {
    next.randomSeed.fill(0);
    memory.close();
    control.release();
  }
});

test('journal refuses oversized storage input before key derivation and never overwrites it', async () => {
  const control = controlledSource();
  let writes = 0;
  const journal = encryptedMutationJournal(pins, control.source, {
    async read() {
      return { revision: 0, bytes: new Uint8Array(9 * 1024 * 1024) };
    },
    async compareAndSwap() {
      writes++;
      return true;
    },
  });
  await assert.rejects(journal.read(mutationId), { code: 'MutationUnsettled' });
  assert.equal(control.sessions(), 0);
  assert.equal(writes, 0);
});

test('journal clears provider secrets after encryption failure and leaves caller document intact', async () => {
  const control = controlledSource(),
    memory = memoryStore(),
    next = mutationDocument();
  const sentinel = new Error('synthetic import failure');
  const original = crypto.subtle.importKey;
  crypto.subtle.importKey = async () => {
    throw sentinel;
  };
  try {
    const journal = encryptedMutationJournal(pins, control.source, memory.store);
    await assert.rejects(journal.compareAndSwap(mutationId, undefined, next), sentinel);
    assert.equal(memory.saved(), undefined);
    assert.ok(control.outputs.every((v) => v.every((byte) => byte === 0)));
    assert.ok(next.randomSeed.every((v) => v === 99));
  } finally {
    crypto.subtle.importKey = original;
    next.randomSeed.fill(0);
    memory.close();
  }
});
