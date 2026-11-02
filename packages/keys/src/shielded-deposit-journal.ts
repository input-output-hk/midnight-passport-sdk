import {
  PassportConnectorError,
  readShieldedDepositDocument,
  shieldedDepositDocumentBytes,
  shieldedDepositPinsHash,
  SHIELDED_DEPOSIT_DOCUMENT_LIMIT,
  type ShieldedDepositJournal,
  type ShieldedDepositPins,
} from '@input-output-hk/mn-passport-account';
import type { MutationByteStore, PrfKeySource } from '@input-output-hk/mn-passport-account/ports';

const buffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;
function fail(): never {
  throw new PassportConnectorError(
    'MutationUnsettled',
    'Protected deposit journal is unavailable or differs; retain its original state.',
  );
}
/** Dedicated directory/namespace, separate from other mutation journals. The host byte store must
 * acknowledge crash-durable atomic CAS. Keep all encrypted revisions and the matching key origin.
 * Wrap caller key sessions as appropriate; this helper does not own a sender wallet or its lock.
 */
export function encryptedShieldedDepositJournal(
  pins: ShieldedDepositPins,
  source: PrfKeySource,
  store: MutationByteStore,
): ShieldedDepositJournal {
  const context = shieldedDepositPinsHash(pins);
  const id = (requestId: string) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)) fail();
    return requestId.replaceAll('-', '');
  };
  const aad = (requestId: string, revision: number) =>
    new TextEncoder().encode(
      JSON.stringify(['mn-passport:shielded-deposit-journal', 1, context, requestId, revision]),
    );
  const withKey = <T>(requestId: string, work: (key: CryptoKey) => Promise<T>) =>
    source.withSession(async () => {
      const bytes = await source.deriveSecret({
        domain: 'mn-passport:shielded-deposit-journal:v1',
        context: context + ':' + requestId,
        length: 32,
      });
      try {
        if (bytes.length !== 32) return fail();
        return await work(
          await crypto.subtle.importKey('raw', buffer(bytes), 'AES-GCM', false, [
            'encrypt',
            'decrypt',
          ]),
        );
      } finally {
        bytes.fill(0);
      }
    });
  const read: ShieldedDepositJournal['read'] = async (requestId) => {
    const saved = await store.read(id(requestId));
    if (!saved) return undefined;
    if (
      !Number.isSafeInteger(saved.revision) ||
      saved.revision < 0 ||
      saved.revision > 999999 ||
      saved.bytes.length < 29 ||
      saved.bytes.length > SHIELDED_DEPOSIT_DOCUMENT_LIMIT + 28
    )
      return fail();
    const plain = await withKey(requestId, async (key) => {
      try {
        return new Uint8Array(
          await crypto.subtle.decrypt(
            {
              name: 'AES-GCM',
              iv: buffer(saved.bytes.slice(0, 12)),
              additionalData: buffer(aad(requestId, saved.revision)),
            },
            key,
            buffer(saved.bytes.slice(12)),
          ),
        );
      } catch {
        return fail();
      }
    });
    try {
      const doc = readShieldedDepositDocument(plain);
      if (
        doc.intent.requestId !== requestId ||
        doc.revision !== saved.revision ||
        shieldedDepositPinsHash(doc.intent.pins) !== context
      )
        return fail();
      return doc;
    } finally {
      plain.fill(0);
    }
  };
  return {
    read,
    async compareAndSwap(requestId, expected, requested) {
      const next = readShieldedDepositDocument(shieldedDepositDocumentBytes(requested));
      id(requestId);
      if (
        next.intent.requestId !== requestId ||
        next.revision !== (expected === undefined ? 0 : expected + 1) ||
        shieldedDepositPinsHash(next.intent.pins) !== context
      )
        return fail();
      if (expected === undefined) {
        if (next.phase !== 'prepared') return fail();
      } else {
        const previous = await read(requestId);
        if (!previous || previous.revision !== expected) return false;
        const following = {
          prepared: 'dispatching',
          dispatching: 'submitted',
          submitted: 'confirmed',
          confirmed: undefined,
        } as const;
        if (
          previous.intentSha256 !== next.intentSha256 ||
          following[previous.phase] !== next.phase ||
          (previous.txId !== undefined && previous.txId !== next.txId)
        )
          return fail();
      }
      const plain = shieldedDepositDocumentBytes(next),
        iv = crypto.getRandomValues(new Uint8Array(12));
      try {
        const encrypted = await withKey(
          requestId,
          async (key) =>
            new Uint8Array(
              await crypto.subtle.encrypt(
                {
                  name: 'AES-GCM',
                  iv: buffer(iv),
                  additionalData: buffer(aad(requestId, next.revision)),
                },
                key,
                buffer(plain),
              ),
            ),
        );
        const bytes = new Uint8Array(iv.length + encrypted.length);
        bytes.set(iv);
        bytes.set(encrypted, iv.length);
        return await store.compareAndSwap(id(requestId), expected, {
          revision: next.revision,
          bytes,
        });
      } finally {
        plain.fill(0);
      }
    },
  };
}
