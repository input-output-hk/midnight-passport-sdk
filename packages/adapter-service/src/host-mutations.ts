import type { AbortSignalLike } from '@input-output-hk/mn-passport-protocol';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type {
  Deployer,
  Submitter,
  MutationOutcomeSource,
  MutationPins,
  MutationEffect,
} from '@input-output-hk/mn-passport-account/ports';
import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';
import { defaultFetch, trimBase } from './service-client.js';
import { toHex } from './hex.js';

export interface RemoteHostMutationOptions {
  readonly pins: MutationPins;
  /** Dedicated service RPC token; never a sponsor seed or funding token. */
  readonly token: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}
type RemoteOutcome =
  | { kind: 'unknown' }
  | {
      kind: 'confirmed';
      digest: string;
      result:
        | { txHash: string; submissionId: string; blockHeight?: number }
        | { address: string; txIds: readonly string[] };
    };
const WATCH_ID = /^(?:[0-9a-f]{64}|[0-9a-f]{66})$/;
const failure = (): never => {
  throw new PassportConnectorError(
    'MutationUnsettled',
    'Host submission is unsettled. Reconcile the same mutation ID; do not create a replacement.',
  );
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const samePins = (a: MutationPins, b: MutationPins) =>
  a.networkId === b.networkId &&
  a.bindingId === b.bindingId &&
  a.manifestSha256 === b.manifestSha256 &&
  a.scheme === b.scheme;
/** Opt-in host ports for use with createDurablePassportMutations. No legacy route fallback.
 * Reconcile may finish known remaining deployment waves under the invocation's original approval.
 * An uncertain broadcast is only looked up; neither this client nor the server retries its POST.
 */
export function remoteHostMutationPorts(
  base: string,
  options: RemoteHostMutationOptions,
): { deployer: Deployer; submitter: Submitter; outcomes: MutationOutcomeSource } {
  if (!/^[0-9a-f]{64}$/.test(options.token)) return failure();
  const pinned = { ...options.pins };
  const timeout = options.timeoutMs ?? 600000,
    delay = options.pollIntervalMs ?? 250,
    fetchFn = options.fetch ?? defaultFetch;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || !Number.isSafeInteger(delay) || delay < 0)
    return failure();
  const identity = (requestId: string, intentSha256: string, kind: 'call' | 'deploy') => ({
    pins: pinned,
    requestId,
    intentSha256,
    kind,
  });
  const request = async (
    path: string,
    body: unknown,
    signal?: AbortSignalLike,
    budget = timeout,
  ): Promise<RemoteOutcome> => {
    if (signal?.aborted) return failure();
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), budget),
      abort = () => controller.abort();
    signal?.addEventListener('abort', abort);
    try {
      const response = await fetchFn(`${trimBase(base)}/v1/mutations/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${options.token}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (response.status !== 200) return failure();
      const answer = await response.json();
      if (!isRecord(answer)) return failure();
      if (answer.kind === 'unknown') return { kind: 'unknown' };
      if (
        answer.kind !== 'confirmed' ||
        typeof answer.digest !== 'string' ||
        !isRecord(answer.result)
      )
        return failure();
      const r = answer.result;
      if (
        typeof r.address === 'string' &&
        /^[0-9a-f]{64}$/.test(r.address) &&
        Array.isArray(r.txIds) &&
        r.txIds.length > 0 &&
        r.txIds.every((id) => typeof id === 'string' && WATCH_ID.test(id))
      )
        return {
          kind: 'confirmed',
          digest: answer.digest,
          result: { address: r.address, txIds: r.txIds as string[] },
        };
      if (
        typeof r.submissionId === 'string' &&
        WATCH_ID.test(r.submissionId) &&
        typeof r.txHash === 'string' &&
        /^[0-9a-f]{64}$/.test(r.txHash) &&
        (r.blockHeight === undefined ||
          (typeof r.blockHeight === 'number' &&
            Number.isSafeInteger(r.blockHeight) &&
            r.blockHeight >= 0))
      )
        return {
          kind: 'confirmed',
          digest: answer.digest,
          result: {
            txHash: r.txHash,
            submissionId: r.submissionId,
            ...(r.blockHeight !== undefined && { blockHeight: r.blockHeight as number }),
          },
        };
      return failure();
    } catch {
      return failure();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
  const finish = async (
    i: ReturnType<typeof identity>,
    input: unknown,
    signal?: Parameters<typeof request>[2],
  ) => {
    const deadline = Date.now() + timeout;
    let answer = await request('execute', { identity: i, input }, signal);
    while (answer.kind === 'unknown') {
      if (Date.now() >= deadline || signal?.aborted) return failure();
      if (delay)
        await new Promise((resolve) => setTimeout(resolve, Math.min(delay, deadline - Date.now())));
      answer = await request(
        'reconcile',
        { identity: i },
        signal,
        Math.max(1, deadline - Date.now()),
      );
    }
    if (answer.kind !== 'confirmed' || answer.digest !== i.intentSha256) return failure();
    return answer.result;
  };
  return {
    deployer: {
      async deploy(r) {
        if (!r.mutation) return failure();
        const result = await finish(
          identity(r.mutation.requestId, r.mutation.intentSha256, 'deploy'),
          {
            boot: toHex(r.boot),
            encKey: toHex(r.encKey),
            retireAuthority: r.retireAuthority,
            firstArm: r.firstArm ?? 'p256',
          },
          r.signal,
        );
        if (!('address' in result)) return failure();
        return result;
      },
    },
    submitter: {
      async submit(tx, context) {
        if (!context) return failure();
        const { mutation, address, circuit } = context;
        const result = await finish(identity(mutation.requestId, mutation.intentSha256, 'call'), {
          tx: toHex(tx),
          address,
          circuit,
        });
        if (!('txHash' in result)) return failure();
        return result.submissionId;
      },
    },
    outcomes: {
      async reconcile(pins: MutationPins, effect: MutationEffect) {
        if (!samePins(pins, pinned)) return failure();
        const answer = await request('reconcile', {
          identity: identity(effect.key, effect.digest, effect.kind),
        });
        if (answer.kind === 'confirmed' && answer.digest !== effect.digest) return failure();
        if (answer.kind === 'confirmed' && 'txHash' in answer.result)
          return {
            kind: 'confirmed',
            digest: answer.digest,
            result: {
              txHash: answer.result.txHash,
              ...(answer.result.blockHeight !== undefined && {
                blockHeight: answer.result.blockHeight,
              }),
            },
          };
        return answer;
      },
    },
  };
}
