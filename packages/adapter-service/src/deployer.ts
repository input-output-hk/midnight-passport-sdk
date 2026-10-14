import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { Deployer } from '@input-output-hk/mn-passport-account/ports';
import { toHex } from './hex.js';
import type { RemoteOptions } from './options.js';
import { defaultFetch, postService, stringMember } from './service-client.js';

/** The service's wave deployer, with an abort before submission. */
export function remoteDeployer(base: string, options: RemoteOptions = {}): Deployer {
  return {
    async deploy({ boot, encKey, retireAuthority, firstArm, signal }) {
      if (signal?.aborted) throw new PassportConnectorError('Aborted', 'The deploy was aborted.');
      const answer = await postService(
        options.fetch ?? defaultFetch,
        base,
        '/deploy',
        {
          boot: toHex(boot),
          encKey: toHex(encKey),
          retireAuthority,
          ...(firstArm && { firstArm }),
        },
        'sponsor',
        options.timeoutMs,
      );
      const txIds = answer.txHashes;
      if (!Array.isArray(txIds) || !txIds.every((id): id is string => typeof id === 'string'))
        throw new PassportConnectorError('InternalError', '/deploy answered no txHashes list');
      return { address: stringMember(answer, 'address', '/deploy'), txIds };
    },
  };
}
