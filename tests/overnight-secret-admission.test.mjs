import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import {
  copySecretBytes,
  createMemorySecretStore,
  SECRET_BYTES_LIMIT,
} from '../packages/account/dist/secret-store.js';
import { createBrowserSecretStore } from '../packages/adapter-browser/dist/secret-store.js';

const reference = {
  namespace: 'secret-admission',
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  account: 'ab'.repeat(32),
  id: 'synthetic',
};
const invalid = (/** @type {unknown} */ error) => {
  assert.ok(error instanceof Error && 'code' in error);
  assert.equal(error.code, 'InvalidInput');
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(String(error), /private-detail/);
  return true;
};
/** @template {Uint8Array} T @param {T} bytes @param {number} length @returns {T} */
const shadow = (bytes, length) => {
  Object.defineProperties(bytes, {
    length: { value: length },
    byteLength: { value: length },
  });
  return bytes;
};
/** @param {import('../packages/account/dist/ports/secrets.js').SecretStore} store */
const readStored = async (store) => {
  const result = await store.read(reference);
  assert.ok(result);
  return result;
};
const factories = {
  memory: async () => createMemorySecretStore(),
  browser: async () =>
    createBrowserSecretStore({
      indexedDB: new IDBFactory(),
      databaseName: 'overnight-secret-admission',
      allowPlaintext: true,
    }),
};

test('byte admission ignores instance iterators and reads intrinsic lengths before copying', () => {
  const input = Uint8Array.of(1, 2);
  Object.defineProperties(input, {
    length: {
      get() {
        throw Error('private-detail length');
      },
    },
    byteLength: {
      get() {
        throw Error('private-detail byteLength');
      },
    },
    [Symbol.iterator]: {
      get() {
        throw Error('private-detail iterator');
      },
    },
  });
  assert.deepEqual(copySecretBytes(input), Uint8Array.of(1, 2));
  assert.throws(() => copySecretBytes(shadow(new Uint8Array(SECRET_BYTES_LIMIT + 1), 1)), invalid);
  assert.deepEqual(
    copySecretBytes(shadow(Uint8Array.of(3), SECRET_BYTES_LIMIT + 1)),
    Uint8Array.of(3),
  );
  assert.throws(() => copySecretBytes(new Proxy(Uint8Array.of(4), {})), invalid);
  assert.throws(() => copySecretBytes(Object.create(Uint8Array.prototype)), invalid);
  assert.throws(
    () =>
      copySecretBytes(
        /** @type {Uint8Array} */ (/** @type {unknown} */ (new DataView(new ArrayBuffer(1)))),
      ),
    invalid,
  );
  const detached = Uint8Array.of(5);
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  assert.throws(() => copySecretBytes(detached), invalid);
});

for (const [kind, create] of Object.entries(factories)) {
  test(`${kind}: custom iterators cannot inflate or replace stored secret bytes`, async () => {
    const store = await create();
    let iterations = 0;
    const input = Uint8Array.of(1, 2);
    input[Symbol.iterator] = function* () {
      iterations++;
      for (let index = 0; index <= SECRET_BYTES_LIMIT; index++) yield 9;
      return undefined;
    };
    try {
      const writing = store.write(reference, input, null);
      input.fill(8);
      const written = await writing;
      assert.deepEqual(written.bytes, Uint8Array.of(1, 2));
      assert.equal(iterations, 0);
      written.bytes.fill(7);
      assert.deepEqual((await readStored(store)).bytes, Uint8Array.of(1, 2));
    } finally {
      store.close();
    }
  });

  test(`${kind}: invalid intrinsic length or brand cannot alter the current record`, async () => {
    const store = await create();
    try {
      const current = await store.write(reference, Uint8Array.of(1), null);
      const oversized = shadow(new Uint8Array(SECRET_BYTES_LIMIT + 1), 1);
      const empty = shadow(new Uint8Array(), 1);
      for (const value of [
        oversized,
        empty,
        new Proxy(Uint8Array.of(2), {}),
        Object.create(Uint8Array.prototype),
      ]) {
        await assert.rejects(store.write(reference, value, current.version), invalid);
        const retained = await readStored(store);
        assert.equal(retained.version, current.version);
        assert.deepEqual(retained.bytes, Uint8Array.of(1));
      }
      const actual = shadow(Uint8Array.of(3), SECRET_BYTES_LIMIT + 1);
      const accepted = await store.write(reference, actual, current.version);
      assert.deepEqual(accepted.bytes, Uint8Array.of(3));
      assert.deepEqual((await readStored(store)).bytes, Uint8Array.of(3));
    } finally {
      store.close();
    }
  });

  test(`${kind}: Buffer slices remain isolated from admission and zeroization`, async () => {
    const store = await create();
    const backing = Buffer.from([9, 1, 2, 9]);
    const input = backing.subarray(1, 3);
    shadow(input, 1);
    input[Symbol.iterator] = function* () {
      yield 8;
      return undefined;
    };
    try {
      const first = await store.write(reference, input, null);
      assert.deepEqual([...backing], [9, 1, 2, 9]);
      assert.deepEqual(first.bytes, Uint8Array.of(1, 2));
      backing.fill(7);
      first.bytes.fill(0);
      assert.deepEqual((await readStored(store)).bytes, Uint8Array.of(1, 2));
      await assert.rejects(store.write(reference, input, null), { code: 'Conflict' });
      assert.deepEqual([...backing], [7, 7, 7, 7]);
      await store.remove(reference, first.version);
      assert.deepEqual([...backing], [7, 7, 7, 7]);
    } finally {
      store.close();
    }
  });
}
