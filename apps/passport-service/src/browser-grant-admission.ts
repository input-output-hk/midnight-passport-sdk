import { createHash } from 'node:crypto';
import type { MutationByteStore } from '@input-output-hk/mn-passport-account/ports';
import { HttpError } from '@input-output-hk/mn-passport-service';
import { z } from 'zod';

export const relayDigest = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

export const relayHex32 = z.string().regex(/^[0-9a-f]{64}$/);
const dispatchRecord = z.strictObject({ intentSha256: relayHex32, hostInputSha256: relayHex32 });
type DispatchRecord = z.infer<typeof dispatchRecord>;

export const relayUnsettled = () =>
  new HttpError(409, 'Grant issuance is unsettled. Reconcile the original request.');

export function createBrowserGrantDispatchStore(store: MutationByteStore) {
  const key = (requestId: string) =>
    relayDigest(JSON.stringify(['mn-passport:browser-grant-dispatch:v1', requestId])).slice(0, 32);
  return {
    async read(requestId: string): Promise<DispatchRecord | undefined> {
      const record = await store.read(key(requestId));
      if (!record) return undefined;
      if (record.revision !== 0 || record.bytes.length > 256) throw relayUnsettled();
      return dispatchRecord.parse(JSON.parse(new TextDecoder().decode(record.bytes)));
    },
    async reserve(requestId: string, record: DispatchRecord): Promise<boolean> {
      return store.compareAndSwap(key(requestId), undefined, {
        revision: 0,
        bytes: new TextEncoder().encode(JSON.stringify(record)),
      });
    },
  };
}
