import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type {
  Deployer,
  FeeSponsor,
  Prover,
  Submitter,
} from '@input-output-hk/mn-passport-account/ports';
import { fromHex, toHex } from './hex.js';
import { defaultFetch, postService, stringMember } from './service-client.js';
import { requestV1Job, type V1RemoteOptions } from './v1-jobs.js';

const resultBytes = (answer: Record<string, unknown>, path: string): Uint8Array => {
  try {
    return fromHex(stringMember(answer, 'tx', path));
  } catch (cause) {
    if (cause instanceof PassportConnectorError) throw cause;
    throw new PassportConnectorError('InternalError', `${path} answered a non-hex tx`, { cause });
  }
};

/** Transaction-level prover over the v1 request-and-poll wire. */
export function remoteV1Prover(base: string, options: V1RemoteOptions = {}): Prover {
  return {
    async proveTx(unproven, context) {
      const answer = await requestV1Job(
        base,
        '/v1/prove-tx',
        { tx: toHex(unproven) },
        'prover',
        options,
        context.signal,
        context.onEvent,
      );
      return { tx: resultBytes(answer, '/v1/prove-tx'), provenance: 'remote' };
    },
  };
}

/** Wave deployer over the v1 request-and-poll wire. */
export function remoteV1Deployer(base: string, options: V1RemoteOptions = {}): Deployer {
  return {
    async deploy(request) {
      const answer = await requestV1Job(
        base,
        '/v1/deploy',
        {
          boot: toHex(request.boot),
          encKey: toHex(request.encKey),
          retireAuthority: request.retireAuthority,
          ...(request.firstArm && { firstArm: request.firstArm }),
        },
        'sponsor',
        options,
        request.signal,
        request.onEvent,
      );
      const ids = answer.txIds;
      if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === 'string'))
        throw new PassportConnectorError('InternalError', '/v1/deploy answered no txIds list');
      return { address: stringMember(answer, 'address', '/v1/deploy'), txIds: ids };
    },
  };
}

/** Fee-only sponsor and submitter over the synchronous v1 wire. */
export function remoteV1Sponsor(
  base: string,
  options: V1RemoteOptions = {},
): FeeSponsor & Submitter {
  const fetchFn = options.fetch ?? defaultFetch;
  return {
    supportsShieldedOffers: false,
    async balanceAndSign(unbalancedTx) {
      const answer = await postService(
        fetchFn,
        base,
        '/v1/sponsor/balance',
        { tx: toHex(unbalancedTx) },
        'sponsor',
        options.timeoutMs,
      );
      return resultBytes(answer, '/v1/sponsor/balance');
    },
    async submit(finalisedTx) {
      const answer = await postService(
        fetchFn,
        base,
        '/v1/sponsor/submit',
        { tx: toHex(finalisedTx) },
        'sponsor',
        options.timeoutMs,
      );
      return stringMember(answer, 'txId', '/v1/sponsor/submit');
    },
  };
}
