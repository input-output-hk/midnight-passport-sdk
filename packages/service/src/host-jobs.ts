import {
  hostCanonical,
  hostHash,
  validateHostIdentity,
  type HostJson,
  type HostMutationIdentity,
  type HostMutationOutcome,
  type createHostMutationExecutor,
} from './host-mutations.js';
import { HttpError } from './http.js';
import { serial } from './queue.js';

/** A serialisable request, never a callback, key generator or replacement transaction. */
export interface HostJobDescriptor {
  readonly version: 1;
  readonly identity: HostMutationIdentity;
  readonly input: HostJson;
}
export type HostJobState = 'queued' | 'running' | 'unknown' | 'done';
export interface HostJobMilestones {
  readonly preparedSteps: number;
  readonly confirmedSteps: number;
}
export interface HostJobEvent extends HostJobMilestones {
  readonly sequence: number;
  readonly state: HostJobState;
  readonly at: number;
}
type Confirmed = Extract<HostMutationOutcome, { kind: 'confirmed' }>;
export interface HostJobRecord {
  readonly version: 1;
  readonly revision: number;
  readonly id: string;
  readonly descriptor: HostJobDescriptor;
  readonly descriptorSha256: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly policy: { readonly eventLimit: number; readonly completedTtlMs: number };
  readonly state: HostJobState;
  readonly milestones: HostJobMilestones;
  readonly eventSequence: number;
  readonly events: readonly HostJobEvent[];
  readonly outcome?: Confirmed;
  readonly finishedAt?: number;
}
/** CAS and admission must be atomic across every process sharing the store. Retain IDs. */
export interface HostJobStore {
  read(id: string): Promise<HostJobRecord | undefined>;
  compareAndSwap(expected: number | undefined, record: HostJobRecord): Promise<boolean>;
}
export interface HostJobView {
  readonly jobId: string;
  readonly state: HostJobState | 'expired';
  readonly milestones: HostJobMilestones;
  readonly events: readonly HostJobEvent[];
  readonly cursor: string;
  readonly firstCursor: string;
  readonly outcome?: Confirmed;
  readonly error?: { readonly code: 'MutationUnsettled'; readonly message: string };
}
export interface HostJobOptions {
  readonly pins: Pick<HostMutationIdentity['pins'], 'networkId' | 'bindingId' | 'manifestSha256'>;
  readonly eventLimit?: number;
  /** Result visibility only. Expiry never frees identity or journal capacity. */
  readonly completedTtlMs?: number;
  /** Per-process asynchronous work admission, not a distributed wallet lock. */
  readonly maxActive?: number;
  readonly now?: () => number;
  /** Share the sponsor wallet's queue with direct mutation/legacy routes. */
  readonly runExclusive?: ReturnType<typeof serial>;
}
export type HostJobExecutor = Pick<
  ReturnType<typeof createHostMutationExecutor>,
  'execute' | 'resume' | 'inspect'
>;
const HEX = /^[0-9a-f]{64}$/;
const WATCH = /^(?:[0-9a-f]{64}|[0-9a-f]{66})$/;
export const HOST_JOB_INPUT_LIMIT = 4 * 1024 * 1024;
export const hostJobFailure = (): never => {
  throw new Error('Invalid or unavailable host job.');
};
const whole = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
const fields = (v: unknown, allowed: string[], required = allowed): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).every((key) => allowed.includes(key)) &&
  required.every((key) => Object.hasOwn(v, key));
const clone = <T>(value: T): T => JSON.parse(hostCanonical(value)) as T;
export function validateHostJobId(id: string): void {
  if (!/^[0-9a-f]{32}$/.test(id) || id === '0'.repeat(32)) hostJobFailure();
}
export function validateHostJobDescriptor(d: HostJobDescriptor): void {
  hostCanonical(d);
  if (!fields(d, ['version', 'identity', 'input']) || d.version !== 1) hostJobFailure();
  validateHostIdentity(d.identity);
  if (
    !fields(d.identity, ['pins', 'requestId', 'intentSha256', 'kind']) ||
    !fields(d.identity.pins, ['networkId', 'bindingId', 'manifestSha256', 'scheme']) ||
    typeof d.identity.pins.networkId !== 'string' ||
    typeof d.identity.requestId !== 'string' ||
    typeof d.identity.intentSha256 !== 'string' ||
    Buffer.byteLength(hostCanonical(d.input)) > HOST_JOB_INPUT_LIMIT
  )
    hostJobFailure();
  const input = d.input;
  if (d.identity.kind === 'deploy') {
    if (
      !fields(input, ['boot', 'encKey', 'retireAuthority', 'firstArm']) ||
      typeof input.boot !== 'string' ||
      !HEX.test(input.boot) ||
      typeof input.encKey !== 'string' ||
      !HEX.test(input.encKey) ||
      typeof input.retireAuthority !== 'boolean' ||
      typeof input.firstArm !== 'string' ||
      !['p256', 'jubjub'].includes(input.firstArm)
    )
      hostJobFailure();
  } else if (
    !fields(input, ['address', 'circuit', 'tx']) ||
    typeof input.address !== 'string' ||
    !HEX.test(input.address) ||
    typeof input.circuit !== 'string' ||
    !/^[a-z][a-z0-9_]{0,127}$/.test(input.circuit) ||
    typeof input.tx !== 'string' ||
    !/^(?:[0-9a-f]{2})+$/.test(input.tx)
  )
    hostJobFailure();
}
export function hostJobId(d: HostJobDescriptor): string {
  validateHostJobDescriptor(d);
  return hostHash({
    domain: 'mn-passport:host-job-id:v1',
    networkId: d.identity.pins.networkId,
    bindingId: d.identity.pins.bindingId,
    requestId: d.identity.requestId,
  }).slice(0, 32);
}
function validateOutcome(o: Confirmed, d: HostJobDescriptor): void {
  if (
    !fields(o, ['kind', 'digest', 'result']) ||
    o.kind !== 'confirmed' ||
    o.digest !== d.identity.intentSha256
  )
    hostJobFailure();
  const r: unknown = o.result;
  if (d.identity.kind === 'deploy') {
    if (
      !fields(r, ['address', 'txIds']) ||
      typeof r.address !== 'string' ||
      !HEX.test(r.address) ||
      !Array.isArray(r.txIds) ||
      !r.txIds.length ||
      r.txIds.length > 64 ||
      r.txIds.some((id: unknown) => typeof id !== 'string' || !WATCH.test(id)) ||
      new Set(r.txIds).size !== r.txIds.length
    )
      hostJobFailure();
  } else if (
    !fields(r, ['txHash', 'submissionId', 'blockHeight'], ['txHash', 'submissionId']) ||
    typeof r.txHash !== 'string' ||
    !HEX.test(r.txHash) ||
    typeof r.submissionId !== 'string' ||
    !WATCH.test(r.submissionId) ||
    (r.blockHeight !== undefined && !whole(r.blockHeight))
  )
    hostJobFailure();
}
export function validateHostJobRecord(r: HostJobRecord): void {
  hostCanonical(r);
  if (
    !fields(
      r,
      [
        'version',
        'revision',
        'id',
        'descriptor',
        'descriptorSha256',
        'createdAt',
        'updatedAt',
        'policy',
        'state',
        'milestones',
        'eventSequence',
        'events',
        'outcome',
        'finishedAt',
      ],
      [
        'version',
        'revision',
        'id',
        'descriptor',
        'descriptorSha256',
        'createdAt',
        'updatedAt',
        'policy',
        'state',
        'milestones',
        'eventSequence',
        'events',
      ],
    ) ||
    r.version !== 1 ||
    !whole(r.revision) ||
    r.revision > 999999 ||
    !whole(r.createdAt) ||
    !whole(r.updatedAt) ||
    r.updatedAt < r.createdAt ||
    !['queued', 'running', 'unknown', 'done'].includes(r.state)
  )
    hostJobFailure();
  validateHostJobId(r.id);
  if (r.id !== hostJobId(r.descriptor) || r.descriptorSha256 !== hostHash(r.descriptor))
    hostJobFailure();
  if (
    !fields(r.policy, ['eventLimit', 'completedTtlMs']) ||
    !whole(r.policy.eventLimit) ||
    r.policy.eventLimit < 1 ||
    r.policy.eventLimit > 256 ||
    !whole(r.policy.completedTtlMs) ||
    r.policy.completedTtlMs > 3650 * 86400000
  )
    hostJobFailure();
  const max = r.descriptor.identity.kind === 'call' ? 1 : 64;
  const validMilestones = (m: HostJobMilestones) =>
    fields(m, ['preparedSteps', 'confirmedSteps']) &&
    whole(m.preparedSteps) &&
    whole(m.confirmedSteps) &&
    m.preparedSteps <= max &&
    m.confirmedSteps <= m.preparedSteps;
  if (
    !validMilestones(r.milestones) ||
    !whole(r.eventSequence) ||
    r.eventSequence < 1 ||
    !Array.isArray(r.events) ||
    !r.events.length ||
    r.events.length > r.policy.eventLimit
  )
    hostJobFailure();
  r.events.forEach((e, i) => {
    if (
      !fields(e, ['sequence', 'state', 'at', 'preparedSteps', 'confirmedSteps']) ||
      !whole(e.sequence) ||
      e.sequence !== r.eventSequence - r.events.length + i + 1 ||
      !whole(e.at) ||
      e.at < r.createdAt ||
      e.at > r.updatedAt ||
      !['queued', 'running', 'unknown', 'done'].includes(e.state) ||
      !validMilestones({ preparedSteps: e.preparedSteps, confirmedSteps: e.confirmedSteps })
    )
      hostJobFailure();
  });
  const last = r.events.at(-1)!;
  if (
    last.state !== r.state ||
    last.preparedSteps !== r.milestones.preparedSteps ||
    last.confirmedSteps !== r.milestones.confirmedSteps
  )
    hostJobFailure();
  if (r.state === 'done') {
    if (
      !r.outcome ||
      !whole(r.finishedAt) ||
      r.finishedAt !== r.updatedAt ||
      !r.milestones.preparedSteps ||
      r.milestones.preparedSteps !== r.milestones.confirmedSteps
    )
      hostJobFailure();
    validateOutcome(r.outcome!, r.descriptor);
  } else if (r.outcome !== undefined || r.finishedAt !== undefined) hostJobFailure();
  if (
    r.state === 'queued' &&
    (r.revision !== 0 || r.eventSequence !== 1 || r.milestones.preparedSteps)
  )
    hostJobFailure();
}

export function validateHostJobUpdate(
  previous: HostJobRecord | undefined,
  next: HostJobRecord,
): void {
  validateHostJobRecord(next);
  if (!previous) {
    if (next.state !== 'queued' || next.revision !== 0) hostJobFailure();
    return;
  }
  validateHostJobRecord(previous);
  const retained =
    previous.policy.eventLimit === 1 ? [] : previous.events.slice(1 - previous.policy.eventLimit);
  if (
    next.events.length !== Math.min(previous.events.length + 1, previous.policy.eventLimit) ||
    hostHash(next.events.slice(0, -1)) !== hostHash(retained)
  )
    hostJobFailure();
  if (
    next.revision !== previous.revision + 1 ||
    next.id !== previous.id ||
    next.descriptorSha256 !== previous.descriptorSha256 ||
    next.createdAt !== previous.createdAt ||
    hostHash(next.policy) !== hostHash(previous.policy) ||
    next.updatedAt < previous.updatedAt ||
    next.eventSequence !== previous.eventSequence + 1 ||
    previous.state === 'done' ||
    next.milestones.preparedSteps < previous.milestones.preparedSteps ||
    next.milestones.confirmedSteps < previous.milestones.confirmedSteps ||
    (previous.state === 'queued'
      ? next.state !== 'running'
      : !['unknown', 'done'].includes(next.state))
  )
    hostJobFailure();
}

/** Async status over existing host write-ahead work. No queued scanner, callback replay or
 * automatic execute after restart. Missing host state is unknown, never proof of no send. */
export function createHostMutationJobs(
  store: HostJobStore,
  executor: HostJobExecutor,
  options: HostJobOptions,
) {
  const pins = clone(options.pins);
  if (
    !fields(pins, ['networkId', 'bindingId', 'manifestSha256']) ||
    typeof pins.networkId !== 'string'
  )
    hostJobFailure();
  validateHostIdentity({
    pins: { ...pins, scheme: 'jubjub-schnorr' },
    requestId: '0'.repeat(32) + ':0',
    intentSha256: '0'.repeat(64),
    kind: 'call',
  });
  const samePins = (d: HostJobDescriptor) =>
    d.identity.pins.networkId === pins.networkId &&
    d.identity.pins.bindingId === pins.bindingId &&
    d.identity.pins.manifestSha256 === pins.manifestSha256;
  const eventLimit = options.eventLimit ?? 32,
    completedTtlMs = options.completedTtlMs ?? 600000,
    maxActive = options.maxActive ?? 8,
    now = options.now ?? Date.now,
    exclusive = options.runExclusive ?? serial(8);
  if (
    !whole(eventLimit) ||
    eventLimit < 1 ||
    eventLimit > 256 ||
    !whole(completedTtlMs) ||
    completedTtlMs > 3650 * 86400000 ||
    !whole(maxActive) ||
    maxActive < 1 ||
    maxActive > 128
  )
    hostJobFailure();
  let open = true,
    admitted = 0;
  const tasks = new Set<Promise<void>>();
  const drainWaiters = new Set<() => void>();
  const releaseAdmission = () => {
    admitted--;
    if (admitted === 0) {
      for (const resolve of drainWaiters) resolve();
      drainWaiters.clear();
    }
  };
  const unavailable = (): never => {
    throw new HttpError(503, 'host job unavailable; retain the original identity');
  };
  const time = () => {
    const n = now();
    if (!whole(n)) return unavailable();
    return n;
  };
  const read = async (id: string) => {
    try {
      validateHostJobId(id);
    } catch {
      throw new HttpError(400, 'invalid host job ID');
    }
    try {
      const r = await store.read(id);
      if (r) {
        validateHostJobRecord(r);
        if (r.id !== id || !samePins(r.descriptor)) return unavailable();
      }
      return r;
    } catch {
      return unavailable();
    }
  };
  const save = async (old: number | undefined, next: HostJobRecord) => {
    try {
      validateHostJobRecord(next);
      return await store.compareAndSwap(old, next);
    } catch {
      return unavailable();
    }
  };
  const transition = (
    r: HostJobRecord,
    state: HostJobState,
    milestones = r.milestones,
    outcome?: Confirmed,
  ): HostJobRecord => {
    const at = Math.max(time(), r.updatedAt),
      sequence = r.eventSequence + 1;
    return {
      ...r,
      revision: r.revision + 1,
      state,
      milestones,
      updatedAt: at,
      eventSequence: sequence,
      events: [...r.events, { sequence, state, at, ...milestones }].slice(-r.policy.eventLimit),
      ...(outcome && { outcome, finishedAt: at }),
    };
  };
  const view = (r: HostJobRecord, after?: string): HostJobView => {
    const first = r.events[0]!.sequence - 1;
    if (
      after !== undefined &&
      (!/^(0|[1-9][0-9]*)$/.test(after) || !whole(Number(after)) || Number(after) > r.eventSequence)
    )
      throw new HttpError(400, 'invalid host job cursor');
    if (after !== undefined && Number(after) < first)
      throw new HttpError(410, 'host job cursor expired; read a fresh snapshot');
    const expired = r.state === 'done' && time() - r.finishedAt! >= r.policy.completedTtlMs;
    return clone({
      jobId: r.id,
      state: expired ? 'expired' : r.state,
      milestones: r.milestones,
      events: expired ? [] : r.events.filter((e) => e.sequence > Number(after ?? first)),
      cursor: String(r.eventSequence),
      firstCursor: String(first),
      ...(!expired && r.outcome && { outcome: r.outcome }),
      ...(r.state === 'unknown' && {
        error: {
          code: 'MutationUnsettled',
          message: 'Host job is unsettled; retain the original identity and reconcile.',
        },
      }),
    });
  };
  const observe = async (r: HostJobRecord, execute: boolean) => {
    let outcome: HostMutationOutcome = { kind: 'unknown' },
      milestones = r.milestones;
    try {
      const status = await executor.inspect(r.descriptor.identity);
      if (
        status &&
        (status.preparedSteps < milestones.preparedSteps ||
          status.confirmedSteps < milestones.confirmedSteps)
      )
        throw new Error('Host journal regressed.');
      if (execute) outcome = await executor.execute(r.descriptor.identity, r.descriptor.input);
      else if (status)
        outcome = await executor.resume(r.descriptor.identity, {
          expectedInputSha256: hostHash(r.descriptor.input),
        });
      const final = await executor.inspect(r.descriptor.identity);
      if (
        final &&
        final.preparedSteps >= milestones.preparedSteps &&
        final.confirmedSteps >= milestones.confirmedSteps
      )
        milestones = { preparedSteps: final.preparedSteps, confirmedSteps: final.confirmedSteps };
      if (outcome.kind === 'confirmed') {
        validateOutcome(outcome, r.descriptor);
        if (final?.phase !== 'complete') throw new Error('Missing committed host outcome.');
      }
    } catch {
      outcome = { kind: 'unknown' };
    }
    const state = outcome.kind === 'confirmed' ? 'done' : 'unknown';
    if (state === r.state && hostHash(milestones) === hostHash(r.milestones)) return;
    const next = transition(
      r,
      state,
      milestones,
      outcome.kind === 'confirmed' ? outcome : undefined,
    );
    await save(r.revision, next); // A competing completion wins; never retry stale observations.
  };
  const admit = () => {
    if (!open || admitted >= maxActive) throw new HttpError(503, 'host job work capacity reached');
    admitted++;
  };
  const schedule = (record: HostJobRecord, execute: boolean) => {
    const task = Promise.resolve()
      .then(() => exclusive(() => observe(record, execute)))
      .catch(async () => {
        // Queue/storage failure is not an authoritative no-send receipt.
        try {
          await save(record.revision, transition(record, 'unknown'));
        } catch {
          /* protected journal retained */
        }
      })
      .finally(() => {
        releaseAdmission();
        tasks.delete(task);
      });
    tasks.add(task);
  };
  return {
    async accept(value: HostJobDescriptor): Promise<{ jobId: string }> {
      if (!open) return unavailable();
      let d: HostJobDescriptor;
      try {
        d = clone(value);
        validateHostJobDescriptor(d);
      } catch {
        throw new HttpError(400, 'invalid host job descriptor');
      }
      if (!samePins(d)) throw new HttpError(409, 'host job service pins differ');
      const id = hostJobId(d),
        hash = hostHash(d),
        existing = await read(id);
      if (existing) {
        if (existing.descriptorSha256 !== hash)
          throw new HttpError(409, 'host job input conflicts with the original intent');
        return { jobId: id };
      }
      const at = time(),
        milestones = { preparedSteps: 0, confirmedSteps: 0 };
      const record: HostJobRecord = {
        version: 1,
        revision: 0,
        id,
        descriptor: d,
        descriptorSha256: hash,
        createdAt: at,
        updatedAt: at,
        state: 'queued',
        policy: { eventLimit, completedTtlMs },
        milestones,
        eventSequence: 1,
        events: [{ sequence: 1, state: 'queued', at, ...milestones }],
      };
      if (!(await save(undefined, record))) {
        const raced = await read(id);
        if (!raced) return unavailable();
        if (raced.descriptorSha256 !== hash)
          throw new HttpError(409, 'host job input conflicts with the original intent');
      }
      return { jobId: id };
    },
    async get(id: string, after?: string) {
      const r = await read(id);
      return r ? view(r, after) : undefined;
    },
    async start(id: string): Promise<{ jobId: string }> {
      const r = await read(id);
      if (!r) throw new HttpError(404, 'host job not found');
      if (r.state !== 'queued') return { jobId: id };
      admit();
      let claimed = false;
      try {
        const next = transition(r, 'running');
        claimed = await save(r.revision, next);
        if (claimed) schedule(next, true);
      } finally {
        if (!claimed) releaseAdmission();
      }
      return { jobId: id };
    },
    async reconcile(id: string): Promise<{ jobId: string }> {
      const r = await read(id);
      if (!r) throw new HttpError(404, 'host job not found');
      if (r.state !== 'queued' && r.state !== 'done') {
        admit();
        schedule(r, false);
      }
      return { jobId: id };
    },
    stopAdmission() {
      open = false;
    },
    async drain() {
      if (admitted) await new Promise<void>((resolve) => drainWaiters.add(resolve));
    },
  };
}
