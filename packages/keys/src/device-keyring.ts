import { ownedEntries, ownedKey } from './key-input-bytes.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { jubjub } from '@noble/curves/misc.js';
import { p256 } from '@noble/curves/nist.js';
import type {
  AccountViewingKey,
  AccountKeyring,
  PrfKeySource,
  ShieldedCoin,
  CurvePoint,
} from '@input-output-hk/mn-passport-account/ports';
import { sealDeviceEnvelope, sealDeviceRegistration } from './device-envelope.js';
import { READER_SECRET_DOMAIN } from './lace-recipe.js';
import {
  keyHex as hex,
  deviceKeyBytes as fromHex,
  ownedCreation,
  ownedReader,
  ownedKeyring,
  ownedGrant,
  ownedView,
  grantHex,
} from './device-keyring-inputs.js';
import {
  withKeyring,
  createKeyringKeys,
  openCoin,
  reencryptKeyringCoins,
  openKeyringInbox,
  sealKeyringGrant,
  sealKeyringView,
} from './device-keyring-material.js';
const KEY_LENGTH = 32;
/** A roster key is untrusted until it decodes as a JubJub point. */
const decodeDevicePublicKey = (compressedHex: string): CurvePoint | undefined => {
  try {
    return jubjub.Point.fromBytes(fromHex(compressedHex)).toAffine();
  } catch {
    return undefined;
  }
};
const decodeP256DevicePublicKey: NonNullable<AccountViewingKey['decodeP256DevicePublicKey']> = (
  compressedHex,
) => {
  try {
    if (!/^(02|03)[0-9a-f]{64}$/.test(compressedHex)) return undefined;
    const point = p256.Point.fromHex(compressedHex);
    if (hex(point.toBytes(true)) !== compressedHex) return undefined;
    return { ...point.toAffine(), identity: false };
  } catch {
    return undefined;
  }
};

/** Full viewing-key port plus focused coin methods for callers that need only coin entries. */
export interface DeviceKeyring extends AccountViewingKey {
  /** Open coin descriptions with the live and bounded earlier envelope secrets. */
  openCoins(
    networkId: string,
    keyring: AccountKeyring,
    entries: readonly Uint8Array[],
  ): Promise<(ShieldedCoin | null)[]>;
  /** Reseal opened coins to a new public enc_key; return null for non-coin entries. */
  reencryptCoins(
    networkId: string,
    rotation: { readonly keyring: AccountKeyring; readonly to: Uint8Array },
    entries: readonly Uint8Array[],
  ): Promise<(Uint8Array | null)[]>;
}

/**
 * Lace-compatible account-key creation and delivery over a passkey source. A random ACC secret
 * and roster key exist only during each operation; no method returns them to the account flow.
 * The account flow must validate a joining reader's device entry against the ledger before calling
 * `sealToDevice`, and resolve rotation readers to unique live ledger entries before `createKeys`.
 */
export function recipeDeviceKeyring(source: PrfKeySource): DeviceKeyring {
  const onNetwork = <T>(
    networkId: string,
    use: (secret: Uint8Array, publicKey: Uint8Array) => Promise<T>,
  ): Promise<T> =>
    source.withSession(async () => {
      const secret = await source.deriveSecret({
        domain: READER_SECRET_DOMAIN,
        context: networkId,
        length: KEY_LENGTH,
      });
      try {
        if (secret.length !== KEY_LENGTH) throw new Error('reader secret must be 32 bytes');
        return await use(secret, x25519.getPublicKey(secret));
      } finally {
        secret.fill(0);
      }
    });

  const createKeys: DeviceKeyring['createKeys'] = async (networkId, request) => {
    const owned = ownedCreation(request);
    return onNetwork(networkId, (secret, publicKey) => createKeyringKeys(secret, publicKey, owned));
  };
  const sealToDevice: DeviceKeyring['sealToDevice'] = async (networkId, keyring, reader) => {
    const recipient = ownedReader(reader),
      ring = ownedKeyring(keyring);
    return onNetwork(networkId, (secret) =>
      withKeyring(secret, ring, async ({ live }) => ({
        envelope: await sealDeviceEnvelope(fromHex(recipient.readerPublicKey), live),
        registration: await sealDeviceRegistration(live.rosterKey, recipient),
      })),
    );
  };
  const openCoins: DeviceKeyring['openCoins'] = (networkId, keyring, entries) => {
    const owned = ownedEntries(entries, 'too many inbox entries');
    try {
      const ring = ownedKeyring(keyring);
      return onNetwork(networkId, (secret) =>
        withKeyring(secret, ring, async ({ all }) => {
          const coins: (ShieldedCoin | null)[] = [];
          for (const entry of owned) coins.push(await openCoin(all, entry));
          return coins;
        }),
      );
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const reencryptCoins: DeviceKeyring['reencryptCoins'] = (networkId, rotation, entries) => {
    const owned = ownedEntries(entries, 'too many inbox entries');
    const to = ownedKey(rotation.to, 'new ACC enc_key must be 32 bytes');
    try {
      const ring = ownedKeyring(rotation.keyring);
      return onNetwork(networkId, (secret) =>
        withKeyring(secret, ring, ({ all }) => reencryptKeyringCoins(all, to, owned)),
      );
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const openInbox: DeviceKeyring['openInbox'] = (networkId, keyring, entries) => {
    const owned = ownedEntries(entries, 'too many inbox entries');
    try {
      const ring = ownedKeyring(keyring);
      return onNetwork(networkId, (secret) =>
        withKeyring(secret, ring, ({ live, all }) =>
          openKeyringInbox(secret, ring.account, live, all, owned),
        ),
      );
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const sealGrant: DeviceKeyring['sealGrant'] = async (networkId, account, grant) => {
    const owned = ownedGrant(grant);
    grantHex(account);
    return onNetwork(networkId, (secret) => sealKeyringGrant(secret, account, owned));
  };
  const sealView: NonNullable<DeviceKeyring['sealView']> = async (networkId, keyring, request) => {
    const owned = ownedView(request),
      ring = ownedKeyring(keyring);
    return onNetwork(networkId, (secret) =>
      withKeyring(secret, ring, ({ live }) => sealKeyringView(secret, live, ring, owned)),
    );
  };
  return {
    decodeDevicePublicKey,
    decodeP256DevicePublicKey,
    readerPublicKey: (networkId) => onNetwork(networkId, async (_secret, publicKey) => publicKey),
    createKeys,
    sealToDevice,
    openCoins,
    reencryptCoins,
    openInbox,
    sealGrant,
    reencryptInbox: reencryptCoins,
    sealView,
  };
}
