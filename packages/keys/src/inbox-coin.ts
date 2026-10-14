// The Lace/Midnight 192-byte coin-description inbox format, kept internal until the full viewing
// key port is assembled. A sender needs only the public ACC enc_key; a reader needs its secret.
import { x25519 } from '@noble/curves/ed25519.js';
import type { ShieldedCoin } from '@input-output-hk/mn-passport-account/ports';

const ENTRY_LENGTH = 192;
const VERSION = 1;
const SUITE = 1;
const KEY_LENGTH = 32;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const COIN_LENGTH = 80;
const VALUE_LENGTH = 16;
const MAX_VALUE = (1n << 128n) - 1n;
const KEY_INFO = new TextEncoder().encode('midnight:custody:inbox:v1');

const wrappingKey = async (shared: Uint8Array): Promise<CryptoKey> => {
  try {
    const material = await crypto.subtle.importKey(
      'raw',
      shared as Uint8Array<ArrayBuffer>,
      'HKDF',
      false,
      ['deriveKey'],
    );
    return await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(0),
        info: KEY_INFO as Uint8Array<ArrayBuffer>,
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    shared.fill(0);
  }
};

const encodeCoin = ({ nonce, color, value }: ShieldedCoin): Uint8Array => {
  if (nonce.length !== KEY_LENGTH || color.length !== KEY_LENGTH)
    throw new Error('a coin needs a 32-byte nonce and colour');
  if (value < 0n || value > MAX_VALUE) throw new Error('a coin value must fit unsigned 128 bits');
  const plain = new Uint8Array(COIN_LENGTH);
  plain.set(nonce, 0);
  plain.set(color, KEY_LENGTH);
  let remaining = value;
  for (let offset = KEY_LENGTH * 2 + VALUE_LENGTH - 1; offset >= KEY_LENGTH * 2; offset--) {
    plain[offset] = Number(remaining & 255n);
    remaining >>= 8n;
  }
  return plain;
};

const decodeCoin = (plain: Uint8Array): ShieldedCoin => ({
  nonce: plain.slice(0, KEY_LENGTH),
  color: plain.slice(KEY_LENGTH, KEY_LENGTH * 2),
  value: plain.subarray(KEY_LENGTH * 2).reduce((value, byte) => (value << 8n) | BigInt(byte), 0n),
});

/** Seal one coin description to the ACC's X25519 public enc_key. */
export async function sealInboxCoin(encKey: Uint8Array, coin: ShieldedCoin): Promise<Uint8Array> {
  if (encKey.length !== KEY_LENGTH) throw new Error('ACC enc_key must be 32 bytes');
  const plain = encodeCoin(coin);
  let ephemeral: ReturnType<typeof x25519.keygen> | undefined;
  const entry = new Uint8Array(ENTRY_LENGTH);
  entry[0] = VERSION;
  entry[1] = SUITE;
  try {
    ephemeral = x25519.keygen();
    const key = await wrappingKey(x25519.getSharedSecret(ephemeral.secretKey, encKey));
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: nonce,
          additionalData: entry.slice(0, 2),
          tagLength: TAG_LENGTH * 8,
        },
        key,
        plain as Uint8Array<ArrayBuffer>,
      ),
    );
    entry.set(ephemeral.publicKey, 2);
    entry.set(nonce, 34);
    entry.set(sealed.subarray(COIN_LENGTH), 46);
    entry.set(sealed.subarray(0, COIN_LENGTH), 62);
    return entry;
  } finally {
    ephemeral?.secretKey.fill(0);
    plain.fill(0);
  }
}

/** Open one coin entry, or return null for an entry that is noise or addressed elsewhere. */
export async function openInboxCoin(
  encSecret: Uint8Array,
  entry: Uint8Array,
): Promise<ShieldedCoin | null> {
  if (encSecret.length !== KEY_LENGTH) throw new Error('ACC secret must be 32 bytes');
  if (entry.length !== ENTRY_LENGTH || entry[0] !== VERSION || entry[1] !== SUITE) return null;
  try {
    const key = await wrappingKey(x25519.getSharedSecret(encSecret, entry.slice(2, 34)));
    const sealed = new Uint8Array(COIN_LENGTH + TAG_LENGTH);
    sealed.set(entry.subarray(62, 62 + COIN_LENGTH));
    sealed.set(entry.subarray(46, 62), COIN_LENGTH);
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: entry.slice(34, 46),
          additionalData: entry.slice(0, 2),
          tagLength: TAG_LENGTH * 8,
        },
        key,
        sealed,
      ),
    );
    try {
      return decodeCoin(plain);
    } finally {
      plain.fill(0);
    }
  } catch {
    return null;
  }
}
