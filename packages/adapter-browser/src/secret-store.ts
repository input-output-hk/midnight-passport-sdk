/** Optional plaintext IndexedDB adapter. Not a production wallet vault or a PRF recovery service. */
import {
  SecretStoreError,
  SECRET_BYTES_LIMIT,
  copySecretBytes,
  secretReferenceKey,
  validSecretVersion,
} from '@input-output-hk/mn-passport-account/secret-store';
import type { SecretStore, StoredSecret } from '@input-output-hk/mn-passport-account/ports';

/**
 * Call only after the host explicitly opts into plaintext persistence. No global access on
 * import, no silent fallback, credential prompts, owner-key persistence or wallet dependency.
 */
export async function createBrowserSecretStore(options: {
  indexedDB: IDBFactory;
  databaseName: string;
  allowPlaintext: true;
  /** Require IndexedDB strict commit durability for writes. */
  strictWrites?: true;
}): Promise<SecretStore> {
  if (options.allowPlaintext !== true || !/^[a-zA-Z0-9._:-]{1,128}$/.test(options.databaseName))
    throw new SecretStoreError('InvalidInput');
  const strictWrites = options.strictWrites === true;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let rejected = false;
    try {
      request = options.indexedDB.open(options.databaseName, 1);
    } catch {
      reject(new SecretStoreError('Unavailable'));
      return;
    }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('secrets'))
        request.result.createObjectStore('secrets');
    };
    request.onblocked = () => {
      rejected = true;
      reject(new SecretStoreError('Unavailable'));
    };
    request.onerror = () => {
      rejected = true;
      reject(new SecretStoreError('Unavailable'));
    };
    request.onsuccess = () => {
      if (rejected) request.result.close();
      else resolve(request.result);
    };
  });
  let closed = false;
  const close = () => {
    closed = true;
    db.close();
  };
  db.onversionchange = close;
  db.onclose = () => {
    closed = true;
  };

  const transact = <T>(
    key: string,
    mode: IDBTransactionMode,
    apply: (previous: StoredSecret | undefined, store: IDBObjectStore) => T,
  ): Promise<T> =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new SecretStoreError('Closed'));
        return;
      }
      let tx: IDBTransaction;
      try {
        if (mode === 'readwrite' && strictWrites) {
          tx = db.transaction('secrets', mode, { durability: 'strict' });
          if (tx.durability !== 'strict') {
            tx.abort();
            reject(new SecretStoreError('Unavailable'));
            return;
          }
        } else {
          tx = db.transaction('secrets', mode);
        }
      } catch {
        reject(new SecretStoreError('Unavailable'));
        return;
      }
      let failure: SecretStoreError | undefined;
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure ?? new SecretStoreError('Unavailable'));
      const store = tx.objectStore('secrets');
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const value: unknown = request.result;
          let previous: StoredSecret | undefined;
          if (value !== undefined) {
            if (
              !value ||
              typeof value !== 'object' ||
              !('version' in value) ||
              !validSecretVersion(value.version) ||
              !('bytes' in value) ||
              !(value.bytes instanceof Uint8Array) ||
              value.bytes.byteLength === 0 ||
              value.bytes.byteLength > SECRET_BYTES_LIMIT
            )
              throw new SecretStoreError('Unavailable');
            previous = { version: value.version, bytes: copySecretBytes(value.bytes) };
          }
          try {
            result = apply(previous, store);
          } finally {
            previous?.bytes.fill(0);
          }
        } catch (error) {
          failure = error instanceof SecretStoreError ? error : new SecretStoreError('Unavailable');
          tx.abort();
        }
      };
    });
  return {
    capabilities: Object.freeze({
      persistence: 'persistent',
      protection: 'none',
      ...(strictWrites ? { writeDurability: 'strict' as const } : {}),
    }),
    async read(reference) {
      const key = secretReferenceKey(reference);
      return transact(
        key,
        'readonly',
        (previous) => previous && { version: previous.version, bytes: previous.bytes.slice() },
      );
    },
    async write(reference, bytes, expectedVersion) {
      const key = secretReferenceKey(reference);
      if (expectedVersion !== null && !validSecretVersion(expectedVersion))
        throw new SecretStoreError('InvalidInput');
      const owned = copySecretBytes(bytes);
      try {
        return await transact(key, 'readwrite', (previous, store) => {
          if ((previous?.version ?? null) !== expectedVersion)
            throw new SecretStoreError('Conflict');
          const version = crypto.randomUUID();
          store.put({ version, bytes: owned }, key);
          return { version, bytes: owned.slice() };
        });
      } finally {
        owned.fill(0);
      }
    },
    async remove(reference, expectedVersion) {
      const key = secretReferenceKey(reference);
      if (!validSecretVersion(expectedVersion)) throw new SecretStoreError('InvalidInput');
      await transact(key, 'readwrite', (previous, store) => {
        if (!previous || previous.version !== expectedVersion)
          throw new SecretStoreError('Conflict');
        store.delete(key);
      });
    },
    close,
  };
}
