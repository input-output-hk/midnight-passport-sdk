import { HEX, fail, identityCheck, identityHashes, samePins } from './host-job-identity.js';
import { createHostJobTransport } from './host-job-transport.js';
import {
  acceptRemoteHostJob,
  actRemoteHostJob,
  executeRemoteHostJob,
  getRemoteHostJob,
  retainedRemoteHostJob,
  resumeRemoteHostJob,
  waitRemoteHostJob,
  type HostJobOperations,
} from './host-job-operations.js';
import type { AbortSignalLike } from '@input-output-hk/mn-passport-protocol';
import type {
  Deployer,
  Submitter,
  MutationOutcomeSource,
  MutationPins,
  FetchLike,
} from '@input-output-hk/mn-passport-account/ports';
import { defaultFetch } from './service-client.js';
import { toHex } from './hex.js';

/** Additive operator protocol, separate from the legacy callback job protocol. */
export interface RemoteHostJobIdentity {
  readonly pins: MutationPins;
  readonly requestId: string;
  readonly intentSha256: string;
  readonly kind: 'call' | 'deploy';
}
export type RemoteHostJobInput =
  | { readonly address: string; readonly circuit: string; readonly tx: string }
  | {
      readonly boot: string;
      readonly encKey: string;
      readonly retireAuthority: boolean;
      readonly firstArm: 'p256' | 'jubjub';
    };
export type RemoteHostJobState = 'queued' | 'running' | 'unknown' | 'done' | 'expired';
export interface RemoteHostJobEvent {
  readonly sequence: number;
  readonly state: Exclude<RemoteHostJobState, 'expired'>;
  readonly at: number;
  readonly preparedSteps: number;
  readonly confirmedSteps: number;
}
export type RemoteHostJobOutcome = {
  readonly kind: 'confirmed';
  readonly digest: string;
  readonly result:
    | { readonly txHash: string; readonly submissionId: string; readonly blockHeight?: number }
    | { readonly address: string; readonly txIds: readonly string[] };
};
export interface RemoteHostJobSnapshot {
  readonly jobId: string;
  readonly identitySha256: string;
  readonly state: RemoteHostJobState;
  readonly milestones: { readonly preparedSteps: number; readonly confirmedSteps: number };
  readonly events: readonly RemoteHostJobEvent[];
  readonly cursor: string;
  readonly firstCursor: string;
  readonly outcome?: RemoteHostJobOutcome;
}
export interface RemoteHostJobOptions {
  readonly pins: MutationPins;
  /** Operator-only dedicated job token. Never embed it in a public browser app. */
  readonly token: string;
  readonly fetch?: FetchLike;
  /** Whole invocation budget, default 10 minutes; abortable polling defaults to 250 ms. */
  readonly timeoutMs?: number;
  readonly pollIntervalMs?: number;
  /** Per HTTP request (including response body), default 10 seconds. */
  readonly requestTimeoutMs?: number;
  /** Checked public copies only. Async observers share the invocation budget.
   * A failed observer stops this invocation, never the durable job. */
  readonly onSnapshot?: (snapshot: RemoteHostJobSnapshot) => void | Promise<void>;
}
/** Hash the captured public identity without Node imports or a kernel dependency. */
export async function remoteHostJobId(identity: RemoteHostJobIdentity): Promise<string> {
  return (await identityHashes({ ...identity, pins: { ...identity.pins } })).jobId;
}
function jobOptions(options: RemoteHostJobOptions) {
  const pins = { ...options.pins },
    token = options.token,
    timeoutMs = options.timeoutMs ?? 600000,
    delay = options.pollIntervalMs ?? 250,
    requestTimeoutMs = options.requestTimeoutMs ?? 10000;
  identityCheck({
    pins,
    requestId: '0'.repeat(32) + ':0',
    intentSha256: '0'.repeat(64),
    kind: 'call',
  });
  if (
    !HEX.test(token) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 2147483647 ||
    !Number.isSafeInteger(delay) ||
    delay < 0 ||
    delay > 2147483647 ||
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > 2147483647
  )
    return fail();
  return { pins, token, timeoutMs, delay, requestTimeoutMs };
}
/** Operator/BFF protocol: no automatic POST retry, mutating reconciliation or legacy fallback.
 * Missing/unconfirmed jobs retain their identity. Observer failure stops only this invocation. */
export function remoteHostJobs(base: string, options: RemoteHostJobOptions) {
  const policy = jobOptions(options),
    observer = options.onSnapshot;
  const context: HostJobOperations = {
    pins: policy.pins,
    timeoutMs: policy.timeoutMs,
    delay: policy.delay,
    observer: observer === undefined ? undefined : (snapshot) => observer.call(options, snapshot),
    request: createHostJobTransport({
      base,
      token: policy.token,
      timeoutMs: policy.timeoutMs,
      requestTimeoutMs: policy.requestTimeoutMs,
      fetch: options.fetch ?? defaultFetch,
    }),
  };
  return {
    get: (
      identity: RemoteHostJobIdentity,
      signal?: AbortSignalLike,
      after?: string,
      deadline?: number,
    ) => getRemoteHostJob(context, identity, signal, after, deadline),
    wait: (identity: RemoteHostJobIdentity, signal?: AbortSignalLike, deadline?: number) =>
      waitRemoteHostJob(context, identity, signal, deadline),
    result: (identity: RemoteHostJobIdentity, signal?: AbortSignalLike) =>
      retainedRemoteHostJob(context, identity, signal),
    start: (identity: RemoteHostJobIdentity, signal?: AbortSignalLike) =>
      actRemoteHostJob(context, 'start', identity, signal),
    reconcile: (identity: RemoteHostJobIdentity, signal?: AbortSignalLike) =>
      actRemoteHostJob(context, 'reconcile', identity, signal),
    accept: (
      identity: RemoteHostJobIdentity,
      input: RemoteHostJobInput,
      signal?: AbortSignalLike,
      deadline?: number,
    ) => acceptRemoteHostJob(context, identity, input, signal, deadline),
    execute: (
      identity: RemoteHostJobIdentity,
      input: RemoteHostJobInput,
      signal?: AbortSignalLike,
    ) => executeRemoteHostJob(context, identity, input, signal),
    resume: (identity: RemoteHostJobIdentity, signal?: AbortSignalLike) =>
      resumeRemoteHostJob(context, identity, signal),
  };
}

/** Ports for createDurablePassportMutations in a trusted host. No change to remoteV1* or
 * remoteHostMutationPorts; the owner still performs frontier and finality validation. */
export function remoteHostJobPorts(
  base: string,
  options: RemoteHostJobOptions,
): { deployer: Deployer; submitter: Submitter; outcomes: MutationOutcomeSource } {
  const jobs = remoteHostJobs(base, options),
    pins = { ...options.pins };
  const identity = (
    requestId: string,
    intentSha256: string,
    kind: 'call' | 'deploy',
  ): RemoteHostJobIdentity => ({ pins, requestId, intentSha256, kind });
  const result = (snapshot: RemoteHostJobSnapshot | undefined) =>
    snapshot?.state === 'done' && snapshot.outcome ? snapshot.outcome : fail();
  return {
    deployer: {
      async deploy(r) {
        if (!r.mutation) return fail();
        const answer = result(
          await jobs.execute(
            identity(r.mutation.requestId, r.mutation.intentSha256, 'deploy'),
            {
              boot: toHex(r.boot),
              encKey: toHex(r.encKey),
              retireAuthority: r.retireAuthority,
              firstArm: r.firstArm ?? 'p256',
            },
            r.signal,
          ),
        );
        return 'address' in answer.result ? answer.result : fail();
      },
    },
    submitter: {
      async submit(tx, c) {
        if (!c) return fail();
        const answer = result(
          await jobs.execute(
            identity(c.mutation.requestId, c.mutation.intentSha256, 'call'),
            { tx: toHex(tx), address: c.address, circuit: c.circuit },
            c.signal,
          ),
        );
        return 'submissionId' in answer.result ? answer.result.submissionId : fail();
      },
    },
    outcomes: {
      async reconcile(p, e, context = {}) {
        if (!samePins(p, pins)) return fail();
        const s = await jobs.resume(identity(e.key, e.digest, e.kind), context.signal);
        if (s?.state !== 'done' || !s.outcome) return { kind: 'unknown' };
        const answer = s.outcome;
        if ('txHash' in answer.result)
          return {
            kind: 'confirmed',
            digest: answer.digest,
            result: {
              txHash: answer.result.txHash,
              ...(answer.result.blockHeight === undefined
                ? {}
                : { blockHeight: answer.result.blockHeight }),
            },
          };
        return answer;
      },
    },
  };
}
