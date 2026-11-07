import { z } from 'zod';
import { AccountAddressSchema, BindingIdSchema, NetworkIdSchema } from './validation.js';
import type { SecretReference, SecretStore, StoredSecret } from './ports/secrets.js';
export type { SecretReference, SecretStore, StoredSecret } from './ports/secrets.js';

const label = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
export const SecretReferenceSchema = z
  .object({
    namespace: label,
    networkId: NetworkIdSchema,
    bindingId: BindingIdSchema,
    account: AccountAddressSchema,
    id: label,
  })
  .readonly();
export const SECRET_BYTES_LIMIT = 65_536;
export type SecretStoreErrorCode = 'InvalidInput' | 'Conflict' | 'Unavailable' | 'Closed';
/** Never includes a value, provider message or original error cause. */
export class SecretStoreError extends Error {
  constructor(readonly code: SecretStoreErrorCode) {
    super(`Secret store: ${code}.`);
    this.name = 'SecretStoreError';
  }
}
export function secretReferenceKey(value: SecretReference): string {
  const parsed = SecretReferenceSchema.safeParse(value);
  if (!parsed.success) throw new SecretStoreError('InvalidInput');
  const ref = parsed.data;
  return JSON.stringify([ref.namespace, ref.networkId, ref.bindingId, ref.account, ref.id]);
}
export function copySecretBytes(value: Uint8Array): Uint8Array {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > SECRET_BYTES_LIMIT
  )
    throw new SecretStoreError('InvalidInput');
  return Uint8Array.from(value);
}
export function validSecretVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/.test(value);
}

/** Default reference store for tests and ephemeral hosts. Nothing survives close or reload. */
export function createMemorySecretStore(): SecretStore {
  const records = new Map<string, StoredSecret>();
  let sequence = 0;
  let closed = false;
  const assertOpen = () => {
    if (closed) throw new SecretStoreError('Closed');
  };
  return {
    capabilities: Object.freeze({ persistence: 'memory', protection: 'none' }),
    async read(reference) {
      assertOpen();
      const record = records.get(secretReferenceKey(reference));
      return record && { version: record.version, bytes: record.bytes.slice() };
    },
    async write(reference, bytes, expectedVersion) {
      assertOpen();
      const key = secretReferenceKey(reference);
      const owned = copySecretBytes(bytes);
      try {
        if (expectedVersion !== null && !validSecretVersion(expectedVersion))
          throw new SecretStoreError('InvalidInput');
        const previous = records.get(key);
        if ((previous?.version ?? null) !== expectedVersion) throw new SecretStoreError('Conflict');
        if (!Number.isSafeInteger(sequence + 1)) throw new SecretStoreError('Unavailable');
        const version = `memory:${++sequence}`;
        previous?.bytes.fill(0);
        records.set(key, { version, bytes: owned.slice() });
        return { version, bytes: owned.slice() };
      } finally {
        owned.fill(0);
      }
    },
    async remove(reference, expectedVersion) {
      assertOpen();
      if (!validSecretVersion(expectedVersion)) throw new SecretStoreError('InvalidInput');
      const key = secretReferenceKey(reference);
      const previous = records.get(key);
      if (!previous || previous.version !== expectedVersion) throw new SecretStoreError('Conflict');
      previous.bytes.fill(0);
      records.delete(key);
    },
    close() {
      closed = true;
      for (const record of records.values()) record.bytes.fill(0);
      records.clear();
    },
  };
}
