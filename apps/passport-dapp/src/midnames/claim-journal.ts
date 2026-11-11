import { claimHex, claimReceipt, type ClaimReceipt } from './claim-receipt.js';

interface StoredClaim {
  readonly credential: string;
  readonly receipt: ClaimReceipt;
}

export type ClaimJournal = Awaited<ReturnType<typeof openClaimJournal>>;
const storeName = 'claims';

function readStored(value: unknown): StoredClaim | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw new Error('Stored claim is invalid.');
  const row = value as Record<string, unknown>;
  if (!claimHex(row.credential)) throw new Error('Stored claim scope is invalid.');
  return { credential: row.credential, receipt: claimReceipt(row.receipt) };
}

/** A network/registry/name has one original receipt on this origin, including across tabs. */
export async function openClaimJournal(indexedDB: IDBFactory) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('mn-passport:midnames-claims', 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = request.onblocked = () => {
      blocked = true;
      reject(new Error('Claim storage is unavailable.'));
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
  db.onversionchange = () => db.close();

  function access(
    registry: string,
    name: string,
    credential: string,
    original?: ClaimReceipt,
  ): Promise<ClaimReceipt | undefined> {
    return new Promise((resolve, reject) => {
      const key = JSON.stringify(['undeployed', registry, name]);
      const tx = db.transaction(storeName, original ? 'readwrite' : 'readonly', {
        durability: 'strict',
      });
      const store = tx.objectStore(storeName);
      let result: ClaimReceipt | undefined;
      let failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? new Error('Claim storage could not commit.'));
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const previous = readStored(request.result);
          if (
            previous &&
            (previous.credential !== credential ||
              previous.receipt.registryAddress !== registry ||
              previous.receipt.name !== name ||
              (original && JSON.stringify(previous.receipt) !== JSON.stringify(original)))
          )
            throw new Error('A different original claim is retained for this name.');
          result = previous?.receipt ?? original;
          if (!previous && original) store.add({ credential, receipt: original }, key);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  }
  return {
    read: (registry: string, name: string, credential: string) =>
      access(registry, name, credential),
    retain: (receipt: ClaimReceipt, credential: string) =>
      access(receipt.registryAddress, receipt.name, credential, receipt),
    close: () => db.close(),
  };
}
