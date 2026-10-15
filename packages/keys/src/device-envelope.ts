// Lace Passport's 192-byte device envelope and registration wire format. This module is internal:
// callers of the public key port never receive the raw account or roster secrets it opens.
import { x25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { DeviceReader } from '@input-output-hk/mn-passport-account/ports';

const ENTRY_LENGTH = 192;
const KEY_LENGTH = 32;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const ENVELOPE_TYPE = 0xd1;
const REGISTRATION_TYPE = 0xd2;
const P256_REGISTRATION_TYPE = 0xd4;
const SUITE = 1;
const ENVELOPE_EPHEMERAL_OFFSET = 34;
const ENVELOPE_NONCE_OFFSET = 66;
const REGISTRATION_NONCE_OFFSET = 2;
const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);
const ENVELOPE_TAG_DOMAIN = utf8('lace:passport:envelope-tag:v1');
const ENVELOPE_KEY_INFO = utf8('lace:passport:device-envelope:v1');
const REGISTRATION_KEY_INFO = utf8('lace:passport:device-registration:v1');
const P256_REGISTRATION_KEY_INFO = utf8('mn-passport:device-registration:p256:v1');

export interface AccountSecrets {
  readonly secret: Uint8Array;
  readonly rosterKey: Uint8Array;
}

const concat = (...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const hexBytes = (hex: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('device keys must be 32-byte lowercase hex');
  return Uint8Array.from(hex.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16));
};
const p256Bytes = (value: string): Uint8Array => {
  if (!/^(02|03)[0-9a-f]{64}$/.test(value))
    throw new Error('P-256 device key must be canonical compressed SEC1 hex');
  const bytes = p256.Point.fromHex(value).toBytes(true);
  if (hex(bytes) !== value) throw new Error('P-256 device key is not canonical');
  return bytes;
};
const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const equal = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);
const recordOf = (entry: Uint8Array, type: number): boolean =>
  entry.length === ENTRY_LENGTH && entry[0] === type && entry[1] === SUITE;
const require32 = (bytes: Uint8Array, name: string): void => {
  if (bytes.length !== KEY_LENGTH) throw new Error(`${name} must be 32 bytes`);
};

const aeadKey = async (material: Uint8Array, info: Uint8Array): Promise<CryptoKey> => {
  const imported = await crypto.subtle.importKey(
    'raw',
    material as Uint8Array<ArrayBuffer>,
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: info as Uint8Array<ArrayBuffer>,
    },
    imported,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

const sealInto = async (
  entry: Uint8Array,
  nonceOffset: number,
  plaintext: Uint8Array,
  key: CryptoKey,
): Promise<void> => {
  const tagOffset = nonceOffset + NONCE_LENGTH;
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: entry.slice(nonceOffset, tagOffset),
        additionalData: entry.slice(0, tagOffset),
        tagLength: TAG_LENGTH * 8,
      },
      key,
      plaintext as Uint8Array<ArrayBuffer>,
    ),
  );
  entry.set(sealed.subarray(plaintext.length), tagOffset);
  entry.set(sealed.subarray(0, plaintext.length), tagOffset + TAG_LENGTH);
};

const openFrom = async (
  entry: Uint8Array,
  nonceOffset: number,
  plaintextLength: number,
  key: CryptoKey,
): Promise<Uint8Array | null> => {
  const tagOffset = nonceOffset + NONCE_LENGTH;
  const ciphertextOffset = tagOffset + TAG_LENGTH;
  if (entry.subarray(ciphertextOffset + plaintextLength).some((byte) => byte !== 0)) return null;
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: entry.slice(nonceOffset, tagOffset),
          additionalData: entry.slice(0, tagOffset),
          tagLength: TAG_LENGTH * 8,
        },
        key,
        concat(
          entry.subarray(ciphertextOffset, ciphertextOffset + plaintextLength),
          entry.subarray(tagOffset, ciphertextOffset),
        ),
      ),
    );
  } catch {
    return null;
  }
};

const recipientTag = (reader: Uint8Array, ephemeral: Uint8Array): Uint8Array =>
  sha256(concat(ENVELOPE_TAG_DOMAIN, reader, ephemeral));

/** A public tag check; a matching tag alone does not authenticate an envelope. */
export const isAddressedTo = (entry: Uint8Array, reader: Uint8Array): boolean =>
  recordOf(entry, ENVELOPE_TYPE) &&
  equal(entry.subarray(2, 34), recipientTag(reader, entry.subarray(34, 66)));

/** Seals the 32-byte account secret and roster key to a device's X25519 reader key. */
export async function sealDeviceEnvelope(
  reader: Uint8Array,
  { secret, rosterKey }: AccountSecrets,
): Promise<Uint8Array> {
  require32(reader, 'reader public key');
  require32(secret, 'account secret');
  require32(rosterKey, 'roster key');
  const ephemeral = x25519.keygen();
  const plaintext = concat(secret, rosterKey);
  const entry = new Uint8Array(ENTRY_LENGTH);
  entry[0] = ENVELOPE_TYPE;
  entry[1] = SUITE;
  entry.set(recipientTag(reader, ephemeral.publicKey), 2);
  entry.set(ephemeral.publicKey, ENVELOPE_EPHEMERAL_OFFSET);
  entry.set(crypto.getRandomValues(new Uint8Array(NONCE_LENGTH)), ENVELOPE_NONCE_OFFSET);
  try {
    const shared = x25519.getSharedSecret(ephemeral.secretKey, reader);
    let key: CryptoKey;
    try {
      key = await aeadKey(shared, ENVELOPE_KEY_INFO);
    } finally {
      shared.fill(0);
    }
    await sealInto(entry, ENVELOPE_NONCE_OFFSET, plaintext, key);
    return entry;
  } finally {
    ephemeral.secretKey.fill(0);
    plaintext.fill(0);
  }
}

/** Returns raw secrets only to the internal keyring worker; its caller must clear both arrays. */
export async function openDeviceEnvelope(
  readerSecret: Uint8Array,
  entry: Uint8Array,
): Promise<AccountSecrets | null> {
  require32(readerSecret, 'reader secret');
  if (!isAddressedTo(entry, x25519.getPublicKey(readerSecret))) return null;
  let key: CryptoKey;
  try {
    const shared = x25519.getSharedSecret(readerSecret, entry.slice(34, 66));
    try {
      key = await aeadKey(shared, ENVELOPE_KEY_INFO);
    } finally {
      shared.fill(0);
    }
  } catch {
    return null;
  }
  const plaintext = await openFrom(entry, ENVELOPE_NONCE_OFFSET, 64, key);
  if (!plaintext) return null;
  try {
    return { secret: plaintext.slice(0, 32), rosterKey: plaintext.slice(32) };
  } finally {
    plaintext.fill(0);
  }
}

/** Seals one reader/device pairing under the account roster key. */
export async function sealDeviceRegistration(
  rosterKey: Uint8Array,
  reader: DeviceReader,
): Promise<Uint8Array> {
  require32(rosterKey, 'roster key');
  if (reader.scheme && reader.scheme !== 'jubjub-schnorr' && reader.scheme !== 'p256-webauthn')
    throw new Error('unsupported device registration scheme');
  const isP256 = reader.scheme === 'p256-webauthn';
  const plaintext = concat(
    hexBytes(reader.readerPublicKey),
    isP256 ? p256Bytes(reader.devicePublicKey) : hexBytes(reader.devicePublicKey),
  );
  const entry = new Uint8Array(ENTRY_LENGTH);
  entry[0] = isP256 ? P256_REGISTRATION_TYPE : REGISTRATION_TYPE;
  entry[1] = SUITE;
  entry.set(crypto.getRandomValues(new Uint8Array(NONCE_LENGTH)), REGISTRATION_NONCE_OFFSET);
  try {
    await sealInto(
      entry,
      REGISTRATION_NONCE_OFFSET,
      plaintext,
      await aeadKey(rosterKey, isP256 ? P256_REGISTRATION_KEY_INFO : REGISTRATION_KEY_INFO),
    );
    return entry;
  } finally {
    plaintext.fill(0);
  }
}

/** Opens a pairing under the live roster key, or null for another or malformed entry. */
export async function openDeviceRegistration(
  rosterKey: Uint8Array,
  entry: Uint8Array,
): Promise<DeviceReader | null> {
  require32(rosterKey, 'roster key');
  const isP256 = recordOf(entry, P256_REGISTRATION_TYPE);
  if (!isP256 && !recordOf(entry, REGISTRATION_TYPE)) return null;
  const plaintext = await openFrom(
    entry,
    REGISTRATION_NONCE_OFFSET,
    isP256 ? 65 : 64,
    await aeadKey(rosterKey, isP256 ? P256_REGISTRATION_KEY_INFO : REGISTRATION_KEY_INFO),
  );
  if (!plaintext) return null;
  try {
    const devicePublicKey = hex(plaintext.subarray(32));
    if (isP256) {
      try {
        p256Bytes(devicePublicKey);
      } catch {
        return null;
      }
    }
    return {
      readerPublicKey: hex(plaintext.subarray(0, 32)),
      devicePublicKey,
      ...(isP256 && { scheme: 'p256-webauthn' as const }),
    };
  } finally {
    plaintext.fill(0);
  }
}
