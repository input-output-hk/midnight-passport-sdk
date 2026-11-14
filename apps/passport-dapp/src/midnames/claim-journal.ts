import { claimHex, claimName, claimReceipt, type ClaimReceipt } from './claim-receipt.js';
import {
  claimQuote,
  claimQuoteDigest,
  matchesDestination,
  type ClaimQuote,
} from './claim-quote.js';

interface StoredClaim {
  readonly credential: string;
  readonly receipt?: ClaimReceipt;
  readonly quote?: ClaimQuote;
  readonly quoteSha256?: string;
  readonly ownerCommitment?: string;
}

export type ClaimJournal = Awaited<ReturnType<typeof openClaimJournal>>;
const storeName = 'claims';
const selectionStore = 'selections';

const selectionKey = (registry: string, account: string, credential: string) =>
  JSON.stringify(['undeployed', registry, account, credential]);

function selectedName(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!claimName(value)) throw new Error('Stored name selection is invalid.');
  return value;
}

function readStored(value: unknown): StoredClaim | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object') throw new Error('Stored claim is invalid.');
  const row = value as Record<string, unknown>;
  if (!claimHex(row.credential)) throw new Error('Stored claim scope is invalid.');
  const quote = row.quote === undefined ? undefined : claimQuote(row.quote);
  const receipt = row.receipt === undefined ? undefined : claimReceipt(row.receipt);
  const { ownerCommitment, quoteSha256 } = row;
  if (
    (!quote && !receipt) ||
    (quoteSha256 !== undefined && (!quote || !claimHex(quoteSha256))) ||
    (ownerCommitment !== undefined && (!quote || !claimHex(ownerCommitment))) ||
    (quote &&
      receipt &&
      (!matchesDestination(receipt, quote) ||
        receipt.ownerCommitment !== ownerCommitment ||
        receipt.quoteSha256 !== quoteSha256))
  )
    throw new Error('Stored claim is invalid.');
  return {
    credential: row.credential,
    ...(quote && { quote }),
    ...(typeof quoteSha256 === 'string' && { quoteSha256 }),
    ...(receipt && { receipt }),
    ...(ownerCommitment && { ownerCommitment }),
  };
}

function selection(
  db: IDBDatabase,
  registry: string,
  account: string,
  credential: string,
  name?: string,
): Promise<string | undefined> {
  if (
    !claimHex(registry) ||
    !claimHex(account) ||
    !claimHex(credential) ||
    (name !== undefined && !claimName(name))
  )
    throw new Error('Invalid name selection scope.');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      name === undefined ? selectionStore : [selectionStore, storeName],
      name === undefined ? 'readonly' : 'readwrite',
      { durability: 'strict' },
    );
    const key = selectionKey(registry, account, credential);
    const store = tx.objectStore(selectionStore);
    let result: string | undefined;
    let failure: unknown;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? new Error('Name selection could not commit.'));
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        const previous = selectedName(request.result);
        result = name ?? previous;
        if (name === undefined) return;
        // Version 1 has claims but no selections. Scan the original records in
        // this transaction before admitting a new choice for this ACC.
        const scan = tx.objectStore(storeName).openCursor();
        scan.onsuccess = () => {
          try {
            const cursor = scan.result;
            if (!cursor) {
              if (name !== previous) store.put(name, key);
              return;
            }
            const retained = readStored(cursor.value);
            const destination = retained?.receipt ?? retained?.quote;
            if (
              retained?.credential === credential &&
              destination?.registryAddress === registry &&
              destination.accountAddress === account &&
              destination.name !== name &&
              (retained.receipt ||
                retained.ownerCommitment ||
                (retained.quote && retained.quote.expiresAt > Date.now()))
            )
              throw new Error('Recover the original claim before choosing another name.');
            cursor.continue();
          } catch (error) {
            failure = error;
            tx.abort();
          }
        };
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
  });
}

function guardReservation(
  tx: IDBTransaction,
  registry: string,
  name: string,
  credential: string,
  account: string,
  allowed: () => void,
  failed: (error: unknown) => void,
) {
  const selected = tx.objectStore(selectionStore).get(selectionKey(registry, account, credential));
  selected.onsuccess = () => {
    try {
      const current = selectedName(selected.result);
      if (current && current !== name)
        throw new Error('A different name is selected for this ACC.');
      const scan = tx.objectStore(storeName).openCursor();
      scan.onsuccess = () => {
        try {
          const cursor = scan.result;
          if (!cursor) {
            allowed();
            return;
          }
          const retained = readStored(cursor.value);
          const destination = retained?.receipt ?? retained?.quote;
          if (
            retained?.credential === credential &&
            destination?.registryAddress === registry &&
            destination.accountAddress === account &&
            destination.name !== name &&
            (retained.receipt ||
              retained.ownerCommitment ||
              (retained.quote && retained.quote.expiresAt > Date.now()))
          )
            throw new Error('Recover the original claim before reserving another name.');
          cursor.continue();
        } catch (error) {
          failed(error);
        }
      };
    } catch (error) {
      failed(error);
    }
  };
}

function makeAccess(db: IDBDatabase) {
  return function access(
    registry: string,
    name: string,
    credential: string,
    update?: (previous: StoredClaim | undefined) => StoredClaim | undefined,
    guardAccount?: string,
  ): Promise<StoredClaim | undefined> {
    return new Promise((resolve, reject) => {
      const key = JSON.stringify(['undeployed', registry, name]);
      const tx = db.transaction(
        guardAccount ? [storeName, selectionStore] : storeName,
        update ? 'readwrite' : 'readonly',
        { durability: 'strict' },
      );
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
          const apply = () => {
            result = update ? update(previous) : previous;
            if (result !== previous) {
              if (result) store.put(result, key);
              else store.delete(key);
            }
          };
          if (guardAccount)
            guardReservation(tx, registry, name, credential, guardAccount, apply, (error) => {
              failure = error;
              tx.abort();
            });
          else apply();
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  };
}

/** A network/registry/name has one original receipt on this origin, including across tabs. */
export async function openClaimJournal(indexedDB: IDBFactory) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('mn-passport:midnames-claims', 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName))
        request.result.createObjectStore(storeName);
      if (!request.result.objectStoreNames.contains(selectionStore))
        request.result.createObjectStore(selectionStore);
    };
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
  const access = makeAccess(db);
  return {
    readSelection: (registry: string, account: string, credential: string) =>
      selection(db, registry, account, credential),
    selectName: (registry: string, account: string, credential: string, name: string) =>
      selection(db, registry, account, credential, name),
    read: async (registry: string, name: string, credential: string) =>
      (await access(registry, name, credential))?.receipt,
    async readPreparation(registry: string, name: string, credential: string) {
      const row = await access(registry, name, credential);
      return row?.quote ? { quote: row.quote, ownerCommitment: row.ownerCommitment } : undefined;
    },
    async reserve(quote: ClaimQuote, credential: string) {
      const quoteSha256 = await claimQuoteDigest(quote);
      await access(
        quote.registryAddress,
        quote.name,
        credential,
        (previous) => {
          if (quote.expiresAt <= Date.now()) throw new Error('The claim quote expired.');
          if (previous) {
            if (previous.receipt || !previous.quote)
              throw new Error('A different original claim is retained for this name.');
            if (JSON.stringify(previous.quote) === JSON.stringify(quote))
              return previous.quoteSha256 === undefined ? { ...previous, quoteSha256 } : previous;
            if (previous.ownerCommitment || previous.quote.expiresAt > Date.now())
              throw new Error('A different original claim is retained for this name.');
          }
          return { credential, quote, quoteSha256 };
        },
        quote.accountAddress,
      );
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
        if (quote.expiresAt <= Date.now()) throw new Error('The claim quote expired.');
        first = true;
        return { ...previous, ownerCommitment };
      });
      return first;
    },
    async releaseRefused(quote: ClaimQuote, credential: string, ownerCommitment: string) {
      await access(quote.registryAddress, quote.name, credential, (previous) => {
        if (
          !previous ||
          previous.receipt ||
          previous.ownerCommitment !== ownerCommitment ||
          JSON.stringify(previous.quote) !== JSON.stringify(quote)
        )
          throw new Error('The refused preparation differs from the retained original.');
        return undefined;
      });
    },
    async retain(receipt: ClaimReceipt, credential: string, quote?: ClaimQuote) {
      const saved = await access(receipt.registryAddress, receipt.name, credential);
      const expected = quote ?? saved?.quote;
      const digest = expected && (await claimQuoteDigest(expected));
      return (
        await access(receipt.registryAddress, receipt.name, credential, (previous) => {
          if (previous?.receipt) {
            if (JSON.stringify(previous.receipt) !== JSON.stringify(receipt))
              throw new Error('A different original claim is retained for this name.');
            return previous;
          }
          if (JSON.stringify(previous?.quote) !== JSON.stringify(expected))
            throw new Error('The receipt does not match the original reviewed quote.');
          if (
            previous?.quote &&
            (!matchesDestination(receipt, previous.quote) ||
              previous.ownerCommitment !== receipt.ownerCommitment ||
              (previous.quoteSha256 !== undefined && previous.quoteSha256 !== digest) ||
              receipt.quoteSha256 !== digest)
          )
            throw new Error('The receipt does not match the original reviewed quote.');
          return { ...previous, credential, receipt, ...(digest && { quoteSha256: digest }) };
        })
      )?.receipt;
    },
    close: () => db.close(),
  };
}
