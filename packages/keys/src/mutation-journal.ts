import {
  mutationDocumentBytes,
  readMutationDocument,
  mutationFailure,
  MUTATION_MAX_BYTES,
  mutationDigest,
} from '@input-output-hk/mn-passport-account';
import type {
  MutationByteStore,
  MutationJournal,
  MutationPins,
  PrfKeySource,
} from '@input-output-hk/mn-passport-account/ports';

const buffer = (value: Uint8Array): ArrayBuffer => new Uint8Array(value).buffer;
/** Authenticated continuation storage under an existing selected key origin. No raw backup API.
 * The byte store must provide real atomic CAS and crash-durable acknowledgements.
 */
export function encryptedMutationJournal(
  pins: MutationPins,
  source: PrfKeySource,
  store: MutationByteStore,
): MutationJournal {
  const identity = mutationDigest(pins);
  const aad = (id: string, revision: number) =>
    new TextEncoder().encode(
      JSON.stringify(['mn-passport:mutation-journal', 1, identity, id, revision]),
    );
  const withKey = <T>(id: string, work: (key: CryptoKey) => Promise<T>): Promise<T> =>
    source.withSession(async () => {
      const raw = await source.deriveSecret({
        domain: 'mn-passport:mutation-journal:v1',
        context: `${identity}:${id}`,
        length: 32,
      });
      try {
        if (raw.length !== 32) return mutationFailure('Invalid mutation journal key.');
        return await work(
          await crypto.subtle.importKey('raw', buffer(raw), 'AES-GCM', false, [
            'encrypt',
            'decrypt',
          ]),
        );
      } finally {
        raw.fill(0);
      }
    });
  return {
    async read(id) {
      if (!/^[0-9a-f]{32}$/.test(id)) return mutationFailure('Invalid mutation journal ID.');
      const saved = await store.read(id);
      if (!saved) return undefined;
      if (saved.bytes.length < 29 || saved.bytes.length > MUTATION_MAX_BYTES + 28)
        return mutationFailure('Invalid encrypted mutation record size.');
      const plain = await withKey(id, async (key) => {
        try {
          return new Uint8Array(
            await crypto.subtle.decrypt(
              {
                name: 'AES-GCM',
                iv: buffer(saved.bytes.slice(0, 12)),
                additionalData: buffer(aad(id, saved.revision)),
              },
              key,
              buffer(saved.bytes.slice(12)),
            ),
          );
        } catch {
          return mutationFailure('Mutation record authentication failed; do not replace it.');
        }
      });
      try {
        const doc = readMutationDocument(plain);
        if (
          doc.id !== id ||
          doc.revision !== saved.revision ||
          mutationDigest(doc.pins) !== identity
        )
          return mutationFailure('Mutation storage context differs.');
        return doc;
      } finally {
        plain.fill(0);
      }
    },
    async compareAndSwap(id, expectedRevision, next) {
      if (
        next.id !== id ||
        next.revision !== (expectedRevision === undefined ? 0 : expectedRevision + 1) ||
        mutationDigest(next.pins) !== identity
      )
        return mutationFailure('Invalid mutation journal transition.');
      const plain = mutationDocumentBytes(next),
        iv = crypto.getRandomValues(new Uint8Array(12));
      try {
        const ciphertext = await withKey(
          id,
          async (key) =>
            new Uint8Array(
              await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: buffer(iv), additionalData: buffer(aad(id, next.revision)) },
                key,
                buffer(plain),
              ),
            ),
        );
        const bytes = new Uint8Array(iv.length + ciphertext.length);
        bytes.set(iv);
        bytes.set(ciphertext, iv.length);
        return await store.compareAndSwap(id, expectedRevision, { revision: next.revision, bytes });
      } finally {
        plain.fill(0);
      }
    },
  };
}
