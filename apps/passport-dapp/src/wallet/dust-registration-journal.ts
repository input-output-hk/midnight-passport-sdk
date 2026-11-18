import type { NightSendLeg } from '../midnames/night-send.js';

const HEX = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{66}$/;
const DATABASE = 'mn-passport:dust-registration';
const ACTIVE = 'active';
const HISTORY = 'history';

interface PendingRegistration {
  readonly version: 1;
  readonly networkId: 'undeployed';
  readonly address: string;
  readonly original: NightSendLeg;
  readonly createdAt: string;
}

function checked(value: unknown, address: string): PendingRegistration | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid saved DUST registration.');
  const row = value as Record<string, unknown>;
  const original = row.original as Record<string, unknown> | undefined;
  if (
    row.version !== 1 ||
    row.networkId !== 'undeployed' ||
    row.address !== address ||
    typeof row.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(row.createdAt)) ||
    !original ||
    typeof original.hash !== 'string' ||
    !HEX.test(original.hash) ||
    !Array.isArray(original.identifiers) ||
    original.identifiers.length === 0 ||
    original.identifiers.length > 32 ||
    original.identifiers.some((id) => typeof id !== 'string' || !ID.test(id)) ||
    new Set(original.identifiers).size !== original.identifiers.length
  )
    throw new Error('Invalid saved DUST registration.');
  return {
    version: 1,
    networkId: 'undeployed',
    address,
    original: {
      hash: original.hash,
      identifiers: original.identifiers.map((id) => String(id)),
    },
    createdAt: row.createdAt,
  };
}

async function open(factory: IDBFactory): Promise<IDBDatabase> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ACTIVE))
        request.result.createObjectStore(ACTIVE);
      if (!request.result.objectStoreNames.contains(HISTORY))
        request.result.createObjectStore(HISTORY);
    };
    request.onerror = request.onblocked = () => {
      blocked = true;
      reject(new Error('DUST registration storage is unavailable.'));
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
  db.onversionchange = () => db.close();
  return db;
}

/** An IndexedDB readwrite transaction reserves the original across tabs before dispatch. */
export async function openDustRegistrationJournal(
  factory: IDBFactory,
  networkId: string,
  address: string,
  legacy?: Pick<Storage, 'getItem' | 'removeItem'>,
) {
  if (networkId !== 'undeployed' || !/^mn_addr_undeployed1[a-z0-9]+$/.test(address))
    throw new Error('Invalid wallet DUST registration scope.');
  const db = await open(factory);
  const key = JSON.stringify([networkId, address]);

  function access<T>(
    update: (
      row: PendingRegistration | undefined,
      tx: IDBTransaction,
      fail: (error: Error) => void,
    ) => T,
    write = false,
    withHistory = false,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        withHistory ? [ACTIVE, HISTORY] : [ACTIVE],
        write ? 'readwrite' : 'readonly',
        write ? { durability: 'strict' } : undefined,
      );
      let result: T;
      let failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? new Error('DUST registration storage did not commit.'));
      const request = tx.objectStore(ACTIVE).get(key);
      request.onsuccess = () => {
        try {
          result = update(checked(request.result, address), tx, (error) => {
            failure = error;
            tx.abort();
          });
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  }

  // Preserve an original saved by the earlier localStorage preview before
  // permitting a new registration on the transactional journal.
  const legacyKey = `mn-passport:dust-registration:v1:${networkId}:${address}:active`;
  try {
    const raw = legacy?.getItem(legacyKey);
    if (raw) {
      if (raw.length > 4096) throw new Error('Invalid saved DUST registration.');
      const prior = checked(JSON.parse(raw), address);
      if (!prior) throw new Error('Invalid saved DUST registration.');
      let finalized = false;
      await access(
        (active, tx, fail) => {
          const history = tx
            .objectStore(HISTORY)
            .get(JSON.stringify([networkId, address, prior.original.hash]));
          history.onsuccess = () => {
            try {
              if (history.result !== undefined) {
                const archived = checked(history.result, address);
                const finalizedAt = (history.result as Record<string, unknown>).finalizedAt;
                if (
                  !archived ||
                  JSON.stringify(archived.original) !== JSON.stringify(prior.original) ||
                  typeof finalizedAt !== 'string' ||
                  !Number.isFinite(Date.parse(finalizedAt)) ||
                  (active && JSON.stringify(active.original) === JSON.stringify(prior.original))
                )
                  throw new Error('Conflicting DUST registration history requires reconciliation.');
                finalized = true;
                return;
              }
              if (active && JSON.stringify(active.original) !== JSON.stringify(prior.original))
                throw new Error(
                  'Conflicting original DUST registration IDs require reconciliation.',
                );
              if (!active) tx.objectStore(ACTIVE).add(prior, key);
            } catch (error) {
              fail(
                error instanceof Error ? error : new Error('DUST registration migration failed.'),
              );
            }
          };
        },
        true,
        true,
      );
      const current = legacy?.getItem(legacyKey);
      if (current && current !== raw)
        throw new Error('The original DUST registration changed during migration.');
      if (finalized && current === raw) legacy?.removeItem(legacyKey);
      // Keep the old key until finality so an already-open older tab also sees
      // a pending original and cannot start a second registration.
    }
  } catch (error) {
    db.close();
    throw error;
  }

  return {
    read: () => access((row) => row),
    create: (original: NightSendLeg) => {
      const row = checked(
        { version: 1, networkId, address, original, createdAt: new Date().toISOString() },
        address,
      );
      if (!row) throw new Error('Invalid DUST registration original.');
      return access((active, tx) => {
        if (active)
          throw new Error('Reconcile the original DUST registration before starting another.');
        tx.objectStore(ACTIVE).add(row, key);
      }, true);
    },
    archive: async (original: NightSendLeg) => {
      const legacyRaw = legacy?.getItem(legacyKey);
      if (legacyRaw) {
        const prior = checked(JSON.parse(legacyRaw), address);
        if (JSON.stringify(prior?.original) !== JSON.stringify(original))
          throw new Error('The legacy DUST registration original changed.');
      }
      await access(
        (active, tx) => {
          if (!active || JSON.stringify(active.original) !== JSON.stringify(original))
            throw new Error('The original DUST registration changed.');
          tx.objectStore(HISTORY).add(
            { ...active, finalizedAt: new Date().toISOString() },
            JSON.stringify([networkId, address, original.hash]),
          );
          tx.objectStore(ACTIVE).delete(key);
        },
        true,
        true,
      );
      if (legacyRaw && legacy?.getItem(legacyKey) === legacyRaw) legacy.removeItem(legacyKey);
    },
    close: () => db.close(),
  };
}
