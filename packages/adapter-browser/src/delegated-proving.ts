import {
  PassportConnectorError,
  fromHex,
  toHex,
  type FetchLike,
} from '@midnight-ntwrk/mn-passport-account';
import type { ProvingProvider } from '@midnightntwrk/ledger-v9';
import { postService, stringMember } from './service-client.js';

const DECIMAL = /^-?\d+$/;

/**
 * The ledger's proving seam, answered by the service, which holds the prover keys (spec §2).
 *
 * `lookupKey` answers `undefined`, as the reference HTTP prover client does: key material is the
 * service's, so the browser never holds a prover key and the ledger falls back to `check`/`prove`.
 */
export function delegatedProvingProvider(base: string, fetchFn: FetchLike): ProvingProvider {
  return {
    async check(serializedPreimage, keyLocation) {
      const answer = await postService(
        fetchFn,
        base,
        '/check',
        { preimage: toHex(serializedPreimage), keyLocation },
        'prover',
      );
      const result = answer.result;
      if (!Array.isArray(result)) {
        throw new PassportConnectorError('InternalError', '/check answered no "result" list');
      }
      return result.map((value: unknown) => {
        if (value === null) return undefined;
        if (typeof value !== 'string' || !DECIMAL.test(value)) {
          throw new PassportConnectorError('InternalError', '/check answered a non-decimal value');
        }
        return BigInt(value);
      });
    },
    async prove(serializedPreimage, keyLocation, overwriteBindingInput) {
      const answer = await postService(
        fetchFn,
        base,
        '/prove',
        {
          preimage: toHex(serializedPreimage),
          keyLocation,
          ...(overwriteBindingInput === undefined
            ? {}
            : { overwriteBindingInput: overwriteBindingInput.toString() }),
        },
        'prover',
      );
      try {
        return fromHex(stringMember(answer, 'proof', '/prove'));
      } catch (cause) {
        if (cause instanceof PassportConnectorError) throw cause;
        throw new PassportConnectorError(
          'InternalError',
          '/prove answered a proof that is not hex',
          { cause },
        );
      }
    },
    lookupKey: () => Promise.resolve(undefined),
  };
}
