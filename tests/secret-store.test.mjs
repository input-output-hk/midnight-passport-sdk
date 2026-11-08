import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import {
  createMemorySecretStore,
  SECRET_BYTES_LIMIT,
  secretReferenceKey,
} from '../packages/account/dist/secret-store.js';
import { createBrowserSecretStore } from '../packages/adapter-browser/dist/secret-store.js';

const reference = Object.freeze({
  namespace: 'example.partner',
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  account: 'ab'.repeat(32),
  id: 'viewing-key:v1',
});
const readSecret = async (
  /** @type {import('../packages/account/dist/ports/secrets.js').SecretStore} */ store,
) => {
  const result = await store.read(reference);
  assert.ok(result);
  return result;
};
const code = (/** @type {string} */ code) => ({ code });
const factories = {
  memory: async () => createMemorySecretStore(),
  browser: async () =>
    createBrowserSecretStore({
      indexedDB: new IDBFactory(),
      databaseName: 'passport-tests',
      allowPlaintext: true,
    }),
};
for (const [kind, create] of Object.entries(factories)) {
  test(`${kind}: secret copies, scope separation and atomic conflicting writers`, async () => {
    const store = await create();
    try {
      assert.equal(await store.read(reference), undefined);
      const input = Uint8Array.of(1, 2, 3);
      const writing = store.write(reference, input, null);
      input.fill(9);
      const first = await writing;
      assert.deepEqual([...first.bytes], [1, 2, 3]);
      first.bytes.fill(8);
      const read = await readSecret(store);
      assert.deepEqual([...read.bytes], [1, 2, 3]);
      read.bytes.fill(7);
      assert.deepEqual([...(await readSecret(store)).bytes], [1, 2, 3]);
      for (const field of ['namespace', 'networkId', 'bindingId', 'account', 'id']) {
        const other = { ...reference, [field]: field === 'account' ? 'cd'.repeat(32) : 'other' };
        assert.equal(await store.read(other), undefined);
      }
      const results = await Promise.allSettled([
        store.write(reference, Uint8Array.of(4), first.version),
        store.write(reference, Uint8Array.of(5), first.version),
      ]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      const rejected = results.find((r) => r.status === 'rejected');
      assert.ok(rejected && rejected.status === 'rejected');
      assert.equal(rejected.reason.code, 'Conflict');
      const current = await readSecret(store);
      assert.notEqual(current.version, first.version);
      await assert.rejects(store.remove(reference, first.version), code('Conflict'));
      await assert.rejects(store.write(reference, Uint8Array.of(6), null), code('Conflict'));
      await store.remove(reference, current.version);
      assert.equal(await store.read(reference), undefined);
      await assert.rejects(store.remove(reference, current.version), code('Conflict'));
      const recreated = await store.write(reference, Uint8Array.of(7), null);
      assert.notEqual(recreated.version, first.version);
      await assert.rejects(
        store.write(reference, Uint8Array.of(8), first.version),
        code('Conflict'),
      );
    } finally {
      store.close();
    }
    store.close();
    await assert.rejects(store.read(reference), code('Closed'));
    await assert.rejects(store.write(reference, Uint8Array.of(1), null), code('Closed'));
    await assert.rejects(store.remove(reference, 'version'), code('Closed'));
  });
  test(`${kind}: Node Buffer inputs remain caller-owned and isolated`, async () => {
    const store = await create();
    const input = Buffer.from([1, 2, 3]);
    try {
      const first = await store.write(reference, input, null);
      assert.deepEqual([...input], [1, 2, 3], 'store cleanup must not erase caller Buffer');
      input.fill(9);
      first.bytes.fill(8);
      assert.deepEqual([...(await readSecret(store)).bytes], [1, 2, 3]);
      const rejected = Buffer.from([4, 5]);
      await assert.rejects(store.write(reference, rejected, null), code('Conflict'));
      assert.deepEqual([...rejected], [4, 5]);
    } finally {
      store.close();
    }
  });
  test(`${kind}: refuse invalid/oversized secret inputs without modifying a stored value`, async () => {
    const store = await create();
    try {
      const stored = await store.write(reference, Uint8Array.of(1), null);
      for (const value of [
        new Uint8Array(),
        new Uint8Array(SECRET_BYTES_LIMIT + 1),
        null,
        'secret',
      ]) {
        await assert.rejects(
          store.write(
            reference,
            /** @type {Uint8Array} */ (/** @type {unknown} */ (value)),
            stored.version,
          ),
          code('InvalidInput'),
        );
      }
      for (const ref of [
        { ...reference, account: 'wrong' },
        { ...reference, id: '../bad' },
        { ...reference, namespace: 'x'.repeat(129) },
      ]) {
        await assert.rejects(store.read(ref), code('InvalidInput'));
      }
      await assert.rejects(
        store.write(reference, Uint8Array.of(2), 'bad version'),
        code('InvalidInput'),
      );
      await assert.rejects(store.remove(reference, 'bad version'), code('InvalidInput'));
      assert.deepEqual([...(await readSecret(store)).bytes], [1]);
      const maximum = await store.write(
        reference,
        new Uint8Array(SECRET_BYTES_LIMIT),
        stored.version,
      );
      assert.equal(maximum.bytes.length, SECRET_BYTES_LIMIT);
      assert.equal(store.capabilities.protection, 'none');
    } finally {
      store.close();
    }
  });
}

test('browser persistence is explicit, survives handle close, and refuses a closed handle', async () => {
  const indexedDB = new IDBFactory();
  const config = {
    indexedDB,
    databaseName: 'persistent-test',
    allowPlaintext: /** @type {true} */ (true),
  };
  await assert.rejects(
    createBrowserSecretStore({ ...config, allowPlaintext: /** @type {true} */ (false) }),
    code('InvalidInput'),
  );
  await assert.rejects(
    createBrowserSecretStore({ ...config, databaseName: '../wrong' }),
    code('InvalidInput'),
  );
  const first = await createBrowserSecretStore(config);
  const value = await first.write(reference, Uint8Array.of(3), null);
  first.close();
  const second = await createBrowserSecretStore(config);
  assert.equal((await readSecret(second)).version, value.version);
  await second.remove(reference, value.version);
  second.close();
});

test('browser provider failures expose a coarse error without a secret cause', async () => {
  const indexedDB = /** @type {IDBFactory} */ (
    /** @type {unknown} */ ({
      open() {
        throw Error('private-provider-detail');
      },
    })
  );
  await assert.rejects(
    createBrowserSecretStore({ indexedDB, databaseName: 'tests', allowPlaintext: true }),
    (error) => {
      assert.ok(error instanceof Error && 'code' in error);
      assert.equal(error.code, 'Unavailable');
      assert.equal(error.cause, undefined);
      assert.doesNotMatch(String(error), /private-provider/);
      return true;
    },
  );
});

test('secret scopes are unambiguous tuple encodings', () => {
  assert.notEqual(
    secretReferenceKey({ ...reference, namespace: 'a:b', id: 'c' }),
    secretReferenceKey({ ...reference, namespace: 'a', id: 'b:c' }),
  );
});
