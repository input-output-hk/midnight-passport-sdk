import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, readdir, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  mutationDocumentBytes,
  readMutationDocument,
  mutationDigest,
  validateMutationDocument,
} from '../packages/account/dist/index.js';
import { encryptedMutationJournal } from '../packages/keys/dist/index.js';
import { fileMutationByteStore } from '../packages/service/dist/index.js';
const id = '12'.repeat(16);
const pins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  scheme: /** @type {const} */ ('jubjub-schnorr'),
};
const document = () => ({
  version: /** @type {const} */ (1),
  id,
  revision: 0,
  pins,
  intent: { kind: /** @type {const} */ ('create'), userName: 'synthetic', retireAuthority: true },
  randomSeed: new Uint8Array(32).fill(99),
  phase: /** @type {const} */ ('pending'),
  entries: [],
});
const source = (value = 7) => ({
  withSession: async (/** @type {()=>Promise<any>} */ work) => work(),
  deviceSecret: async () => new Uint8Array(32).fill(value),
  deriveSecret: async () => new Uint8Array(32).fill(value),
});

test('continuation codec round trips typed values, binds intent and rejects unsupported versions or corrupt wire data', () => {
  const doc = {
    ...document(),
    entries: [
      {
        name: 'public',
        digest: mutationDigest({}),
        phase: /** @type {const} */ ('done'),
        result: { nonce: 3n, sealed: new Uint8Array([1, 2, 3]), optional: undefined },
      },
    ],
  };
  assert.deepEqual(readMutationDocument(mutationDocumentBytes(doc)), doc);
  assert.notEqual(
    mutationDigest(doc.intent),
    mutationDigest({ ...doc.intent, retireAuthority: false }),
  );
  for (const value of [
    { ...doc, version: 2 },
    { ...doc, pins: { ...pins, manifestSha256: '00'.repeat(32) } },
    { ...doc, intent: { kind: 'create', userName: 'x' } },
    { ...doc, phase: 'complete' },
    { ...doc, entries: [{ name: 'a', digest: '00'.repeat(32), phase: 'running' }, ...doc.entries] },
  ])
    assert.throws(() => validateMutationDocument(value), { code: 'MutationUnsettled' });
  for (const bytes of [
    new TextEncoder().encode('{bad'),
    Uint8Array.of(255),
    new TextEncoder().encode('{"$bigint":"wat"}'),
  ])
    assert.throws(() => readMutationDocument(bytes), { code: 'MutationUnsettled' });
  for (const value of [() => 0, new Date(), { constructor: 4 }, { secret: NaN }, { $bytes: '00' }])
    assert.throws(() => mutationDigest(value), { code: 'MutationUnsettled' });
});

test('encrypted journal survives a new instance; tamper, wrong key, context and stale CAS cannot replace it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'passport-journal-test-'));
  try {
    const store = fileMutationByteStore(join(root, 'private'));
    const raw = new Uint8Array(32).fill(7);
    const journal = encryptedMutationJournal(
      pins,
      { ...source(), deriveSecret: async () => raw },
      store,
    );
    assert.equal(await journal.compareAndSwap(id, undefined, document()), true);
    assert.ok(
      raw.every((v) => v === 0),
      'derived key buffer is erased',
    );
    const reopened = encryptedMutationJournal(
      pins,
      source(),
      fileMutationByteStore(join(root, 'private')),
    );
    assert.deepEqual(await reopened.read(id), document());
    assert.equal(await reopened.compareAndSwap(id, undefined, document()), false);
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        reopened.compareAndSwap(id, 0, { ...document(), revision: 1 }),
      ),
    );
    assert.equal(results.filter(Boolean).length, 1, 'one writer wins immutable revision slot');
    const bytes = (await store.read(id))?.bytes;
    assert.ok(bytes);
    assert.equal(Buffer.from(bytes).includes(Buffer.from('synthetic')), false);
    assert.equal(Buffer.from(bytes).includes(Buffer.from('retireAuthority')), false);
    await assert.rejects(encryptedMutationJournal(pins, source(8), store).read(id), {
      code: 'MutationUnsettled',
    });
    await assert.rejects(
      encryptedMutationJournal({ ...pins, networkId: 'preprod' }, source(), store).read(id),
      { code: 'MutationUnsettled' },
    );
    const files = (await readdir(join(root, 'private'))).sort();
    assert.equal(files.length, 2);
    const path = join(root, 'private', `${id}.r1.json`),
      record = JSON.parse(await readFile(path, 'utf8'));
    const corrupted = Buffer.from(record.ciphertext, 'base64');
    corrupted[15] = (corrupted[15] ?? 0) ^ 1;
    await writeFile(path, JSON.stringify({ ...record, ciphertext: corrupted.toString('base64') }));
    await assert.rejects(reopened.read(id), { code: 'MutationUnsettled' });
    await writeFile(path, '{incomplete');
    await assert.rejects(store.read(id));
    await chmod(join(root, 'private'), 0o755);
    await assert.rejects(store.read(id), /private/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
