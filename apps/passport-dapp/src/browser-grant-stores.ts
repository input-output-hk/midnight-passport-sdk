import {
  createBrowserGrantNonceStore,
  createP256GranteeIssueFence,
  createP256GranteeIssueJournal,
} from '@input-output-hk/mn-passport-account';
import { SecretStoreError } from '@input-output-hk/mn-passport-account/secret-store';
import {
  AccountAddressSchema,
  NetworkIdSchema,
} from '@input-output-hk/mn-passport-account/validation';
import type { PrfKeySource } from '@input-output-hk/mn-passport-account/ports';
import { createBrowserSecretStore } from '@input-output-hk/mn-passport-adapter-browser/secret-store';
import { browserGrantStorageSlots } from './browser-grant-storage-slots.js';

const DOMAIN = 'mn-passport-demo:p256-grant-openings:v1';
const BINDING = 'acc-s3r1.1';

function storageScope(networkId: string, account: string) {
  return {
    networkId: NetworkIdSchema.parse(networkId),
    account: AccountAddressSchema.parse(account),
    bindingId: BINDING,
  };
}

/** Use only in an already authenticated owner scope. This helper makes no credential request. */
export async function deriveDemoGrantOpeningKey(
  prf: PrfKeySource,
  networkId: string,
  account: string,
): Promise<CryptoKey> {
  const scope = storageScope(networkId, account);
  const bytes = await prf.deriveSecret({
    domain: DOMAIN,
    context: JSON.stringify([scope.networkId, scope.bindingId, scope.account]),
    length: 32,
  });
  try {
    if (bytes.length !== 32) throw new SecretStoreError('InvalidInput');
    const owned = new Uint8Array(bytes);
    try {
      return await crypto.subtle.importKey('raw', owned, 'AES-GCM', false, ['encrypt', 'decrypt']);
    } finally {
      owned.fill(0);
    }
  } finally {
    bytes.fill(0);
  }
}

export async function createDemoBrowserGrantStores(options: {
  readonly indexedDB: IDBFactory;
  readonly networkId: string;
  readonly account: string;
  readonly openingKey: CryptoKey;
}) {
  const scope = storageScope(options.networkId, options.account);
  const key = options.openingKey;
  if (
    key.type !== 'secret' ||
    key.extractable ||
    key.algorithm.name !== 'AES-GCM' ||
    (key.algorithm as AesKeyAlgorithm).length !== 256 ||
    !key.usages.includes('encrypt') ||
    !key.usages.includes('decrypt')
  )
    throw new SecretStoreError('InvalidInput');
  const open = (databaseName: string) =>
    createBrowserSecretStore({
      indexedDB: options.indexedDB,
      databaseName,
      allowPlaintext: true,
      strictWrites: true,
    });
  const markers = await open('mn-passport-demo:browser-grant-markers-v1');
  try {
    const openings = await open('mn-passport-demo:browser-grant-openings-v1');
    const nonces = createBrowserGrantNonceStore(
      browserGrantStorageSlots(markers, {
        ...scope,
        networkId: scope.networkId.replace(/^midnight:/, ''),
        account: '00'.repeat(32),
        namespace: 'grant-nonces',
      }),
      () => crypto.randomUUID(),
    );
    const fence = createP256GranteeIssueFence(
      browserGrantStorageSlots(markers, { ...scope, namespace: 'grant-issue-fence' }),
    );
    const journal = createP256GranteeIssueJournal(
      browserGrantStorageSlots(openings, { ...scope, namespace: 'grant-issue-opening' }, key),
    );
    return {
      nonces,
      fence,
      journal,
      close() {
        openings.close();
        markers.close();
      },
    };
  } catch (error) {
    markers.close();
    throw error;
  }
}
