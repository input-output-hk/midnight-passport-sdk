import type { GrantRecoveryJournal, StagedJubjubGrant } from '@input-output-hk/mn-passport-account';
import type { AccountRecordStore, PrfKeySource } from '@input-output-hk/mn-passport-account/ports';

interface StoragePort {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const HEX32 = /^[0-9a-f]{64}$/;
const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const bytes = (value: string): Uint8Array =>
  Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const encode = (value: Uint8Array): string => btoa(String.fromCharCode(...value));
const decode = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
const buffer = (value: Uint8Array): ArrayBuffer => Uint8Array.from(value).buffer;

interface SealedOpening {
  readonly version: 1 | 2;
  readonly state: 'pending' | 'published';
  readonly iv: string;
  readonly ciphertext: string;
}

/** Browser-local encrypted write-ahead journal. A failed storage write aborts issue before submit. */
export function browserGrantJournal(
  networkId: string,
  prf: PrfKeySource,
  storage: StoragePort = localStorage,
): GrantRecoveryJournal & {
  readReadPublicKey(account: string, grantId: string): Promise<string | undefined>;
} {
  const prefix = `mn-passport:grant-journal:v1:${networkId}:`;
  const name = (account: string, grantId: string): string => {
    if (!HEX32.test(account) || !HEX32.test(grantId)) throw new Error('Invalid grant journal key.');
    return `${prefix}${account}:${grantId}`;
  };
  const read = (account: string, grantId: string): SealedOpening | undefined => {
    const raw = storage.getItem(name(account, grantId));
    if (raw === null) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('The grant journal is corrupt.');
    }
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      ![1, 2].includes((value as SealedOpening).version) ||
      !['pending', 'published'].includes((value as SealedOpening).state) ||
      typeof (value as SealedOpening).iv !== 'string' ||
      typeof (value as SealedOpening).ciphertext !== 'string'
    )
      throw new Error('The grant journal is corrupt.');
    return value as SealedOpening;
  };
  const withKey = async <T>(account: string, work: (key: CryptoKey) => Promise<T>): Promise<T> => {
    const raw = await prf.deriveSecret({
      domain: 'mn-passport-demo:grant-journal:v1',
      context: `${networkId}:${account}`,
      length: 32,
    });
    try {
      if (raw.length !== 32) throw new Error('The grant-journal key is invalid.');
      const key = await crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, [
        'encrypt',
        'decrypt',
      ]);
      return await work(key);
    } finally {
      raw.fill(0);
    }
  };
  const aad = (account: string, grantId: string, sealed?: SealedOpening): Uint8Array =>
    new TextEncoder().encode(
      sealed?.version === 2
        ? JSON.stringify([name(account, grantId), 2, sealed.state])
        : name(account, grantId),
    );
  const open = async (
    account: string,
    grantId: string,
    sealed: SealedOpening,
  ): Promise<StagedJubjubGrant> => {
    return withKey(account, async (key) => {
      let plain: ArrayBuffer;
      try {
        plain = await crypto.subtle.decrypt(
          {
            name: 'AES-GCM',
            iv: buffer(decode(sealed.iv)),
            additionalData: buffer(aad(account, grantId, sealed)),
          },
          key,
          buffer(decode(sealed.ciphertext)),
        );
      } catch {
        throw new Error('The grant opening could not be unlocked with this passkey.');
      }
      let value: unknown;
      try {
        value = JSON.parse(new TextDecoder().decode(plain));
      } catch {
        throw new Error('The grant opening is corrupt.');
      }
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        (value as StagedJubjubGrant).account !== account ||
        (value as StagedJubjubGrant).bookkeeping?.grantId !== grantId
      )
        throw new Error('The grant opening does not match its ACC and ID.');
      return value as StagedJubjubGrant;
    });
  };
  const load = async (account: string, grantId: string): Promise<StagedJubjubGrant | undefined> => {
    const sealed = read(account, grantId);
    return sealed ? open(account, grantId, sealed) : undefined;
  };
  const save = async (grant: StagedJubjubGrant, state: SealedOpening['state']): Promise<void> => {
    const account = grant.account;
    const grantId = grant.bookkeeping.grantId;
    const sealed: SealedOpening = {
      version: 2,
      state,
      iv: encode(crypto.getRandomValues(new Uint8Array(12))),
      ciphertext: '',
    };
    const ciphertext = await withKey(
      account,
      async (key) =>
        new Uint8Array(
          await crypto.subtle.encrypt(
            {
              name: 'AES-GCM',
              iv: buffer(decode(sealed.iv)),
              additionalData: buffer(aad(account, grantId, sealed)),
            },
            key,
            buffer(new TextEncoder().encode(JSON.stringify(grant))),
          ),
        ),
    );
    storage.setItem(
      name(account, grantId),
      JSON.stringify({ ...sealed, ciphertext: encode(ciphertext) }),
    );
  };
  return {
    async stage(grant) {
      if (read(grant.account, grant.bookkeeping.grantId))
        throw new Error('A staged grant opening already exists.');
      await save(grant, 'pending');
    },
    load,
    async pending(account) {
      if (!HEX32.test(account)) throw new Error('Invalid grant journal account.');
      const keys: string[] = [];
      for (let index = 0; index < storage.length; index++) {
        const item = storage.key(index);
        if (item?.startsWith(`${prefix}${account}:`)) keys.push(item);
      }
      const pending: string[] = [];
      for (const item of keys) {
        const grantId = item.slice(`${prefix}${account}:`.length);
        const sealed = read(account, grantId);
        if (!sealed) continue;
        // Authenticate before filtering. Legacy status was not authenticated, so every
        // valid v1 opening is rechecked against the chain and upgraded on publication.
        await open(account, grantId, sealed);
        if (sealed.version === 1 || sealed.state === 'pending') pending.push(grantId);
      }
      return pending.sort();
    },
    async markPublished(account, grantId) {
      const sealed = read(account, grantId);
      if (!sealed) throw new Error('The staged grant opening is absent.');
      await save(await open(account, grantId, sealed), 'published');
    },
    async readReadPublicKey(account, grantId) {
      const staged = await load(account, grantId);
      return staged?.bookkeeping.readPublicKey;
    },
  };
}

/** A single-profile public device hint; account ownership is still checked against the chain. */
export function browserAccountRecords(
  networkId: string,
  storage: StoragePort = localStorage,
): AccountRecordStore {
  const key = `mn-passport:account-record:v1:${networkId}`;
  const read: AccountRecordStore['read'] = async () => {
    const raw = storage.getItem(key);
    if (!raw) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('The local account record is corrupt.');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('The local account record is corrupt.');
    const entry = value as Record<string, unknown>;
    if (
      typeof entry.address !== 'string' ||
      !HEX32.test(entry.address) ||
      entry.bindingId !== 'acc-s3r1.1' ||
      (entry.scheme !== 'p256-webauthn' && entry.scheme !== 'jubjub-schnorr') ||
      typeof entry.localUseCounter !== 'string' ||
      !/^\d+$/.test(entry.localUseCounter) ||
      (entry.credentialId !== undefined &&
        (typeof entry.credentialId !== 'string' || !/^[0-9a-f]+$/.test(entry.credentialId)))
    )
      throw new Error('The local account record is corrupt.');
    return {
      address: entry.address,
      bindingId: entry.bindingId,
      scheme: entry.scheme,
      localUseCounter: BigInt(entry.localUseCounter),
      ...(typeof entry.credentialId === 'string' && { credentialId: bytes(entry.credentialId) }),
    };
  };
  return {
    read,
    async write(record) {
      if (!HEX32.test(record.address) || record.bindingId !== 'acc-s3r1.1')
        throw new Error('Invalid local account record.');
      storage.setItem(
        key,
        JSON.stringify({
          address: record.address,
          bindingId: record.bindingId,
          scheme: record.scheme,
          localUseCounter: record.localUseCounter.toString(),
          ...(record.credentialId && { credentialId: hex(record.credentialId) }),
        }),
      );
    },
    exists: async () => (await read()) !== undefined,
  };
}
