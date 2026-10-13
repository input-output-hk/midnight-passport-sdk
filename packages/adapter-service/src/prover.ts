import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { Prover } from '@input-output-hk/mn-passport-account/ports';
import { fromHex, toHex } from './hex.js';
import type { RemoteOptions } from './options.js';
import { defaultFetch, postService, stringMember } from './service-client.js';

/** Transaction-level remote prover; prover keys remain on the service. */
export function remoteProver(base: string, options: RemoteOptions = {}): Prover {
  return {
    async proveTx(unproven, context) {
      const answer = await postService(
        options.fetch ?? defaultFetch,
        base,
        '/prove-tx',
        {
          tx: toHex(unproven),
          networkId: context.networkId,
          bindingId: context.bindingId,
          circuits: context.circuits,
        },
        'prover',
        options.timeoutMs ?? 600_000,
      );
      try {
        return { tx: fromHex(stringMember(answer, 'tx', '/prove-tx')), provenance: 'remote' };
      } catch (cause) {
        if (cause instanceof PassportConnectorError) throw cause;
        throw new PassportConnectorError('InternalError', '/prove-tx answered a non-hex tx', {
          cause,
        });
      }
    },
  };
}
