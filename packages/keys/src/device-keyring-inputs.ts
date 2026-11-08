import { inputByteLength, ownedKey, ownedEntries } from './key-input-bytes.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { jubjub } from '@noble/curves/misc.js';
import { p256 } from '@noble/curves/nist.js';
import type {
  AccountKeyring,
  CreateAccountKeys,
  DeviceReader,
  GrantBookkeeping,
  LiveDeviceReader,
} from '@input-output-hk/mn-passport-account/ports';

export const keyHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
export const deviceKeyBytes = (value: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('device keys must be 32-byte lowercase hex');
  return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) => Number.parseInt(pair, 16));
};
export function ownedKeyring(keyring: AccountKeyring): AccountKeyring {
  return {
    account: keyring.account,
    encKey: ownedKey(keyring.encKey, 'ACC enc_key must be 32 bytes'),
    envelopes: ownedEntries(keyring.envelopes, 'too many device envelopes'),
  };
}

/** Reject malformed identities before opening the selected credential scope. */
function ownedIdentity(reader: {
  readonly devicePublicKey: string;
  readonly scheme?: DeviceReader['scheme'];
  readonly policy?: DeviceReader['policy'];
}): Omit<DeviceReader, 'readerPublicKey'> {
  const { devicePublicKey, scheme, policy } = reader;
  if (scheme && scheme !== 'jubjub-schnorr' && scheme !== 'p256-webauthn')
    throw new Error('unsupported device registration scheme');
  if (policy && scheme !== 'p256-webauthn')
    throw new Error('only P-256 registrations carry WebAuthn policy');
  if (scheme === 'p256-webauthn') {
    if (!/^(02|03)[0-9a-f]{64}$/.test(devicePublicKey))
      throw new Error('P-256 device key must be canonical compressed SEC1 hex');
    if (keyHex(p256.Point.fromHex(devicePublicKey).toBytes(true)) !== devicePublicKey)
      throw new Error('P-256 device key is not canonical');
  } else jubjub.Point.fromBytes(deviceKeyBytes(devicePublicKey));
  const rpIdHash = policy?.rp_id_hash,
    origin = policy?.origin;
  if (
    policy &&
    (!rpIdHash || !origin || inputByteLength(rpIdHash) !== 32 || inputByteLength(origin) !== 21)
  )
    throw new Error('P-256 registration policy must be 32-byte RP hash and 21-byte origin');
  return {
    devicePublicKey,
    ...(scheme && { scheme }),
    ...(rpIdHash &&
      origin && {
        policy: {
          rp_id_hash: new Uint8Array(rpIdHash),
          origin: new Uint8Array(origin),
        },
      }),
  };
}
export function ownedReader(reader: LiveDeviceReader): LiveDeviceReader {
  const readerPublicKey = reader.readerPublicKey;
  const readKey = deviceKeyBytes(readerPublicKey);
  const identity = ownedIdentity(reader);
  x25519.getSharedSecret(new Uint8Array(32).fill(1), readKey);
  return { ...identity, readerPublicKey, epoch: reader.epoch, counter: reader.counter };
}
function ownedReaders(readers: readonly LiveDeviceReader[]): LiveDeviceReader[] {
  const count = readers.length;
  if (!Number.isSafeInteger(count) || count < 0 || count > 4096)
    throw new Error('too many device readers');
  const owned: LiveDeviceReader[] = [];
  for (let index = 0; index < count; index++) {
    const reader = readers[index];
    if (!reader) throw new Error('the requested reader is not a unique live roster member');
    owned.push(ownedReader(reader));
  }
  return owned;
}
export function ownedCreation(request: CreateAccountKeys): CreateAccountKeys {
  const identity = ownedIdentity(request);
  const { keyring, registrations, readers, rotateRoster, removed } = request;
  return {
    ...identity,
    ...(keyring && { keyring: ownedKeyring(keyring) }),
    ...(registrations && {
      registrations: ownedEntries(registrations, 'too many device registrations'),
    }),
    ...(readers && { readers: ownedReaders(readers) }),
    ...(rotateRoster !== undefined && { rotateRoster }),
    ...(removed && {
      removed: {
        devicePublicKey: removed.devicePublicKey,
        epoch: removed.epoch,
        counter: removed.counter,
      },
    }),
  };
}

export const grantHex = (value: string): string => {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('expected 32-byte lowercase hex');
  return value;
};
export function ownedView(request: {
  readonly grantId: string;
  readonly account: string;
  readonly readPublicKey: string;
}) {
  return {
    grantId: grantHex(request.grantId),
    account: grantHex(request.account),
    readPublicKey: grantHex(request.readPublicKey),
  };
}
export function ownedGrant(grant: GrantBookkeeping): GrantBookkeeping {
  const { grantId, slot, scopeSalt, granteePublicKey, readPublicKey, object } = grant;
  grantHex(grantId);
  if (!Number.isInteger(slot) || slot < 0 || slot > 255)
    throw new Error('grant slot must be an unsigned byte');
  grantHex(scopeSalt);
  grantHex(granteePublicKey);
  if (readPublicKey !== undefined) grantHex(readPublicKey);
  const color = grantHex(object.color);
  const { recipient, maxCoinValue } = object;
  const ownedRecipient =
    recipient.kind === 'any'
      ? { kind: recipient.kind }
      : { kind: recipient.kind, value: grantHex(recipient.value) };
  if (
    typeof maxCoinValue !== 'string' ||
    maxCoinValue.length === 0 ||
    maxCoinValue.length > 39 ||
    /[^0-9]/.test(maxCoinValue)
  )
    throw new Error('max coin value must be a uint128 decimal');
  if (BigInt(maxCoinValue) >= 1n << 128n) throw new Error('max coin value exceeds uint128');
  return {
    grantId,
    slot,
    scopeSalt,
    granteePublicKey,
    ...(readPublicKey !== undefined && { readPublicKey }),
    object: { color, recipient: ownedRecipient, maxCoinValue },
  };
}
