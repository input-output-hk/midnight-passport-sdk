import type { AbortSignalLike } from '@input-output-hk/mn-passport-protocol';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type {
  Deployer,
  Submitter,
  MutationOutcomeSource,
  MutationPins,
  FetchLike,
} from '@input-output-hk/mn-passport-account/ports';
import { defaultFetch, trimBase } from './service-client.js';
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
  /** Checked public snapshots only. An observer failure stops this invocation, never the job. */
  readonly onSnapshot?: (snapshot: RemoteHostJobSnapshot) => void;
}
const HEX = /^[0-9a-f]{64}$/;
const WATCH = /^(?:[0-9a-f]{64}|[0-9a-f]{66})$/;
const ID = /^[0-9a-f]{32}:(0|[1-9][0-9]{0,2})$/;
const fail = (): never => {
  throw new PassportConnectorError(
    'MutationUnsettled',
    'Host job is unsettled. Retain the original identity and explicitly reconcile; do not create a replacement.',
  );
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const fields = (
  v: unknown,
  allowed: readonly string[],
  required = allowed,
): v is Record<string, unknown> =>
  object(v) &&
  Object.keys(v).every((k) => allowed.includes(k)) &&
  required.every((k) => Object.hasOwn(v, k));
const whole = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const cursor = (v: unknown): v is string =>
  typeof v === 'string' && /^(0|[1-9][0-9]*)$/.test(v) && whole(Number(v));
const samePins = (a: MutationPins, b: MutationPins) =>
  a.networkId === b.networkId &&
  a.bindingId === b.bindingId &&
  a.manifestSha256 === b.manifestSha256 &&
  a.scheme === b.scheme;
function identityCheck(i: RemoteHostJobIdentity): void {
  if (
    !fields(i, ['pins', 'requestId', 'intentSha256', 'kind']) ||
    !fields(i.pins, ['networkId', 'bindingId', 'manifestSha256', 'scheme']) ||
    typeof i.requestId !== 'string' ||
    !ID.test(i.requestId) ||
    Number(i.requestId.split(':')[1]) > 511 ||
    typeof i.intentSha256 !== 'string' ||
    !HEX.test(i.intentSha256) ||
    !['call', 'deploy'].includes(i.kind) ||
    typeof i.pins.networkId !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(i.pins.networkId) ||
    i.pins.bindingId !== 'acc-s3r1.1' ||
    i.pins.manifestSha256 !== '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f' ||
    !['p256-webauthn', 'jubjub-schnorr'].includes(i.pins.scheme)
  )
    fail();
}
/** Hash only the fixed scalar identity structure. No Node imports or kernel dependency. */
async function identityHashes(i: RemoteHostJobIdentity) {
  identityCheck(i);
  const p = i.pins;
  const hash = async (text: string) =>
    toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
  return {
    jobId: (
      await hash(
        JSON.stringify({
          bindingId: p.bindingId,
          domain: 'mn-passport:host-job-id:v1',
          networkId: p.networkId,
          requestId: i.requestId,
        }),
      )
    ).slice(0, 32),
    identitySha256: await hash(
      JSON.stringify({
        intentSha256: i.intentSha256,
        kind: i.kind,
        pins: {
          bindingId: p.bindingId,
          manifestSha256: p.manifestSha256,
          networkId: p.networkId,
          scheme: p.scheme,
        },
        requestId: i.requestId,
      }),
    ),
  };
}
export async function remoteHostJobId(identity: RemoteHostJobIdentity): Promise<string> {
  return (await identityHashes(identity)).jobId;
}
function inputCheck(i: RemoteHostJobIdentity, input: unknown) {
  if (i.kind === 'deploy') {
    if (
      !fields(input, ['boot', 'encKey', 'retireAuthority', 'firstArm']) ||
      typeof input.boot !== 'string' ||
      !HEX.test(input.boot) ||
      typeof input.encKey !== 'string' ||
      !HEX.test(input.encKey) ||
      typeof input.retireAuthority !== 'boolean' ||
      input.firstArm !== (i.pins.scheme === 'p256-webauthn' ? 'p256' : 'jubjub')
    )
      fail();
  } else if (
    !fields(input, ['address', 'circuit', 'tx']) ||
    typeof input.address !== 'string' ||
    !HEX.test(input.address) ||
    typeof input.circuit !== 'string' ||
    !/^[a-z][a-z0-9_]{0,127}$/.test(input.circuit) ||
    typeof input.tx !== 'string' ||
    !/^(?:[0-9a-f]{2})+$/.test(input.tx)
  )
    fail();
  if (new TextEncoder().encode(JSON.stringify(input)).length > 4 * 1024 * 1024) fail();
}
function checkedSnapshot(
  value: unknown,
  i: RemoteHostJobIdentity,
  expected: Awaited<ReturnType<typeof identityHashes>>,
  after?: string,
): RemoteHostJobSnapshot {
  if (
    !fields(
      value,
      [
        'jobId',
        'identitySha256',
        'state',
        'milestones',
        'events',
        'cursor',
        'firstCursor',
        'outcome',
        'error',
      ],
      ['jobId', 'identitySha256', 'state', 'milestones', 'events', 'cursor', 'firstCursor'],
    ) ||
    value.jobId !== expected.jobId ||
    value.identitySha256 !== expected.identitySha256 ||
    !['queued', 'running', 'unknown', 'done', 'expired'].includes(String(value.state)) ||
    typeof value.state !== 'string' ||
    !cursor(value.cursor) ||
    !cursor(value.firstCursor) ||
    Number(value.firstCursor) > Number(value.cursor) ||
    Number(value.cursor) < 1 ||
    !Array.isArray(value.events) ||
    value.events.length > 256 ||
    !fields(value.milestones, ['preparedSteps', 'confirmedSteps'])
  )
    return fail();
  const max = i.kind === 'call' ? 1 : 64;
  const milestone = (p: unknown, c: unknown) => whole(p) && whole(c) && p <= max && c <= p;
  if (!milestone(value.milestones.preparedSteps, value.milestones.confirmedSteps)) return fail();
  const start = after === undefined ? Number(value.firstCursor) : Number(after);
  if (start < Number(value.firstCursor) || start > Number(value.cursor)) return fail();
  if (value.state === 'expired') {
    if (value.events.length || value.outcome !== undefined || value.error !== undefined)
      return fail();
  } else {
    if (value.events.length !== Number(value.cursor) - start) return fail();
    let previousAt = 0,
      previousPrepared = 0,
      previousConfirmed = 0;
    value.events.forEach((e: unknown, n: number) => {
      if (
        !fields(e, ['sequence', 'state', 'at', 'preparedSteps', 'confirmedSteps']) ||
        e.sequence !== start + n + 1 ||
        typeof e.state !== 'string' ||
        !['queued', 'running', 'unknown', 'done'].includes(e.state) ||
        !whole(e.at) ||
        e.at < previousAt ||
        !milestone(e.preparedSteps, e.confirmedSteps) ||
        Number(e.preparedSteps) < previousPrepared ||
        Number(e.confirmedSteps) < previousConfirmed
      )
        return fail();
      previousAt = e.at;
      previousPrepared = Number(e.preparedSteps);
      previousConfirmed = Number(e.confirmedSteps);
    });
    const last = value.events.at(-1) as RemoteHostJobEvent | undefined;
    if (
      last &&
      (last.state !== value.state ||
        last.preparedSteps !== value.milestones.preparedSteps ||
        last.confirmedSteps !== value.milestones.confirmedSteps)
    )
      return fail();
  }
  if (
    value.state === 'queued' &&
    (Number(value.cursor) !== 1 || value.milestones.preparedSteps !== 0)
  )
    return fail();
  if (value.state === 'unknown') {
    if (
      !fields(value.error, ['code', 'message']) ||
      value.error.code !== 'MutationUnsettled' ||
      value.error.message !== 'Host job is unsettled; retain the original identity and reconcile.'
    )
      return fail();
  } else if (value.error !== undefined) return fail();
  if (value.state === 'done') {
    const o = value.outcome;
    if (
      !value.milestones.preparedSteps ||
      value.milestones.preparedSteps !== value.milestones.confirmedSteps ||
      !fields(o, ['kind', 'digest', 'result']) ||
      o.kind !== 'confirmed' ||
      o.digest !== i.intentSha256
    )
      return fail();
    const r = o.result;
    if (i.kind === 'deploy') {
      if (
        !fields(r, ['address', 'txIds']) ||
        typeof r.address !== 'string' ||
        !HEX.test(r.address) ||
        !Array.isArray(r.txIds) ||
        !r.txIds.length ||
        r.txIds.length > 64 ||
        new Set(r.txIds).size !== r.txIds.length ||
        r.txIds.some((id: unknown) => typeof id !== 'string' || !WATCH.test(id))
      )
        return fail();
    } else if (
      !fields(r, ['txHash', 'submissionId', 'blockHeight'], ['txHash', 'submissionId']) ||
      typeof r.txHash !== 'string' ||
      !HEX.test(r.txHash) ||
      typeof r.submissionId !== 'string' ||
      !WATCH.test(r.submissionId) ||
      (r.blockHeight !== undefined && !whole(r.blockHeight))
    )
      return fail();
  } else if (value.outcome !== undefined) return fail();
  // Validation above owns the wire type. Copy only known public members; never propagate error text.
  return {
    jobId: expected.jobId,
    identitySha256: expected.identitySha256,
    state: value.state as RemoteHostJobState,
    milestones: {
      preparedSteps: Number(value.milestones.preparedSteps),
      confirmedSteps: Number(value.milestones.confirmedSteps),
    },
    events: value.events.map((e: RemoteHostJobEvent) => ({
      sequence: e.sequence,
      state: e.state,
      at: e.at,
      preparedSteps: e.preparedSteps,
      confirmedSteps: e.confirmedSteps,
    })),
    cursor: value.cursor,
    firstCursor: value.firstCursor,
    ...(value.state === 'done' ? { outcome: value.outcome as RemoteHostJobOutcome } : {}),
  };
}
const pause = (ms: number, signal?: AbortSignalLike) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
  });

/** No automatic POST retry, mutating reconciliation, or legacy fallback. Missing/expired jobs
 * remain unsettled. A trusted operator/BFF must hold the token; this is not a public dApp RPC. */
export function remoteHostJobs(base: string, options: RemoteHostJobOptions) {
  const pins = { ...options.pins },
    token = options.token,
    timeout = options.timeoutMs ?? 600000,
    delay = options.pollIntervalMs ?? 250,
    rpcTimeout = options.requestTimeoutMs ?? 10000,
    fetchFn = options.fetch ?? defaultFetch;
  identityCheck({
    pins,
    requestId: '0'.repeat(32) + ':0',
    intentSha256: '0'.repeat(64),
    kind: 'call',
  });
  if (
    !HEX.test(token) ||
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 2147483647 ||
    !Number.isSafeInteger(delay) ||
    delay < 0 ||
    delay > 2147483647 ||
    !Number.isSafeInteger(rpcTimeout) ||
    rpcTimeout < 1 ||
    rpcTimeout > 2147483647
  )
    fail();
  const checkedIdentity = (identity: RemoteHostJobIdentity) => {
    const i = { ...identity, pins: { ...identity.pins } };
    identityCheck(i);
    if (!samePins(i.pins, pins)) fail();
    return i;
  };
  const request = async (
    path: string,
    body: unknown,
    signal?: AbortSignalLike,
    deadline = performance.now() + timeout,
  ) => {
    if (signal?.aborted || performance.now() >= deadline) return fail();
    const controller = new AbortController(),
      abort = () => controller.abort(),
      timer = setTimeout(abort, Math.min(rpcTimeout, Math.max(1, deadline - performance.now())));
    signal?.addEventListener('abort', abort);
    if (signal?.aborted) abort();
    let removeAbort = () => {};
    const interrupted = new Promise<never>((_resolve, reject) => {
      const stop = () => reject(new Error('host request interrupted'));
      controller.signal.addEventListener('abort', stop, { once: true });
      removeAbort = () => controller.signal.removeEventListener('abort', stop);
      if (controller.signal.aborted) stop();
    });
    try {
      const work = async () => {
        const response = await fetchFn(`${trimBase(base)}/v1/host-jobs/${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        });
        // Do not read an error body; it may contain protected upstream diagnostics.
        if (
          (body === undefined && response.status !== 200 && response.status !== 404) ||
          (body !== undefined && response.status !== 202)
        )
          return fail();
        if (response.status === 404) return undefined;
        const answer = await response.json();
        if (controller.signal.aborted || signal?.aborted || performance.now() >= deadline)
          return fail();
        return answer;
      };
      return await Promise.race([work(), interrupted]);
    } catch {
      return fail();
    } finally {
      removeAbort();
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
  const get = async (
    identity: RemoteHostJobIdentity,
    signal?: AbortSignalLike,
    after?: string,
    deadline?: number,
  ) => {
    const i = checkedIdentity(identity),
      h = await identityHashes(i);
    if (after !== undefined && !cursor(after)) return fail();
    const value = await request(
      h.jobId + (after === undefined ? '' : `?after=${after}`),
      undefined,
      signal,
      deadline,
    );
    return value === undefined ? undefined : checkedSnapshot(value, i, h, after);
  };
  const action = async (
    op: 'start' | 'reconcile',
    identity: RemoteHostJobIdentity,
    signal?: AbortSignalLike,
    deadline?: number,
  ) => {
    const i = checkedIdentity(identity),
      h = await identityHashes(i);
    const answer = await request(op, h, signal, deadline);
    if (!fields(answer, ['jobId']) || answer.jobId !== h.jobId) return fail();
    return { jobId: h.jobId };
  };
  const wait = async (
    identity: RemoteHostJobIdentity,
    signal?: AbortSignalLike,
    deadline = performance.now() + timeout,
  ) => {
    const i = checkedIdentity(identity);
    let previous: RemoteHostJobSnapshot | undefined;
    while (true) {
      const snapshot = await get(i, signal, undefined, deadline);
      if (!snapshot) return undefined;
      if (
        previous &&
        (Number(snapshot.cursor) < Number(previous.cursor) ||
          snapshot.milestones.preparedSteps < previous.milestones.preparedSteps ||
          snapshot.milestones.confirmedSteps < previous.milestones.confirmedSteps ||
          (previous.state !== 'queued' && snapshot.state === 'queued'))
      )
        return fail();
      previous = snapshot;
      try {
        options.onSnapshot?.(structuredClone(snapshot));
      } catch {
        return fail();
      }
      if (['done', 'unknown', 'expired'].includes(snapshot.state)) return snapshot;
      try {
        await pause(Math.min(delay, Math.max(0, deadline - performance.now())), signal);
      } catch {
        return fail();
      }
    }
  };
  const accept = async (
    identity: RemoteHostJobIdentity,
    input: RemoteHostJobInput,
    signal?: AbortSignalLike,
    deadline?: number,
  ) => {
    const i = checkedIdentity(identity),
      protectedInput = { ...input };
    inputCheck(i, protectedInput);
    const h = await identityHashes(i),
      answer = await request(
        'accept',
        { version: 1, identity: i, input: protectedInput },
        signal,
        deadline,
      );
    if (!fields(answer, ['jobId']) || answer.jobId !== h.jobId) return fail();
    return { jobId: h.jobId };
  };
  return {
    get,
    wait,
    start: (i: RemoteHostJobIdentity, signal?: AbortSignalLike) => action('start', i, signal),
    reconcile: (i: RemoteHostJobIdentity, signal?: AbortSignalLike) =>
      action('reconcile', i, signal),
    accept,
    /** One explicitly approved original submission invocation. No retry after a lost reply. */
    async execute(
      identity: RemoteHostJobIdentity,
      input: RemoteHostJobInput,
      signal?: AbortSignalLike,
    ) {
      const deadline = performance.now() + timeout,
        i = checkedIdentity(identity);
      await accept(i, input, signal, deadline);
      await action('start', i, signal, deadline);
      return wait(i, signal, deadline);
    },
    /** Explicit same-ID continuation only; never accepts/recreates a missing job. */
    async resume(identity: RemoteHostJobIdentity, signal?: AbortSignalLike) {
      const deadline = performance.now() + timeout,
        i = checkedIdentity(identity),
        snapshot = await get(i, signal, undefined, deadline);
      if (!snapshot || snapshot.state === 'expired' || snapshot.state === 'done') return snapshot;
      await action(snapshot.state === 'queued' ? 'start' : 'reconcile', i, signal, deadline);
      return wait(i, signal, deadline);
    },
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
