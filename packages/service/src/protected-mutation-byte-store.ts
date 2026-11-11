import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { fileMutationByteStore } from './mutation-store.js';

const DOMAIN = 'mn-passport:protected-mutation-bytes:v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PLAINTEXT_BYTES = 8 * 1024 * 1024;
const aad = (id: string, revision: number) => Buffer.from(JSON.stringify([DOMAIN, id, revision]));

function storeClosed(): never {
  throw new Error('Protected mutation byte store is unavailable.');
}

/** AES-GCM over private local POSIX CAS slots. Supply a dedicated 32-byte host key. */
export function protectedMutationByteStore(directory: string, key: Uint8Array) {
  if (key.length !== 32) throw new Error('Protected mutation storage requires a 32-byte key.');
  const secret = Buffer.from(key);
  const store = fileMutationByteStore(directory);
  let closed = false;
  return {
    close() {
      closed = true;
      secret.fill(0);
    },
    async read(id: string) {
      if (closed) return storeClosed();
      const slot = await store.read(id);
      if (closed) return storeClosed();
      if (!slot) return undefined;
      const { bytes, revision } = slot;
      if (bytes.length < IV_BYTES + TAG_BYTES) return storeClosed();
      const decipher = createDecipheriv('aes-256-gcm', secret, bytes.subarray(0, IV_BYTES));
      decipher.setAAD(aad(id, revision));
      decipher.setAuthTag(bytes.subarray(-TAG_BYTES));
      const partial = decipher.update(bytes.subarray(IV_BYTES, -TAG_BYTES));
      let final: Buffer | undefined;
      try {
        final = decipher.final();
        return { revision, bytes: Buffer.concat([partial, final]) };
      } finally {
        partial.fill(0);
        final?.fill(0);
      }
    },
    async compareAndSwap(
      id: string,
      expected: number | undefined,
      next: { readonly revision: number; readonly bytes: Uint8Array },
    ) {
      if (closed) return storeClosed();
      if (!/^[0-9a-f]{32}$/.test(id) || next.bytes.length > MAX_PLAINTEXT_BYTES)
        throw new Error('Invalid protected mutation byte-store slot.');
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', secret, iv);
      cipher.setAAD(aad(id, next.revision));
      const encrypted = Buffer.concat([
        iv,
        cipher.update(next.bytes),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      return store.compareAndSwap(id, expected, { revision: next.revision, bytes: encrypted });
    },
  };
}
