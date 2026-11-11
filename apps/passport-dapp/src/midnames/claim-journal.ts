import { claimHex, claimReceipt, type ClaimReceipt } from './claim-receipt.js';
import { claimQuote, matchesDestination, type ClaimQuote } from './claim-quote.js';

interface StoredClaim {
  readonly credential: string;
  readonly receipt?: ClaimReceipt;
  readonly quote?: ClaimQuote;
  readonly ownerCommitment?: string;
}

export type ClaimJournal = Awaited<ReturnType<typeof openClaimJournal>>;
const storeName = 'claims';

function readStored(value: unknown): StoredClaim | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw new Error('Stored claim is invalid.');
  const row = value as Record<string, unknown>;
  if (!claimHex(row.credential)) throw new Error('Stored claim scope is invalid.');
  const quote = row.quote === undefined ? undefined : claimQuote(row.quote);
  const receipt = row.receipt === undefined ? undefined : claimReceipt(row.receipt);
  const { ownerCommitment } = row;
  if (
    (!quote && !receipt) ||
    (quote && receipt && !matchesDestination(receipt, quote)) ||
    (ownerCommitment !== undefined && (!quote || !claimHex(ownerCommitment))) ||
    (quote && receipt && receipt.ownerCommitment !== ownerCommitment)
  )
    throw new Error('Stored claim is invalid.');
  return {
    credential: row.credential,
    ...(quote && { quote }),
    ...(receipt && { receipt }),
    ...(ownerCommitment && { ownerCommitment }),
  };
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
    update?: (previous: StoredClaim | undefined) => StoredClaim,
  ): Promise<StoredClaim | undefined> {
    return new Promise((resolve, reject) => {
      const key = JSON.stringify(['undeployed', registry, name]);
      const tx = db.transaction(storeName, update ? 'readwrite' : 'readonly', {
        durability: 'strict',
      });
      const store = tx.objectStore(storeName);
      let result: StoredClaim | undefined;
      let failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? new Error('Claim storage could not commit.'));
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          const previous = readStored(request.result);
          const destination = previous?.receipt ?? previous?.quote;
          if (
            previous &&
            (previous.credential !== credential ||
              destination?.registryAddress !== registry ||
              destination.name !== name)
          )
            throw new Error('A different original claim is retained for this name.');
          result = update ? update(previous) : previous;
          if (result && result !== previous) store.put(result, key);
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  }
  return {
    read: async (registry: string, name: string, credential: string) =>
      (await access(registry, name, credential))?.receipt,
    async readPreparation(registry: string, name: string, credential: string) {
      const row = await access(registry, name, credential);
      return row?.quote ? { quote: row.quote, ownerCommitment: row.ownerCommitment } : undefined;
    },
    async reserve(quote: ClaimQuote, credential: string) {
      await access(quote.registryAddress, quote.name, credential, (previous) => {
        if (quote.expiresAt <= Date.now()) throw new Error('The claim quote expired.');
        if (previous) {
          if (previous.receipt || !previous.quote)
            throw new Error('A different original claim is retained for this name.');
          if (JSON.stringify(previous.quote) === JSON.stringify(quote)) return previous;
          if (previous.ownerCommitment || previous.quote.expiresAt > Date.now())
            throw new Error('A different original claim is retained for this name.');
        }
        return { credential, quote };
      });
    },
    async bindOwner(quote: ClaimQuote, credential: string, ownerCommitment: string) {
      let first = false;
      await access(quote.registryAddress, quote.name, credential, (previous) => {
        if (
          !previous ||
          JSON.stringify(previous.quote) !== JSON.stringify(quote) ||
          !claimHex(ownerCommitment) ||
          (previous.ownerCommitment && previous.ownerCommitment !== ownerCommitment)
        )
          throw new Error('Naming authority differs from the original reviewed quote.');
        if (previous.ownerCommitment) return previous;
        first = true;
        return { ...previous, ownerCommitment };
      });
      return first;
    },
    async retain(receipt: ClaimReceipt, credential: string, quote?: ClaimQuote) {
      return (
        await access(receipt.registryAddress, receipt.name, credential, (previous) => {
          if (previous?.receipt) {
            if (JSON.stringify(previous.receipt) !== JSON.stringify(receipt))
              throw new Error('A different original claim is retained for this name.');
            return previous;
          }
          if (
            JSON.stringify(previous?.quote) !== JSON.stringify(quote) ||
            (quote &&
              (!matchesDestination(receipt, quote) ||
                previous?.ownerCommitment !== receipt.ownerCommitment))
          )
            throw new Error('The receipt does not match the original reviewed quote.');
          return { ...previous, credential, receipt };
        })
      )?.receipt;
    },
    close: () => db.close(),
  };
}
