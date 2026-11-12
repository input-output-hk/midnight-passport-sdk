import type { MutationByteStore } from '@input-output-hk/mn-passport-account';
import {
  copySecretBytes,
  SECRET_BYTES_LIMIT,
  SecretStoreError,
  secretReferenceKey,
  type SecretReference,
  type SecretStore,
} from '@input-output-hk/mn-passport-account/secret-store';

const HEADER_BYTES = 4;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MAX_PAYLOAD = SECRET_BYTES_LIMIT - HEADER_BYTES - IV_BYTES - TAG_BYTES;
const MAX_REVISION = 0xffff_ffff;

function unavailable(): never {
  throw new SecretStoreError('Unavailable');
}

function data(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function associatedData(reference: SecretReference, revision: number) {
  return new TextEncoder().encode(
    JSON.stringify(['mn-passport-demo:grant-storage:v1', secretReferenceKey(reference), revision]),
  );
}

async function decodeSlot(reference: SecretReference, envelope: Uint8Array, key?: CryptoKey) {
  try {
    const revision = new DataView(data(envelope.subarray(0, HEADER_BYTES))).getUint32(0);
    const payload = envelope.subarray(HEADER_BYTES);
    if (!key) return { revision, bytes: payload.slice() };
    if (payload.length <= IV_BYTES + TAG_BYTES) return unavailable();
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: data(payload.subarray(0, IV_BYTES)),
        additionalData: data(associatedData(reference, revision)),
      },
      key,
      data(payload.subarray(IV_BYTES)),
    );
    return { revision, bytes: new Uint8Array(plaintext) };
  } catch {
    return unavailable();
  } finally {
    envelope.fill(0);
  }
}

async function encodeSlot(
  reference: SecretReference,
  revision: number,
  bytes: Uint8Array<ArrayBuffer>,
  key?: CryptoKey,
): Promise<Uint8Array> {
  if (!key) {
    const envelope = new Uint8Array(HEADER_BYTES + bytes.length);
    new DataView(envelope.buffer).setUint32(0, revision);
    envelope.set(bytes, HEADER_BYTES);
    return envelope;
  }
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: data(associatedData(reference, revision)) },
      key,
      bytes,
    ),
  );
  const envelope = new Uint8Array(HEADER_BYTES + IV_BYTES + ciphertext.length);
  new DataView(envelope.buffer).setUint32(0, revision);
  envelope.set(iv, HEADER_BYTES);
  envelope.set(ciphertext, HEADER_BYTES + IV_BYTES);
  return envelope;
}

/** Map numeric journal revisions onto the underlying store's atomic opaque versions. */
export function browserGrantStorageSlots(
  store: SecretStore,
  scope: Omit<SecretReference, 'id'>,
  key?: CryptoKey,
): MutationByteStore {
  const pinned = { ...scope };
  const ref = (id: string) => ({ ...pinned, id });
  return {
    async read(id) {
      const reference = ref(id);
      const stored = await store.read(reference);
      return stored && decodeSlot(reference, stored.bytes, key);
    },
    async compareAndSwap(id, expected, next) {
      const revision = next.revision;
      if (
        !Number.isSafeInteger(revision) ||
        revision !== (expected ?? -1) + 1 ||
        revision < 0 ||
        revision > MAX_REVISION
      )
        throw new SecretStoreError('InvalidInput');
      const reference = ref(id);
      const bytes = copySecretBytes(next.bytes);
      let envelope: Uint8Array | undefined;
      try {
        if (bytes.length > MAX_PAYLOAD) throw new SecretStoreError('InvalidInput');
        const stored = await store.read(reference);
        const previous = stored && (await decodeSlot(reference, stored.bytes, key));
        previous?.bytes.fill(0);
        if (previous?.revision !== expected) return false;
        envelope = await encodeSlot(reference, revision, bytes, key);
        const written = await store.write(reference, envelope, stored?.version ?? null);
        written.bytes.fill(0);
        return true;
      } catch (error) {
        if (error instanceof SecretStoreError) {
          if (error.code === 'Conflict') return false;
          throw error;
        }
        return unavailable();
      } finally {
        bytes.fill(0);
        envelope?.fill(0);
      }
    },
  };
}
