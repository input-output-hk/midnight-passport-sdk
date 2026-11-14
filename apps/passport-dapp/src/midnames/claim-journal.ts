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
const releasedStore = 'released-claims';

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

function claimKeyName(key: IDBValidKey, registry: string): string | undefined {
  if (typeof key !== 'string') return undefined;
  let scope: unknown;
  try {
    scope = JSON.parse(key);
  } catch {
    return undefined;
  }
  if (!Array.isArray(scope) || scope[0] !== 'undeployed') return undefined;
  if (scope[1] !== registry) return undefined;
  if (scope.length !== 3 || typeof scope[2] !== 'string')
    throw new Error('Stored claim key is invalid.');
  return scope[2];
}

function activeClaimName(
  value: unknown,
  key: IDBValidKey,
  registry: string,
  account: string,
  credential: string,
): string | undefined {
  const storedName = claimKeyName(key, registry);
  if (!storedName) return undefined;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    if (claimHex(row.credential) && row.credential !== credential) return undefined;
    const destinations = [row.receipt, row.quote].filter(
      (entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object',
    );
    if (
      destinations.length &&
      destinations.every(
        (entry) => claimHex(entry.accountAddress) && entry.accountAddress !== account,
      )
    )
      return undefined;
  }
  const retained = readStored(value);
  const destination = retained?.receipt ?? retained?.quote;
  if (destination && (storedName !== destination.name || destination.registryAddress !== registry))
    throw new Error('Stored claim key differs from its original.');
  return retained?.credential === credential &&
    destination?.registryAddress === registry &&
    destination.accountAddress === account &&
    (retained.receipt ||
      retained.ownerCommitment ||
      (retained.quote && retained.quote.expiresAt > Date.now()))
    ? destination.name
    : undefined;
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
      [selectionStore, storeName],
      name === undefined ? 'readonly' : 'readwrite',
      {
        durability: 'strict',
      },
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
        // Version 1 has claims but no selections. Recover an unambiguous
        // prepared quote, but do not turn an imported receipt into a selection.
        const originals = new Set<string>();
        const prepared = new Set<string>();
        const scan = tx.objectStore(storeName).openCursor();
        scan.onsuccess = () => {
          try {
            const cursor = scan.result;
            if (!cursor) {
              if (name === undefined) {
                const sole = originals.size === 1 ? [...originals][0] : undefined;
                if (originals.size > 1 && (!previous || !originals.has(previous)))
                  throw new Error('Multiple original claims require manual recovery.');
                result =
                  previous && (!originals.size || originals.has(previous))
                    ? previous
                    : sole && prepared.has(sole)
                      ? sole
                      : undefined;
              } else {
                if (originals.size && !originals.has(name))
                  throw new Error('Recover the original claim before choosing another name.');
                if (name !== previous) store.put(name, key);
              }
              return;
            }
            const active = activeClaimName(cursor.value, cursor.key, registry, account, credential);
            if (active) {
              originals.add(active);
              if ((cursor.value as StoredClaim).quote) prepared.add(active);
            }
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
      if (current !== name)
        throw new Error('Review and select this name before reserving a claim.');
      const scan = tx.objectStore(storeName).openCursor();
      scan.onsuccess = () => {
        try {
          const cursor = scan.result;
          if (!cursor) {
            allowed();
            return;
          }
          const active = activeClaimName(cursor.value, cursor.key, registry, account, credential);
          if (active && active !== name)
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
    guardReleasedSha?: string,
  ): Promise<StoredClaim | undefined> {
    return new Promise((resolve, reject) => {
      const key = JSON.stringify(['undeployed', registry, name]);
      const tx = db.transaction(
        [
          storeName,
          ...(guardAccount ? [selectionStore] : []),
          ...(guardReleasedSha ? [releasedStore] : []),
        ],
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
          const checkArchive = () => {
            if (!guardReleasedSha) return apply();
            const archived = tx
              .objectStore(releasedStore)
              .get(JSON.stringify(['undeployed', registry, name, guardReleasedSha]));
            archived.onsuccess = () => {
              try {
                if (archived.result !== undefined)
                  throw new Error(
                    'This failed original was already released. Review a fresh claim.',
                  );
                apply();
              } catch (error) {
                failure = error;
                tx.abort();
              }
            };
          };
          if (guardAccount)
            guardReservation(
              tx,
              registry,
              name,
              credential,
              guardAccount,
              checkArchive,
              (error) => {
                failure = error;
                tx.abort();
              },
            );
          else checkArchive();
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    });
  };
}

/** Archive only an exact, externally verified failed original. The caller must
 * recheck finality and registry availability before this atomic release. */
function releaseFailed(db: IDBDatabase, receipt: ClaimReceipt, credential: string): Promise<void> {
  const original = claimReceipt(receipt);
  if (!claimHex(credential)) throw new Error('Invalid claim credential scope.');
  const key = JSON.stringify(['undeployed', original.registryAddress, original.name]);
  const selectionId = selectionKey(original.registryAddress, original.accountAddress, credential);
  const releasedId = JSON.stringify([
    'undeployed',
    original.registryAddress,
    original.name,
    original.transaction.sha256,
  ]);
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName, selectionStore, releasedStore], 'readwrite', {
      durability: 'strict',
    });
    let failure: unknown;
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? new Error('Failed claim release could not commit.'));
    const claims = tx.objectStore(storeName);
    const selected = tx.objectStore(selectionStore);
    const history = tx.objectStore(releasedStore);
    const current = claims.get(key);
    current.onsuccess = () => {
      try {
        const stored = readStored(current.result);
        if (
          stored?.credential !== credential ||
          !stored.receipt ||
          JSON.stringify(stored.receipt) !== JSON.stringify(original)
        )
          throw new Error('The failed original changed. Check it again before release.');
        const choice = selected.get(selectionId);
        choice.onsuccess = () => {
          try {
            const name = selectedName(choice.result);
            if (name !== undefined && name !== original.name)
              throw new Error('The selected name changed. Check it again before release.');
            let lastRelease = 0;
            const scan = history.openCursor();
            scan.onsuccess = () => {
              try {
                const cursor = scan.result;
                if (cursor) {
                  const row = cursor.value as Record<string, unknown>;
                  if (row.credential === credential && row.receipt) {
                    const prior = readStored(row);
                    if (
                      prior?.receipt?.registryAddress === original.registryAddress &&
                      prior.receipt.name === original.name &&
                      prior.receipt.accountAddress === original.accountAddress
                    ) {
                      const timestamp = Date.parse(String(row.releasedAt));
                      if (row.reason !== 'FAILURE' || !Number.isFinite(timestamp))
                        throw new Error('Released claim history is invalid.');
                      lastRelease = Math.max(lastRelease, timestamp);
                    }
                  }
                  cursor.continue();
                  return;
                }
                const releasedAt = new Date(Math.max(Date.now(), lastRelease + 1)).toISOString();
                history.add({ ...stored, releasedAt, reason: 'FAILURE' }, releasedId);
                claims.delete(key);
                if (name !== undefined) selected.delete(selectionId);
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
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
  });
}

function readReleased(
  db: IDBDatabase,
  registry: string,
  name: string,
  account: string,
  credential: string,
): Promise<ClaimReceipt[]> {
  if (!claimHex(registry) || !claimName(name) || !claimHex(account) || !claimHex(credential))
    throw new Error('Invalid released claim scope.');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(releasedStore, 'readonly');
    const receipts: { receipt: ClaimReceipt; releasedAt: string }[] = [];
    let failure: unknown;
    tx.oncomplete = () =>
      resolve(
        receipts
          .sort((a, b) => a.releasedAt.localeCompare(b.releasedAt))
          .map(({ receipt }) => receipt),
      );
    tx.onabort = () => reject(failure ?? new Error('Released claim history is unavailable.'));
    const cursor = tx.objectStore(releasedStore).openCursor();
    cursor.onsuccess = () => {
      try {
        if (!cursor.result) return;
        const key = JSON.parse(String(cursor.result.key)) as unknown;
        if (
          Array.isArray(key) &&
          key.length === 4 &&
          key[0] === 'undeployed' &&
          key[1] === registry &&
          key[2] === name
        ) {
          const row = cursor.result.value as Record<string, unknown>;
          if (row.credential === credential) {
            const stored = readStored(row);
            if (
              row.reason !== 'FAILURE' ||
              typeof row.releasedAt !== 'string' ||
              !Number.isFinite(Date.parse(row.releasedAt)) ||
              !stored?.receipt ||
              stored.receipt.transaction.sha256 !== key[3]
            )
              throw new Error('Released claim history is invalid.');
            if (stored.receipt.accountAddress === account)
              receipts.push({ receipt: stored.receipt, releasedAt: row.releasedAt });
          }
        }
        cursor.result.continue();
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
  });
}

/** A network/registry/name has one original receipt on this origin, including across tabs. */
export async function openClaimJournal(indexedDB: IDBFactory) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('mn-passport:midnames-claims', 3);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName))
        request.result.createObjectStore(storeName);
      if (!request.result.objectStoreNames.contains(selectionStore))
        request.result.createObjectStore(selectionStore);
      if (!request.result.objectStoreNames.contains(releasedStore))
        request.result.createObjectStore(releasedStore);
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
        await access(
          receipt.registryAddress,
          receipt.name,
          credential,
          (previous) => {
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
          },
          undefined,
          receipt.transaction.sha256,
        )
      )?.receipt;
    },
    releaseFailed: (receipt: ClaimReceipt, credential: string) =>
      releaseFailed(db, receipt, credential),
    readReleased: (registry: string, name: string, account: string, credential: string) =>
      readReleased(db, registry, name, account, credential),
    close: () => db.close(),
  };
}
