import { x25519 } from '@noble/curves/ed25519.js';
import type {
  AccountKeyring,
  AccountKeys,
  CreateAccountKeys,
  DeviceReader,
  LiveDeviceReader,
  ShieldedCoin,
  OpenedInboxEntry,
  GrantBookkeeping,
  GrantRecordPart,
} from '@input-output-hk/mn-passport-account/ports';
import {
  openDeviceEnvelope,
  openDeviceRegistration,
  sealDeviceEnvelope,
  sealDeviceRegistration,
  type AccountSecrets,
} from './device-envelope.js';
import { openInboxCoin, sealInboxCoin } from './inbox-coin.js';
import { openGrantRecord, sealGrantRecord } from './grant-record.js';
import { sealGrantView } from './grant-view-seal.js';
import { keyHex as hex, deviceKeyBytes as fromHex } from './device-keyring-inputs.js';
const KEY_LENGTH = 32;
const MAX_ENVELOPES = 4096;
const zero = ({ secret, rosterKey }: AccountSecrets): void => {
  secret.fill(0);
  rosterKey.fill(0);
};
export const withKeyring = async <T>(
  readerSecret: Uint8Array,
  { encKey, envelopes }: AccountKeyring,
  use: (opened: { live: AccountSecrets; all: readonly AccountSecrets[] }) => Promise<T>,
): Promise<T> => {
  if (encKey.length !== KEY_LENGTH) throw new Error('ACC enc_key must be 32 bytes');
  if (envelopes.length > MAX_ENVELOPES) throw new Error('too many device envelopes');
  let live: AccountSecrets | undefined;
  const earlier: AccountSecrets[] = [];
  const seen = new Set<string>();
  try {
    // Envelopes are newest first. The oldest matching envelope is the original delivery, before
    // a later party could append another envelope carrying the same secret with a false roster.
    for (const entry of envelopes) {
      const opened = await openDeviceEnvelope(readerSecret, entry);
      if (!opened) continue;
      let publicKeyHex: string;
      try {
        publicKeyHex = hex(x25519.getPublicKey(opened.secret));
      } catch {
        // A valid envelope may still carry a malformed secret; it is not a ledger key match.
        zero(opened);
        continue;
      }
      if (publicKeyHex !== hex(encKey)) {
        if (seen.has(publicKeyHex)) zero(opened);
        else {
          // Every candidate remains bounded by MAX_ENVELOPES. Anonymous earlier
          // envelopes neither authenticate metadata nor evict genuine old coin keys.
          seen.add(publicKeyHex);
          earlier.push(opened);
        }
        continue;
      }
      if (live) zero(live);
      live = opened;
    }
    if (!live) throw new Error('EncryptionKeyMismatch: no envelope opens the ledger enc_key');
    return await use({ live, all: [live, ...earlier] });
  } finally {
    if (live) zero(live);
    for (const old of earlier) zero(old);
  }
};

const create = async (
  self: DeviceReader,
  readers: readonly LiveDeviceReader[],
  rosterKey?: Uint8Array,
): Promise<AccountKeys> => {
  const secrets: AccountSecrets = {
    secret: x25519.utils.randomSecretKey(),
    rosterKey: rosterKey
      ? Uint8Array.from(rosterKey)
      : crypto.getRandomValues(new Uint8Array(KEY_LENGTH)),
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

export const createKeyringKeys = async (
  readerSecret: Uint8Array,
  readerPublicKey: Uint8Array,
  {
    devicePublicKey,
    scheme,
    policy,
    keyring,
    registrations = [],
    readers = [],
    rotateRoster,
    removed,
  }: CreateAccountKeys,
): Promise<AccountKeys> => {
  const self: DeviceReader = {
    readerPublicKey: hex(readerPublicKey),
    devicePublicKey,
    ...(scheme && { scheme }),
    ...(policy && { policy }),
  };
  if (!keyring) {
    if (readers.length || registrations.length || rotateRoster || removed)
      throw new Error('an account without keys has no roster to rotate or seal to');
    return create(self, []);
  }
  if (removed && !rotateRoster) throw new Error('removing a device requires a fresh roster key');
  return withKeyring(readerSecret, keyring, async ({ live }) => {
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
};

export const openCoin = async (
  secrets: readonly AccountSecrets[],
  entry: Uint8Array,
): Promise<ShieldedCoin | null> => {
  for (const { secret } of secrets) {
    const coin = await openInboxCoin(secret, entry);
    if (coin) return coin;
  }
  return null;
};

export async function reencryptKeyringCoins(
  secrets: readonly AccountSecrets[],
  to: Uint8Array,
  entries: readonly Uint8Array[],
): Promise<(Uint8Array | null)[]> {
  const sealed: (Uint8Array | null)[] = [];
  for (const entry of entries) {
    const coin = await openCoin(secrets, entry);
    if (!coin) {
      sealed.push(null);
      continue;
    }
    try {
      sealed.push(await sealInboxCoin(to, coin));
    } finally {
      coin.nonce.fill(0);
      coin.color.fill(0);
    }
  }
  return sealed;
}
export async function openKeyringInbox(
  readerSecret: Uint8Array,
  account: string,
  live: AccountSecrets,
  all: readonly AccountSecrets[],
  entries: readonly Uint8Array[],
): Promise<(OpenedInboxEntry | null)[]> {
  const opened: (OpenedInboxEntry | null)[] = [];
  for (const entry of entries) {
    const device = await openDeviceRegistration(live.rosterKey, entry);
    if (device) {
      opened.push({ kind: 'device', device });
      continue;
    }
    const record = await openGrantRecord(readerSecret, account, entry);
    if (record) {
      opened.push({ kind: 'grant', record });
      continue;
    }
    const coin = await openCoin(all, entry);
    opened.push(coin ? { kind: 'coin', coin } : null);
  }
  return opened;
}
export async function sealKeyringGrant(
  readerSecret: Uint8Array,
  account: string,
  grant: GrantBookkeeping,
): Promise<Uint8Array[]> {
  const { object, ...fields } = grant;
  const parts: GrantRecordPart[] = [
    { part: 'grant', ...fields },
    { part: 'object', grantId: grant.grantId, object },
  ];
  const entries: Uint8Array[] = [];
  for (const part of parts) entries.push(await sealGrantRecord(readerSecret, account, part));
  return entries;
}
export async function sealKeyringView(
  readerSecret: Uint8Array,
  live: AccountSecrets,
  keyring: AccountKeyring,
  request: { readonly grantId: string; readonly account: string; readonly readPublicKey: string },
) {
  if (request.account !== keyring.account)
    throw new Error('read grant account does not match the keyring');
  const seal = await sealGrantView(live.secret, request);
  return {
    seal,
    entry: await sealGrantRecord(readerSecret, request.account, {
      part: 'view',
      grantId: request.grantId,
      encKeyPrefix: hex(keyring.encKey.subarray(0, 3)),
      seal: hex(seal),
    }),
  };
}
