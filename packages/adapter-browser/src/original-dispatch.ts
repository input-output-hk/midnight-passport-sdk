import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type {
  SecretReference,
  SecretStore,
  Submitter,
} from '@input-output-hk/mn-passport-account/ports';
import { SecretReferenceSchema } from '@input-output-hk/mn-passport-account/secret-store';
import { ContractCall, Transaction } from '@midnightntwrk/ledger-v9';
import { z } from 'zod';

const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const identity = z.strictObject({
  txHash: hex32,
  bytesSha256: hex32,
  identifiers: z
    .array(z.string().regex(/^(?:[0-9a-f]{64}|[0-9a-f]{66})$/))
    .min(1)
    .max(64),
});

export type OriginalDispatchIdentity = z.infer<typeof identity>;
export type OriginalDispatchScope = Omit<SecretReference, 'namespace' | 'id'> & {
  readonly requestId: string;
};

function reference(scope: OriginalDispatchScope) {
  return SecretReferenceSchema.parse({
    namespace: 'passport-browser-original-dispatch-v1',
    networkId: scope.networkId,
    bindingId: scope.bindingId,
    account: scope.account,
    id: scope.requestId,
  });
}

async function identify(bytes: Uint8Array<ArrayBuffer>, ref: SecretReference) {
  const tx = Transaction.deserialize('signature', 'proof', 'binding', bytes);
  tx.eraseProofs().merge(Transaction.fromParts(ref.networkId).eraseProofs());
  const actions = [...(tx.intents?.values() ?? [])].flatMap((intent) => intent.actions);
  const [action] = actions;
  if (actions.length !== 1 || !(action instanceof ContractCall) || action.address !== ref.account)
    throw new Error('Expected one scoped ACC call.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return identity.parse({
    txHash: tx.transactionHash(),
    bytesSha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    identifiers: tx.identifiers(),
  });
}

/**
 * Keep a stable request ID across retries. Supply a durable, atomic store and
 * a submitter that makes a single attempt. The host owns consent and finality.
 */
export function createBrowserOriginalDispatch(store: SecretStore, submitter: Submitter) {
  if (
    store.capabilities.persistence !== 'persistent' ||
    store.capabilities.writeDurability !== 'strict'
  )
    throw new PassportConnectorError(
      'InternalError',
      'Original dispatch requires strict persistent writes.',
    );
  return {
    async readOriginal(
      scope: OriginalDispatchScope,
    ): Promise<OriginalDispatchIdentity | undefined> {
      try {
        const entry = await store.read(reference(scope));
        if (!entry) return undefined;
        try {
          return identity.parse(
            JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes)),
          );
        } finally {
          entry.bytes.fill(0);
        }
      } catch {
        throw new PassportConnectorError(
          'MutationUnsettled',
          'Original dispatch record unavailable.',
        );
      }
    },
    async dispatch(
      scope: OriginalDispatchScope,
      finalized: Uint8Array,
    ): Promise<{ readonly original: OriginalDispatchIdentity; readonly acknowledged: boolean }> {
      if (
        !(finalized instanceof Uint8Array) ||
        !(finalized.buffer instanceof ArrayBuffer) ||
        finalized.byteLength === 0 ||
        finalized.byteLength > 8 * 1024 * 1024
      )
        throw new PassportConnectorError('InternalError', 'Invalid finalized transaction bytes.');
      const bytes = new Uint8Array(finalized);
      try {
        const ref = reference(scope);
        const original = await identify(bytes, ref);
        const encoded = new TextEncoder().encode(JSON.stringify(original));
        try {
          const entry = await store.write(ref, encoded, null);
          entry.bytes.fill(0);
        } finally {
          encoded.fill(0);
        }
        try {
          const response = await submitter.submit(bytes);
          return { original, acknowledged: original.identifiers.includes(response) };
        } catch {
          return { original, acknowledged: false };
        }
      } catch {
        throw new PassportConnectorError(
          'MutationUnsettled',
          'Original dispatch could not be reserved.',
        );
      } finally {
        bytes.fill(0);
      }
    },
  };
}
