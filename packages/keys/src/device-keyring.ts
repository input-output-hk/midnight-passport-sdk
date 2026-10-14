import { x25519 } from '@noble/curves/ed25519.js';
import { jubjub } from '@noble/curves/misc.js';
import type {
  AccountKeyring,
  AccountKeys,
  AccountViewingKey,
  CreateAccountKeys,
  DeviceDelivery,
  DeviceReader,
  LiveDeviceReader,
  PrfKeySource,
} from '@input-output-hk/mn-passport-account/ports';
import {
  openDeviceEnvelope,
  openDeviceRegistration,
  sealDeviceEnvelope,
  sealDeviceRegistration,
  type AccountSecrets,
} from './device-envelope.js';
import { READER_SECRET_DOMAIN } from './lace-recipe.js';

const KEY_LENGTH = 32;
const MAX_ENVELOPES = 4096;
const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const fromHex = (value: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('device keys must be 32-byte lowercase hex');
  return Uint8Array.from(value.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16));
};
const zero = ({ secret, rosterKey }: AccountSecrets): void => {
  secret.fill(0);
  rosterKey.fill(0);
};

/** Reject malformed keys before sealing an account secret to a joining device. */
const validReader = (reader: DeviceReader): void => {
  const readKey = fromHex(reader.readerPublicKey);
  const deviceKey = fromHex(reader.devicePublicKey);
  jubjub.Point.fromBytes(deviceKey);
  // noble refuses small-order X25519 public keys rather than agreeing an all-zero shared secret.
  x25519.getSharedSecret(new Uint8Array(KEY_LENGTH).fill(1), readKey);
};

/** The exposed methods that operate on device deliveries; other view operations join later. */
export type DeviceKeyring = Pick<
  AccountViewingKey,
  'readerPublicKey' | 'createKeys' | 'sealToDevice'
>;

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

  const withKeyring = async <T>(
    readerSecret: Uint8Array,
    { encKey, envelopes }: AccountKeyring,
    use: (secrets: AccountSecrets) => Promise<T>,
  ): Promise<T> => {
    if (encKey.length !== KEY_LENGTH) throw new Error('ACC enc_key must be 32 bytes');
    if (envelopes.length > MAX_ENVELOPES) throw new Error('too many device envelopes');
    let live: AccountSecrets | undefined;
    try {
      // Envelopes are newest first. The oldest matching envelope is the original delivery, before
      // a later party could append another envelope carrying the same secret with a false roster.
      for (const entry of envelopes) {
        const opened = await openDeviceEnvelope(readerSecret, entry);
        if (!opened) continue;
        let matches = false;
        try {
          matches = hex(x25519.getPublicKey(opened.secret)) === hex(encKey);
        } catch {
          // A valid envelope may still carry a malformed secret; it is not a ledger key match.
        }
        if (!matches) {
          zero(opened);
          continue;
        }
        if (live) zero(live);
        live = opened;
      }
      if (!live) throw new Error('EncryptionKeyMismatch: no envelope opens the ledger enc_key');
      return await use(live);
    } finally {
      if (live) zero(live);
    }
  };

  const create = async (
    self: DeviceReader,
    readers: readonly LiveDeviceReader[],
    rosterKey?: Uint8Array,
  ): Promise<AccountKeys> => {
    const secrets: AccountSecrets = {
      secret: x25519.utils.randomSecretKey(),
      rosterKey: rosterKey?.slice() ?? crypto.getRandomValues(new Uint8Array(KEY_LENGTH)),
    };
    try {
      const recipients = [self, ...readers];
      return {
        encKey: x25519.getPublicKey(secrets.secret),
        envelopes: await Promise.all(
          recipients.map((reader) => sealDeviceEnvelope(fromHex(reader.readerPublicKey), secrets)),
        ),
        registrations: rosterKey
          ? []
          : await Promise.all(
              recipients.map((reader) => sealDeviceRegistration(secrets.rosterKey, reader)),
            ),
      };
    } finally {
      zero(secrets);
    }
  };

  const createKeys = async (
    networkId: string,
    {
      devicePublicKey,
      keyring,
      registrations = [],
      readers = [],
      rotateRoster,
      removed,
    }: CreateAccountKeys,
  ): Promise<AccountKeys> =>
    onNetwork(networkId, async (readerSecret, readerPublicKey) => {
      const self: DeviceReader = {
        readerPublicKey: hex(readerPublicKey),
        devicePublicKey,
      };
      validReader(self);
      if (!keyring) {
        if (readers.length || registrations.length || rotateRoster || removed)
          throw new Error('an account without keys has no roster to rotate or seal to');
        return create(self, []);
      }
      if (removed && !rotateRoster)
        throw new Error('removing a device requires a fresh roster key');
      return withKeyring(readerSecret, keyring, async (live) => {
        const registered: DeviceReader[] = [];
        for (const entry of registrations) {
          const device = await openDeviceRegistration(live.rosterKey, entry);
          if (device) registered.push(device);
        }
        const pairs = new Set(
          registered.map(
            ({ readerPublicKey, devicePublicKey }) => `${readerPublicKey}:${devicePublicKey}`,
          ),
        );
        const removedReaders = new Set(
          registered
            .filter(({ devicePublicKey }) => devicePublicKey === removed?.devicePublicKey)
            .map(({ readerPublicKey }) => readerPublicKey),
        );
        const readerKeys = new Set([self.readerPublicKey]);
        const deviceKeys = new Set([self.devicePublicKey]);
        for (const reader of readers) {
          validReader(reader);
          if (
            !pairs.has(`${reader.readerPublicKey}:${reader.devicePublicKey}`) ||
            readerKeys.has(reader.readerPublicKey) ||
            deviceKeys.has(reader.devicePublicKey) ||
            reader.devicePublicKey === removed?.devicePublicKey ||
            removedReaders.has(reader.readerPublicKey)
          )
            throw new Error('the requested reader is not a unique live roster member');
          readerKeys.add(reader.readerPublicKey);
          deviceKeys.add(reader.devicePublicKey);
        }
        return create(self, readers, rotateRoster ? undefined : live.rosterKey);
      });
    });

  const sealToDevice = async (
    networkId: string,
    keyring: AccountKeyring,
    reader: LiveDeviceReader,
  ): Promise<DeviceDelivery> => {
    validReader(reader);
    return onNetwork(networkId, async (readerSecret) =>
      withKeyring(readerSecret, keyring, async (live) => ({
        envelope: await sealDeviceEnvelope(fromHex(reader.readerPublicKey), live),
        registration: await sealDeviceRegistration(live.rosterKey, reader),
      })),
    );
  };

  return {
    readerPublicKey: (networkId) => onNetwork(networkId, async (_secret, publicKey) => publicKey),
    createKeys,
    sealToDevice,
  };
}
