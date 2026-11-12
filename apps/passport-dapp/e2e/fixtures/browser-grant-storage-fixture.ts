import {
  createDemoBrowserGrantStores,
  deriveDemoGrantOpeningKey,
} from '../../src/browser-grant-stores.js';

const account = '31'.repeat(32);
const networkId = 'undeployed';
const intent = {
  account,
  networkId,
  issuer: 'https://passport.example',
  nonce: '42'.repeat(32),
  requestDigest: '53'.repeat(32),
  validUntilSeconds: 1_790_000_100,
};
const salt = '74'.repeat(32);

async function stores(seed: number, forAccount = account) {
  const raw = new Uint8Array(32).fill(seed);
  const openingKey = await deriveDemoGrantOpeningKey(
    {
      withSession: (work) => work(),
      deviceSecret: async () => {
        throw new Error('No device secret read expected');
      },
      deriveSecret: async () => raw,
    },
    networkId,
    forAccount,
  );
  if (raw.some((byte) => byte !== 0) || openingKey.extractable)
    throw new Error('The opening key must be non-exportable and the raw input zeroed');
  return createDemoBrowserGrantStores({ indexedDB, networkId, account: forAccount, openingKey });
}

export async function claim() {
  const store = await stores(9);
  try {
    return await store.nonces.claim(intent);
  } finally {
    store.close();
  }
}

export async function stage(requestId: string) {
  const store = await stores(9);
  try {
    const record = {
      requestId,
      networkId,
      opening: {
        scope: {
          account,
          grantee: {
            scheme: 'p256-webauthn' as const,
            publicKey: '02' + '68'.repeat(32),
            origin: 'https://bank.example1',
            rpIdHash: '69'.repeat(32),
          },
          color: '00'.repeat(32),
          recipient: '81'.repeat(32),
          maxCoinValue: '5',
          perCallCap: '1',
          cap: '5',
          expiresAt: 1_790_000_200,
        },
        grantId: '82'.repeat(32),
        slot: 7,
        scopeSalt: salt,
      },
      intentSha256: '91'.repeat(32),
      expectedIssuedAt: 1n,
      deviceEpoch: 0n,
      grantGeneration: 0n,
    };
    const fenced = await store.fence.reserve(requestId);
    const reserved = await store.journal.reserve(record);
    await store.journal.recordTransaction(record, '92'.repeat(32));
    return fenced && reserved;
  } finally {
    store.close();
  }
}

export async function recover(requestId: string, seed = 9) {
  const store = await stores(seed);
  try {
    const original = await store.nonces.read(intent);
    const fenced = await store.fence.has(requestId);
    try {
      const record = await store.journal.read(requestId);
      return {
        original,
        fenced,
        openingMatched: record?.opening.scopeSalt === salt && record.txHash === '92'.repeat(32),
        refused: false,
      };
    } catch {
      return { original, fenced, openingMatched: false, refused: true };
    }
  } finally {
    store.close();
  }
}

export async function crossAccountRefused() {
  const changedAccount = '83'.repeat(32);
  const store = await stores(9, changedAccount);
  try {
    await store.nonces.claim({ ...intent, account: changedAccount });
    return false;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'GrantScopeInvalid';
  } finally {
    store.close();
  }
}

async function openFixtureDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('mn-passport-demo:browser-grant-openings-v1', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Cannot read fixture database'));
  });
}

export async function openingCiphertextRetained() {
  const db = await openFixtureDatabase();
  try {
    const entries = await new Promise<{ readonly bytes: Uint8Array }[]>((resolve, reject) => {
      const request = db.transaction('secrets', 'readonly').objectStore('secrets').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('Cannot inspect fixture record'));
    });
    return (
      entries.length === 1 &&
      entries.every(
        ({ bytes }) => bytes.length > 32 && !new TextDecoder().decode(bytes).includes(salt),
      )
    );
  } finally {
    db.close();
  }
}

export async function tamperOpeningRevision() {
  const db = await openFixtureDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('secrets', 'readwrite');
      const request = tx.objectStore('secrets').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return tx.abort();
        const stored: { version: string; bytes: Uint8Array } = cursor.value;
        const revision = new DataView(stored.bytes.buffer, stored.bytes.byteOffset, 4);
        revision.setUint32(0, revision.getUint32(0) + 1);
        cursor.update(stored);
      };
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(new Error('Cannot tamper with fixture record'));
    });
  } finally {
    db.close();
  }
}
