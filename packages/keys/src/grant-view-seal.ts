// Scoped-grant v1: a 94-byte container delivering the current ACC viewing secret to a grantee.
import { x25519 } from '@noble/curves/ed25519.js';

export const GRANT_VIEW_SEAL_LENGTH = 94;
const KEY_LENGTH = 32;
const NONCE_LENGTH = 12;
const INFO = new TextEncoder().encode('midnight:account:grant:view:v1');

const bytes = (value: string): Uint8Array => {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('expected 32-byte lowercase hex');
  return Uint8Array.from(value.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16));
};
const concat = (...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};
const wrappingKey = async (shared: Uint8Array, grantId: Uint8Array): Promise<CryptoKey> => {
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
        info: concat(INFO, grantId),
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'],
    );
  } finally {
    shared.fill(0);
  }
};

/** Seal the current ACC secret to a read-grant recipient, bound to grant id and account. */
export async function sealGrantView(
  accountSecret: Uint8Array,
  request: { readonly grantId: string; readonly account: string; readonly readPublicKey: string },
): Promise<Uint8Array> {
  if (accountSecret.length !== KEY_LENGTH) throw new Error('ACC secret must be 32 bytes');
  const grantId = bytes(request.grantId);
  const account = bytes(request.account);
  const readKey = bytes(request.readPublicKey);
  const seal = new Uint8Array(GRANT_VIEW_SEAL_LENGTH);
  seal[0] = 1;
  seal[1] = 1;
  const ephemeral = x25519.keygen();
  seal.set(ephemeral.publicKey, 2);
  try {
    const key = await wrappingKey(x25519.getSharedSecret(ephemeral.secretKey, readKey), grantId);
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: nonce,
          additionalData: concat(seal.subarray(0, 34), grantId, account),
          tagLength: 128,
        },
        key,
        accountSecret as Uint8Array<ArrayBuffer>,
      ),
    );
    seal.set(nonce, 34);
    seal.set(sealed.subarray(32), 46);
    seal.set(sealed.subarray(0, 32), 62);
    return seal;
  } finally {
    ephemeral.secretKey.fill(0);
  }
}
