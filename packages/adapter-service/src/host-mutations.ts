import type { AbortSignalLike } from '@input-output-hk/mn-passport-protocol';
import type {
  Deployer,
  Submitter,
  MutationOutcomeSource,
  MutationPins,
  MutationEffect,
  FetchLike,
} from '@input-output-hk/mn-passport-account/ports';
import { defaultFetch, trimBase } from './service-client.js';
import { toHex } from './hex.js';
import { transportLifetime, validTimer } from './transport-lifetime.js';
import {
  mutationIdentity,
  mutationFailure,
  type MutationIdentity,
  type RemoteOutcome,
} from './host-mutation-outcome.js';
import { mutationRequest } from './host-mutation-transport.js';
import { remoteGrantIssuePort, type RemoteHostGrantIssuePort } from './host-grant-issue.js';
export type { HostGrantIssueReference, RemoteHostGrantIssuePort } from './host-grant-issue.js';

export interface RemoteHostMutationOptions {
  readonly pins: MutationPins;
  /** Dedicated service RPC token; never a sponsor seed or funding token. */
  readonly token: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
}
const samePins = (a: MutationPins, b: MutationPins) =>
  a.networkId === b.networkId &&
  a.bindingId === b.bindingId &&
  a.manifestSha256 === b.manifestSha256 &&
  a.scheme === b.scheme;
/** Opt-in durable host ports. Observation expiry never cancels or replays durable work.
 * Reconciliation may continue original approved preparation; it is not universally read-only.
 * A transport failure never retries a POST or falls back to a legacy route. */
export function remoteHostMutationPorts(
  base: string,
  options: RemoteHostMutationOptions,
): {
  deployer: Deployer;
  submitter: Submitter;
  outcomes: MutationOutcomeSource;
  grantIssue: RemoteHostGrantIssuePort;
} {
  const token = options.token,
    sourcePins = options.pins;
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return mutationFailure();
  const pinned: MutationPins = Object.freeze({
    networkId: sourcePins.networkId,
    bindingId: sourcePins.bindingId,
    manifestSha256: sourcePins.manifestSha256,
    scheme: sourcePins.scheme,
  });
  const timeout = options.timeoutMs ?? 600_000,
    delay = options.pollIntervalMs ?? 250;
  const fetchFn = options.fetch ?? defaultFetch;
  if (!validTimer(timeout, 1) || !validTimer(delay, 0)) return mutationFailure();
  const transport = { base: trimBase(base), token, fetch: fetchFn };
  const identity = (requestId: string, digest: string, kind: 'call' | 'deploy') =>
    mutationIdentity(pinned, requestId, digest, kind);
  const observe = async (
    i: MutationIdentity,
    input: unknown,
    signal?: AbortSignalLike,
    execute = false,
    deadline = performance.now() + timeout,
  ): Promise<RemoteOutcome> => {
    // Serialize every eventual request before the first await; retain no caller input aliases.
    const initial = JSON.stringify(execute ? { identity: i, input } : { identity: i });
    const reconcile = execute ? JSON.stringify({ identity: i }) : initial;
    const lifetime = transportLifetime(deadline, signal);
    try {
      let answer = await mutationRequest(
        transport,
        execute ? 'execute' : 'reconcile',
        initial,
        i,
        lifetime,
      );
      while (execute && answer.kind === 'unknown') {
        await lifetime.pause(delay);
        answer = await mutationRequest(transport, 'reconcile', reconcile, i, lifetime);
      }
      lifetime.check();
      return answer;
    } finally {
      lifetime.close();
    }
  };
  const finish = async (
    i: MutationIdentity,
    input: unknown,
    signal: AbortSignalLike | undefined,
    deadline: number,
  ) => {
    try {
      return await observe(i, input, signal, true, deadline);
    } catch {
      return mutationFailure();
    }
  };
  return {
    grantIssue: remoteGrantIssuePort(pinned, finish, observe, timeout),
    deployer: {
      async deploy(r) {
        const deadline = performance.now() + timeout;
        const mutation = r.mutation,
          signal = r.signal;
        if (!mutation) return mutationFailure();
        const i = identity(mutation.requestId, mutation.intentSha256, 'deploy');
        const answer = await finish(
          i,
          {
            boot: toHex(r.boot),
            encKey: toHex(r.encKey),
            retireAuthority: r.retireAuthority,
            firstArm: r.firstArm ?? 'p256',
          },
          signal,
          deadline,
        );
        if (answer.kind !== 'confirmed' || !('address' in answer.result)) return mutationFailure();
        return answer.result;
      },
    },
    submitter: {
      async submit(tx, context) {
        const deadline = performance.now() + timeout;
        if (!context) return mutationFailure();
        const { mutation, address, circuit, signal } = context;
        const i = identity(mutation.requestId, mutation.intentSha256, 'call');
        const answer = await finish(i, { tx: toHex(tx), address, circuit }, signal, deadline);
        if (answer.kind !== 'confirmed' || !('txHash' in answer.result)) return mutationFailure();
        return answer.result.submissionId;
      },
    },
    outcomes: {
      async reconcile(
        pins: MutationPins,
        effect: MutationEffect,
        context: { readonly signal?: AbortSignalLike } = {},
      ) {
        const deadline = performance.now() + timeout;
        try {
          if (!samePins(pins, pinned)) return mutationFailure();
          const i = identity(effect.key, effect.digest, effect.kind),
            signal = context.signal;
          const answer = await observe(i, undefined, signal, false, deadline);
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
        } catch {
          return mutationFailure();
        }
      },
    },
  };
}
