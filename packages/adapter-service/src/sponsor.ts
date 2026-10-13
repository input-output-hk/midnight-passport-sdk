import { PassportConnectorError } from '@midnight-ntwrk/mn-passport-account/errors';
import type { FeeSponsor, Submitter } from '@midnight-ntwrk/mn-passport-account/ports';
import { fromHex, toHex } from './hex.js';
import type { RemoteOptions } from './options.js';
import { defaultFetch, postService, stringMember } from './service-client.js';

/** The service balances/signs fees and submits finalized transactions. */
export function remoteSponsor(base: string, options: RemoteOptions = {}): FeeSponsor & Submitter {
  const fetchFn = options.fetch ?? defaultFetch;
  return {
    async balanceAndSign(unbalancedTx) {
      const answer = await postService(
        fetchFn,
        base,
        '/sponsor/balance',
        { tx: toHex(unbalancedTx) },
        'sponsor',
        options.timeoutMs,
      );
      try {
        return fromHex(stringMember(answer, 'tx', '/sponsor/balance'));
      } catch (cause) {
        if (cause instanceof PassportConnectorError) throw cause;
        throw new PassportConnectorError(
          'InternalError',
          '/sponsor/balance answered a non-hex tx',
          {
            cause,
          },
        );
      }
    },
    async submit(finalisedTx) {
      const answer = await postService(
        fetchFn,
        base,
        '/sponsor/submit',
        { tx: toHex(finalisedTx) },
        'sponsor',
        options.timeoutMs,
      );
      return stringMember(answer, 'txId', '/sponsor/submit');
    },
  };
}
