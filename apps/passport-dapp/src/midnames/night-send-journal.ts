import {
  NIGHT_SEND_OPERATIONS,
  type NightSendIntent,
  type NightSendJournal,
  type NightSendLeg,
} from './night-send.js';
import { validNightCredentialHex } from './night-send-credential.js';
import { localNightBinding } from './local-binding.js';

const databaseName = 'mn-passport:night-send';
const activeStore = 'active';
const historyStore = 'history';
const hex32 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);

export interface BrowserNightSendScope {
  readonly networkId: 'undeployed';
  readonly source: string;
  /** Public credential identifier; never a passkey secret or PRF result. */
  readonly credentialId: string;
  /** Candidate receipts carry the exact binding pin; legacy stable receipts remain readable. */
  readonly bindingId?: string;
  readonly manifestSha256?: string;
}

export interface BrowserNightSendRecord {
  readonly version: 1;
  readonly credentialId: string;
  readonly bindingId?: string;
  readonly manifestSha256?: string;
  readonly intent: NightSendIntent;
  readonly ownerStartedAt?: string;
  readonly withdrawal?: NightSendLeg;
  readonly deposit?: NightSendLeg;
}
type StoredNightSend = BrowserNightSendRecord;

interface ArchivedNightSend extends StoredNightSend {
  readonly archivedAt: string;
}

interface RefusedNightSend extends StoredNightSend {
  readonly refusedAt: string;
  readonly reason:
    'name-recheck' | 'unsupported-fence' | 'sponsor-policy-rejection' | 'device-fee-rejection';
}

function checkedIntent(value: unknown, scope: BrowserNightSendScope): NightSendIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Stored NIGHT intent is invalid.');
  const row = value as Record<string, unknown>;
  const amount = row.amount;
  if (
    !uuid(row.requestId) ||
    row.networkId !== scope.networkId ||
    row.source !== scope.source ||
    !hex32(row.bridge) ||
    !hex32(row.target) ||
    row.target === row.source ||
    row.asset !== 'NIGHT' ||
    typeof amount !== 'string' ||
    !/^[1-9][0-9]{0,38}$/.test(amount) ||
    BigInt(amount) >= 1n << 128n ||
    typeof row.name !== 'string' ||
    row.name.length > 256 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\.)+night$/.test(row.name) ||
    typeof row.providerId !== 'string' ||
    !/^midnames:[a-f0-9]{64}$/.test(row.providerId) ||
    row.namespace !== 'night' ||
    !Array.isArray(row.operations) ||
    row.operations.length !== NIGHT_SEND_OPERATIONS.length ||
    row.operations.some((op, i) => op !== NIGHT_SEND_OPERATIONS[i])
  )
    throw new Error('Stored NIGHT intent is invalid.');
  return {
    requestId: row.requestId,
    networkId: scope.networkId,
    source: scope.source,
    bridge: row.bridge,
    target: row.target,
    asset: 'NIGHT',
    amount,
    name: row.name,
    providerId: row.providerId,
    namespace: 'night',
    operations: NIGHT_SEND_OPERATIONS,
  };
}

function checkedLeg(value: unknown): NightSendLeg {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Stored NIGHT transaction identity is invalid.');
  const row = value as Record<string, unknown>;
  if (
    !hex32(row.hash) ||
    !Array.isArray(row.identifiers) ||
    row.identifiers.length === 0 ||
    row.identifiers.length > 32 ||
    row.identifiers.some((id) => typeof id !== 'string' || !/^[a-f0-9]{66}$/.test(id)) ||
    new Set(row.identifiers).size !== row.identifiers.length
  )
    throw new Error('Stored NIGHT transaction identity is invalid.');
  return { hash: row.hash, identifiers: [...row.identifiers] };
}

function sameBindingProfile(row: Record<string, unknown>, scope: BrowserNightSendScope): boolean {
  return row.bindingId === scope.bindingId && row.manifestSha256 === scope.manifestSha256;
}

function checkedRow(value: unknown, scope: BrowserNightSendScope): StoredNightSend | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Stored NIGHT payment is invalid.');
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || !validNightCredentialHex(row.credentialId))
    throw new Error('Stored NIGHT payment is invalid.');
  if (
    row.ownerStartedAt !== undefined &&
    (typeof row.ownerStartedAt !== 'string' || !Number.isFinite(Date.parse(row.ownerStartedAt)))
  )
    throw new Error('Stored NIGHT owner attempt is invalid.');
  if (row.credentialId !== scope.credentialId)
    throw new Error('The original NIGHT payment belongs to another credential.');
  if (!sameBindingProfile(row, scope))
    throw new Error('The original NIGHT payment belongs to another binding.');
  const intent = checkedIntent(row.intent, scope);
  const withdrawal = row.withdrawal === undefined ? undefined : checkedLeg(row.withdrawal);
  const deposit = row.deposit === undefined ? undefined : checkedLeg(row.deposit);
  if ((deposit && !withdrawal) || (deposit && deposit.hash === withdrawal?.hash))
    throw new Error('Stored NIGHT payment legs are inconsistent.');
  return {
    version: 1,
    credentialId: scope.credentialId,
    ...(scope.bindingId && {
      bindingId: scope.bindingId,
      manifestSha256: scope.manifestSha256,
    }),
    intent,
    ...(row.ownerStartedAt && { ownerStartedAt: row.ownerStartedAt }),
    ...(withdrawal && { withdrawal }),
    ...(deposit && { deposit }),
  };
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(activeStore))
        request.result.createObjectStore(activeStore);
      if (!request.result.objectStoreNames.contains(historyStore))
        request.result.createObjectStore(historyStore);
    };
    request.onerror = request.onblocked = () => {
      blocked = true;
      reject(new Error('NIGHT payment storage is unavailable.'));
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
  });
  db.onversionchange = () => db.close();
  return db;
}

function readArchivedPayment(
  db: IDBDatabase,
  scope: BrowserNightSendScope,
  key: string,
  requestId: string,
): Promise<ArchivedNightSend | undefined> {
  if (!uuid(requestId)) throw new Error('Invalid NIGHT payment request ID.');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(historyStore, 'readonly');
    let result: ArchivedNightSend | undefined;
    let failure: unknown;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? new Error('NIGHT payment history is unavailable.'));
    const request = tx.objectStore(historyStore).get(key);
    request.onsuccess = () => {
      try {
        if (request.result === undefined) return;
        const row = checkedRow(request.result, scope);
        const archivedAt = (request.result as ArchivedNightSend).archivedAt;
        if (
          !row?.withdrawal ||
          !row.deposit ||
          row.intent.requestId !== requestId ||
          typeof archivedAt !== 'string' ||
          !Number.isFinite(Date.parse(archivedAt))
        )
          throw new Error('Stored NIGHT payment history is invalid.');
        result = { ...row, archivedAt };
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
  });
}

function readRefusedPayment(
  db: IDBDatabase,
  scope: BrowserNightSendScope,
  key: string,
  requestId: string,
): Promise<RefusedNightSend | undefined> {
  if (!uuid(requestId)) throw new Error('Invalid NIGHT payment request ID.');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(historyStore, 'readonly');
    let result: RefusedNightSend | undefined;
    let failure: unknown;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? new Error('NIGHT payment history is unavailable.'));
    const request = tx.objectStore(historyStore).get(key);
    request.onsuccess = () => {
      try {
        if (request.result === undefined) return;
        const row = checkedRow(request.result, scope);
        const { refusedAt, reason } = request.result as RefusedNightSend;
        if (
          !row ||
          row.withdrawal ||
          row.deposit ||
          row.intent.requestId !== requestId ||
          !(
            (reason === 'name-recheck' && !row.ownerStartedAt) ||
            ((reason === 'unsupported-fence' ||
              reason === 'sponsor-policy-rejection' ||
              reason === 'device-fee-rejection') &&
              !!row.ownerStartedAt)
          ) ||
          typeof refusedAt !== 'string' ||
          !Number.isFinite(Date.parse(refusedAt))
        )
          throw new Error('Stored NIGHT refusal history is invalid.');
        result = { ...row, refusedAt, reason };
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
  });
}

type JournalAccess = <T>(
  update: (row: StoredNightSend | undefined, tx: IDBTransaction, fail: (error: Error) => void) => T,
  write?: boolean,
  withHistory?: boolean,
) => Promise<T>;

function ownerAttemptMethods(
  access: JournalAccess,
  scope: BrowserNightSendScope,
  key: string,
  historyKey: (requestId: string) => string,
): Required<
  Pick<NightSendJournal, 'markOwnerStarted' | 'retireRefused' | 'retireUnsupportedFence'>
> {
  return {
    markOwnerStarted: async (value) => {
      const intent = checkedIntent(value, scope);
      await access((row, tx) => {
        if (
          !row ||
          row.ownerStartedAt ||
          row.withdrawal ||
          row.deposit ||
          !same(row.intent, intent)
        )
          throw new Error('The owner attempt cannot start for this NIGHT intent.');
        tx.objectStore(activeStore).put({ ...row, ownerStartedAt: new Date().toISOString() }, key);
      }, true);
    },
    retireRefused: async (value, reason) => {
      if (reason !== 'name-recheck') throw new Error('Unknown NIGHT refusal reason.');
      const intent = checkedIntent(value, scope);
      await access(
        (row, tx) => {
          if (
            !row ||
            row.ownerStartedAt ||
            row.withdrawal ||
            row.deposit ||
            !same(row.intent, intent)
          )
            throw new Error('Only the exact unsubmitted NIGHT intent can be retired.');
          tx.objectStore(historyStore).add(
            { ...row, refusedAt: new Date().toISOString(), reason } satisfies RefusedNightSend,
            historyKey(row.intent.requestId),
          );
          tx.objectStore(activeStore).delete(key);
        },
        true,
        true,
      );
    },
    retireUnsupportedFence: async (value) => {
      const intent = checkedIntent(value, scope);
      await access(
        (row, tx) => {
          if (!row?.ownerStartedAt || row.withdrawal || row.deposit || !same(row.intent, intent))
            throw new Error('Only the exact pre-submission NIGHT attempt can be reconciled.');
          tx.objectStore(historyStore).add(
            {
              ...row,
              refusedAt: new Date().toISOString(),
              reason: 'unsupported-fence',
            } satisfies RefusedNightSend,
            historyKey(row.intent.requestId),
          );
          tx.objectStore(activeStore).delete(key);
        },
        true,
        true,
      );
    },
  };
}

/** One active original per ACC on this origin, serialized by IndexedDB across tabs. */
export async function openBrowserNightSendJournal(
  factory: IDBFactory,
  scope: BrowserNightSendScope,
) {
  if (
    scope.networkId !== 'undeployed' ||
    !hex32(scope.source) ||
    !validNightCredentialHex(scope.credentialId) ||
    (scope.bindingId !== undefined &&
      (scope.bindingId !== 'acc-s3r1.1-zkir036' ||
        !localNightBinding(scope.bindingId, scope.manifestSha256, true))) ||
    (scope.bindingId === undefined && scope.manifestSha256 !== undefined)
  )
    throw new Error('Invalid browser NIGHT payment scope.');
  const db = await openDatabase(factory);
  const key = JSON.stringify([scope.networkId, scope.source]);
  const historyKey = (requestId: string) =>
    JSON.stringify([scope.networkId, scope.source, requestId]);

  function access<T>(
    update: (
      row: StoredNightSend | undefined,
      tx: IDBTransaction,
      fail: (error: Error) => void,
    ) => T,
    write = false,
    withHistory = false,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        withHistory ? [activeStore, historyStore] : [activeStore],
        write ? 'readwrite' : 'readonly',
        write ? { durability: 'strict' } : undefined,
      );
      let result: T;
      let failure: unknown;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? new Error('NIGHT payment storage did not commit.'));
      const request = tx.objectStore(activeStore).get(key);
      request.onsuccess = () => {
        try {
          result = update(checkedRow(request.result, scope), tx, (error) => {
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

  const journal = {
    readIntent: () => access((row) => row?.intent),
    createIntent: async (value) => {
      const intent = checkedIntent(value, scope);
      await access(
        (row, tx, fail) => {
          if (row) throw new Error('Reconcile the original NIGHT payment before another send.');
          const prior = tx.objectStore(historyStore).get(historyKey(intent.requestId));
          prior.onsuccess = () => {
            if (prior.result !== undefined) {
              fail(new Error('The NIGHT payment request ID is already archived.'));
              return;
            }
            tx.objectStore(activeStore).add(
              {
                version: 1,
                credentialId: scope.credentialId,
                ...(scope.bindingId && {
                  bindingId: scope.bindingId,
                  manifestSha256: scope.manifestSha256,
                }),
                intent,
              },
              key,
            );
          };
        },
        true,
        true,
      );
    },
    readLeg: (leg) => {
      if (leg !== 'withdraw' && leg !== 'deposit') throw new Error('Unknown NIGHT payment leg.');
      return access((row) => row?.[leg === 'withdraw' ? 'withdrawal' : 'deposit']);
    },
    fenceLeg: async (leg, value) => {
      if (leg !== 'withdraw' && leg !== 'deposit') throw new Error('Unknown NIGHT payment leg.');
      const original = checkedLeg(value);
      await access((row, tx) => {
        if (!row) throw new Error('The original NIGHT intent is missing.');
        if (leg === 'withdraw') {
          if (row.withdrawal) throw new Error('The original withdrawal is already fenced.');
        } else if (!row.withdrawal || row.deposit || row.withdrawal.hash === original.hash)
          throw new Error('The original deposit cannot be fenced.');
        tx.objectStore(activeStore).put(
          { ...row, [leg === 'withdraw' ? 'withdrawal' : 'deposit']: original },
          key,
        );
      }, true);
    },
    ...ownerAttemptMethods(access, scope, key, historyKey),
  } satisfies NightSendJournal;

  return {
    ...journal,
    readActive: () => access((row) => row),
    archiveCompleted: async (
      intent: NightSendIntent,
      withdrawal: NightSendLeg,
      deposit: NightSendLeg,
      finalized: (original: NightSendLeg) => Promise<boolean>,
    ) => {
      const expected = checkedIntent(intent, scope);
      const first = checkedLeg(withdrawal);
      const second = checkedLeg(deposit);
      if (!(await finalized(first)) || !(await finalized(second)))
        throw new Error('Both original NIGHT payment legs must be final before archiving.');
      await access(
        (row, tx) => {
          if (
            !row?.withdrawal ||
            !row.deposit ||
            !same(row.intent, expected) ||
            !same(row.withdrawal, first) ||
            !same(row.deposit, second)
          )
            throw new Error('The original NIGHT payment is not ready to archive.');
          tx.objectStore(historyStore).add(
            { ...row, archivedAt: new Date().toISOString() } satisfies ArchivedNightSend,
            historyKey(row.intent.requestId),
          );
          tx.objectStore(activeStore).delete(key);
        },
        true,
        true,
      );
    },
    readArchived: (requestId: string) =>
      readArchivedPayment(db, scope, historyKey(requestId), requestId),
    readRefused: (requestId: string) =>
      readRefusedPayment(db, scope, historyKey(requestId), requestId),
    close: () => db.close(),
  };
}
