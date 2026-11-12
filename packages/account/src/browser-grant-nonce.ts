import { utf8ToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { PassportConnectorError } from './errors.js';
import { mutationDigest } from './mutation-codec.js';
import type { MutationByteStore } from './mutation-types.js';
import { AccountAddressSchema, NetworkIdSchema } from './validation.js';

const hex32 = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .length(64);
const canonicalUrl = z.url({ normalize: true });
const claimSchema = z.strictObject({
  issuer: z
    .string()
    .max(256)
    .refine((value) => {
      const canonical = canonicalUrl.safeParse(value);
      return (
        value.startsWith('https://') &&
        !value.includes('@') &&
        canonical.success &&
        canonical.data === value + '/'
      );
    }),
  networkId: NetworkIdSchema,
  account: AccountAddressSchema,
  requestDigest: hex32,
  nonce: hex32,
  validUntilSeconds: z.number().int().nonnegative(),
});
const recordSchema = z.strictObject({ requestId: z.uuid(), intent: hex32 });

export type BrowserGrantNonceIntent = z.input<typeof claimSchema>;
export interface BrowserGrantNonceStore {
  /** Read an exact retained request without reserving a nonce. */
  read(input: BrowserGrantNonceIntent): Promise<string | undefined>;
  /** Return the original UUID and whether this invocation alone may start issuance. */
  claim(input: BrowserGrantNonceIntent): Promise<{
    readonly requestId: string;
    readonly first: boolean;
  }>;
}

function invalidNonce(): never {
  throw new PassportConnectorError(
    'GrantScopeInvalid',
    'Browser grant nonce does not match its original request.',
  );
}

function unavailableNonce(): never {
  throw new PassportConnectorError(
    'MutationUnsettled',
    'Cannot confirm browser grant nonce admission.',
  );
}

/** Back with a persistent atomic store. Keep records independently of grant openings. */
export function createBrowserGrantNonceStore(
  store: MutationByteStore,
  newRequestId: () => string,
): BrowserGrantNonceStore {
  function identify(input: BrowserGrantNonceIntent) {
    const parsed = claimSchema.safeParse(input);
    if (!parsed.success) return invalidNonce();
    const { issuer, networkId, nonce } = parsed.data;
    const key = mutationDigest({ kind: 'browser-grant-nonce', issuer, networkId, nonce }).slice(
      0,
      32,
    );
    return {
      key,
      intent: mutationDigest(parsed.data),
      read: () => store.read(key).catch(unavailableNonce),
    };
  }
  return {
    async read(input) {
      const { intent, read } = identify(input);
      const original = await read();
      return original && admitOriginal(original, intent).requestId;
    },
    async claim(input) {
      const { key, intent, read } = identify(input);
      const original = await read();
      if (original) return admitOriginal(original, intent);

      const record = recordSchema.parse({ requestId: newRequestId(), intent });
      const bytes = utf8ToBytes(JSON.stringify(record));
      const first = await store
        .compareAndSwap(key, undefined, { revision: 0, bytes })
        .catch(unavailableNonce);
      if (first) return { requestId: record.requestId, first: true };
      return admitOriginal(await read(), intent);
    },
  };
}

function admitOriginal(slot: Awaited<ReturnType<MutationByteStore['read']>>, intent: string) {
  if (!slot || slot.revision !== 0 || slot.bytes.length > 512) return unavailableNonce();
  let record: z.infer<typeof recordSchema>;
  try {
    record = recordSchema.parse(JSON.parse(String.fromCharCode(...slot.bytes)));
  } catch {
    return unavailableNonce();
  }
  if (record.intent !== intent) return invalidNonce();
  return { requestId: record.requestId, first: false };
}
