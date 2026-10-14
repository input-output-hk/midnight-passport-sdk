// Lace Passport grant bookkeeping records: one 192-byte encrypted inbox entry per record part.
// Kept internal to the key package until the complete AccountViewingKey port is assembled.
import { sha256 } from '@noble/hashes/sha2.js';
import type { GrantRecordPart } from '@input-output-hk/mn-passport-account/ports';

const ENTRY_LENGTH = 192;
const BODY_LENGTH = 130;
const KEY_LENGTH = 32;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const TYPE = 0xd3;
const SUITE = 1;
const RECORD_INFO = new TextEncoder().encode('lace:passport:grant-record:v1');
const TAG_INFO = new TextEncoder().encode('lace:passport:grant-record-tag:v1');
const RECIPIENT_KIND = {
  any: 0,
  'user-address': 1,
  'coin-public-key': 2,
  'contract-address': 3,
} as const;
const RECIPIENT_NAME = ['any', 'user-address', 'coin-public-key', 'contract-address'] as const;

const concat = (...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};
const bytes = (value: string, length = KEY_LENGTH): Uint8Array => {
  if (!new RegExp(`^[0-9a-f]{${length * 2}}$`).test(value))
    throw new Error(`expected ${length}-byte lowercase hex`);
  return Uint8Array.from(value.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16));
};
const hex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
const isZero = (value: Uint8Array): boolean => value.every((byte) => byte === 0);
const equal = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, index) => byte === right[index]);

const hkdf = async (
  readerSecret: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> => {
  const material = await crypto.subtle.importKey(
    'raw',
    readerSecret as Uint8Array<ArrayBuffer>,
    'HKDF',
    false,
    ['deriveBits'],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: info as Uint8Array<ArrayBuffer>,
      },
      material,
      length * 8,
    ),
  );
};
const aeadKey = async (readerSecret: Uint8Array, info: Uint8Array): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey(
    'raw',
    readerSecret as Uint8Array<ArrayBuffer>,
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
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};
const recordKeys = async (
  readerSecret: Uint8Array,
  account: string,
): Promise<{ key: CryptoKey; tagKey: Uint8Array }> => {
  if (readerSecret.length !== KEY_LENGTH) throw new Error('reader secret must be 32 bytes');
  const accountBytes = bytes(account);
  return {
    key: await aeadKey(readerSecret, concat(RECORD_INFO, accountBytes)),
    tagKey: await hkdf(readerSecret, concat(TAG_INFO, accountBytes), KEY_LENGTH),
  };
};

const encodePart = (part: GrantRecordPart): Uint8Array => {
  const plain = new Uint8Array(BODY_LENGTH);
  plain[0] = part.part === 'grant' ? 0 : part.part === 'object' ? 1 : 2;
  plain.set(bytes(part.grantId), 1);
  const body = 33;
  switch (part.part) {
    case 'grant':
      if (!Number.isInteger(part.slot) || part.slot < 0 || part.slot > 255)
        throw new Error('grant slot must be an unsigned byte');
      plain[body] = part.slot;
      plain.set(bytes(part.scopeSalt), body + 1);
      plain.set(bytes(part.granteePublicKey), body + 33);
      if (part.readPublicKey !== undefined) plain.set(bytes(part.readPublicKey), body + 65);
      break;
    case 'object': {
      plain.set(bytes(part.object.color), body);
      const recipient = part.object.recipient;
      plain[body + 32] = RECIPIENT_KIND[recipient.kind];
      if (recipient.kind !== 'any') plain.set(bytes(recipient.value), body + 33);
      const value = BigInt(part.object.maxCoinValue);
      if (value < 0n || value >= 1n << 128n) throw new Error('max coin value exceeds uint128');
      let rest = value;
      for (let offset = body + 80; offset >= body + 65; offset--) {
        plain[offset] = Number(rest & 255n);
        rest >>= 8n;
      }
      break;
    }
    case 'view':
      plain.set(bytes(part.encKeyPrefix, 3), body);
      plain.set(bytes(part.seal, 94), body + 3);
      break;
  }
  return plain;
};

const decodePart = (plain: Uint8Array): GrantRecordPart | null => {
  const grantId = hex(plain.subarray(1, 33));
  const body = plain.subarray(33);
  switch (plain[0]) {
    case 0: {
      const readPublicKey = body.subarray(65, 97);
      return {
        part: 'grant',
        grantId,
        slot: body[0]!,
        scopeSalt: hex(body.subarray(1, 33)),
        granteePublicKey: hex(body.subarray(33, 65)),
        ...(isZero(readPublicKey) ? {} : { readPublicKey: hex(readPublicKey) }),
      };
    }
    case 1: {
      const kind = RECIPIENT_NAME[body[32]!];
      const recipientBytes = body.subarray(33, 65);
      if (!kind || (kind === 'any' && !isZero(recipientBytes)) || !isZero(body.subarray(81)))
        return null;
      const value = body.subarray(65, 81).reduce((total, byte) => (total << 8n) | BigInt(byte), 0n);
      return {
        part: 'object',
        grantId,
        object: {
          color: hex(body.subarray(0, 32)),
          recipient: kind === 'any' ? { kind } : { kind, value: hex(recipientBytes) },
          maxCoinValue: value.toString(),
        },
      };
    }
    case 2:
      return {
        part: 'view',
        grantId,
        encKeyPrefix: hex(body.subarray(0, 3)),
        seal: hex(body.subarray(3, 97)),
      };
    default:
      return null;
  }
};

/** Seal a grant, object or view record to this reader and account. */
export async function sealGrantRecord(
  readerSecret: Uint8Array,
  account: string,
  part: GrantRecordPart,
): Promise<Uint8Array> {
  const { key, tagKey } = await recordKeys(readerSecret, account);
  let plain: Uint8Array | undefined;
  const entry = new Uint8Array(ENTRY_LENGTH);
  entry[0] = TYPE;
  entry[1] = SUITE;
  try {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
    entry.set(nonce, 34);
    plain = encodePart(part);
    entry.set(sha256(concat(tagKey, nonce)), 2);
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce, additionalData: entry.slice(0, 46), tagLength: 128 },
        key,
        plain as Uint8Array<ArrayBuffer>,
      ),
    );
    entry.set(sealed.subarray(BODY_LENGTH), 46);
    entry.set(sealed.subarray(0, BODY_LENGTH), 62);
    return entry;
  } finally {
    tagKey.fill(0);
    plain?.fill(0);
  }
}

/** Open a record addressed to this reader and account; arbitrary inbox noise returns null. */
export async function openGrantRecord(
  readerSecret: Uint8Array,
  account: string,
  entry: Uint8Array,
): Promise<GrantRecordPart | null> {
  if (entry.length !== ENTRY_LENGTH || entry[0] !== TYPE || entry[1] !== SUITE) return null;
  const { key, tagKey } = await recordKeys(readerSecret, account);
  try {
    if (!equal(entry.subarray(2, 34), sha256(concat(tagKey, entry.subarray(34, 46))))) return null;
  } finally {
    tagKey.fill(0);
  }
  try {
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: entry.slice(34, 46),
          additionalData: entry.slice(0, 46),
          tagLength: TAG_LENGTH * 8,
        },
        key,
        concat(entry.subarray(62), entry.subarray(46, 62)),
      ),
    );
    try {
      return decodePart(plain);
    } finally {
      plain.fill(0);
    }
  } catch {
    return null;
  }
}
