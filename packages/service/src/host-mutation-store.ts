import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { fileMutationByteStore } from './mutation-store.js';
import {
  hostCanonical,
  hostHash,
  hostFailure,
  validateHostIdentity,
  validateHostRecord,
  type HostMutationIdentity,
  type HostMutationRecord,
  type HostMutationStore,
} from './host-mutations.js';

/** Dedicated service key, not the sponsor seed. Local POSIX/private directories only.
 * No plaintext authority key, prepared tx, boot/opening or raw operation is written to disk.
 * Operator rollback/deletion requires an external trusted revision anchor and is not detected.
 */
export function encryptedHostMutationStore(
  directory: string,
  key: Uint8Array,
): HostMutationStore & { close(): void } {
  if (key.length !== 32) return hostFailure();
  const secret = Buffer.from(key),
    bytes = fileMutationByteStore(directory);
  let closed = false;
  const id = (i: HostMutationIdentity) => {
    validateHostIdentity(i);
    return hostHash({
      networkId: i.pins.networkId,
      bindingId: i.pins.bindingId,
      requestId: i.requestId,
    }).slice(0, 32);
  };
  const aad = (identity: HostMutationIdentity, revision: number) =>
    Buffer.from(hostCanonical({ domain: 'mn-passport:host-mutations:v1', identity, revision }));
  const check = () => {
    if (closed) return hostFailure();
  };
  return {
    close() {
      secret.fill(0);
      closed = true;
    },
    async read(identity) {
      check();
      const record = await bytes.read(id(identity));
      if (!record) return undefined;
      if (record.bytes.length < 29) return hostFailure();
      let plain: Buffer | undefined;
      try {
        const body = Buffer.from(record.bytes),
          decipher = createDecipheriv('aes-256-gcm', secret, body.subarray(0, 12));
        decipher.setAAD(aad(identity, record.revision));
        decipher.setAuthTag(body.subarray(-16));
        plain = Buffer.concat([decipher.update(body.subarray(12, -16)), decipher.final()]);
        const value = JSON.parse(plain.toString('utf8')) as HostMutationRecord;
        validateHostRecord(value);
        if (value.revision !== record.revision || hostHash(value.identity) !== hostHash(identity))
          return hostFailure();
        return value;
      } catch {
        return hostFailure();
      } finally {
        plain?.fill(0);
      }
    },
    async compareAndSwap(expected, record) {
      check();
      validateHostRecord(record);
      if (record.revision !== (expected === undefined ? 0 : expected + 1)) return hostFailure();
      const plain = Buffer.from(hostCanonical(record)),
        iv = randomBytes(12);
      try {
        const cipher = createCipheriv('aes-256-gcm', secret, iv);
        cipher.setAAD(aad(record.identity, record.revision));
        const encrypted = Buffer.concat([
          iv,
          cipher.update(plain),
          cipher.final(),
          cipher.getAuthTag(),
        ]);
        return await bytes.compareAndSwap(id(record.identity), expected, {
          revision: record.revision,
          bytes: encrypted,
        });
      } finally {
        plain.fill(0);
      }
    },
  };
}
