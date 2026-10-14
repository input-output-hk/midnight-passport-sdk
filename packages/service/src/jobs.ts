import { randomUUID } from 'node:crypto';
import type {
  PassportErrorCode,
  PassportEvent,
  ServiceWire,
} from '@input-output-hk/mn-passport-protocol';
import { HttpError, json, type Route } from './http.js';

interface StoredJob {
  state: ServiceWire.Job<unknown>['state'];
  events: PassportEvent[];
  result?: unknown;
  error?: { code: PassportErrorCode; message: string };
  finishedAt?: number;
}

export interface JobStore {
  /** Accept work now; the caller can poll before the work begins. */
  start<Result>(
    work: (emit: (event: PassportEvent) => void) => Promise<Result>,
    errorOf?: (cause: unknown) => { code: PassportErrorCode; message: string },
  ): ServiceWire.JobAccepted;
  /** Return only events after an opaque cursor, with the full current outcome. */
  get<Result = unknown>(id: string, after?: string): ServiceWire.Job<Result> | undefined;
}

export interface JobStoreOptions {
  /** Upper bound across running and retained completed jobs. */
  readonly maxJobs?: number;
  /** Completed jobs expire after this many milliseconds; use a durable store across restarts. */
  readonly completedTtlMs?: number;
  readonly now?: () => number;
  /** A host may inject a predictable id generator for tests, but production uses random UUIDs. */
  readonly newId?: () => string;
  /** Sanitize a backend failure into the public protocol error. */
  readonly errorOf?: (cause: unknown) => { code: PassportErrorCode; message: string };
}

/** A bounded, process-local reference store. Operators can inject durable JobStore implementations. */
export function createMemoryJobStore(options: JobStoreOptions = {}): JobStore {
  const maxJobs = options.maxJobs ?? 128;
  const ttl = options.completedTtlMs ?? 10 * 60_000;
  if (!Number.isSafeInteger(maxJobs) || maxJobs < 1 || !Number.isSafeInteger(ttl) || ttl < 0)
    throw new Error('invalid job-store limits');
  const now = options.now ?? Date.now;
  const newId = options.newId ?? randomUUID;
  const errorOf = options.errorOf ?? (() => ({ code: 'InternalError', message: 'job failed' }));
  const jobs = new Map<string, StoredJob>();

  const publicEvent = (event: PassportEvent): PassportEvent => ({
    id: event.id,
    flowId: event.flowId,
    step: event.step,
    phase: event.phase,
    at: event.at,
    clock: 'service',
    ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
    ...(event.detail === undefined
      ? {}
      : {
          detail: {
            ...(event.detail.wave === undefined ? {} : { wave: event.detail.wave }),
            ...(event.detail.of === undefined ? {} : { of: event.detail.of }),
            ...(event.detail.queuePosition === undefined
              ? {}
              : { queuePosition: event.detail.queuePosition }),
            ...(event.detail.circuit === undefined ? {} : { circuit: event.detail.circuit }),
            ...(event.detail.txId === undefined ? {} : { txId: event.detail.txId }),
          },
        }),
    ...(event.error === undefined
      ? {}
      : { error: { code: event.error.code, message: event.error.message } }),
  });

  const prune = () => {
    for (const [id, job] of jobs) {
      if (job.finishedAt !== undefined && now() - job.finishedAt >= ttl) jobs.delete(id);
    }
  };

  return {
    start(work, jobErrorOf) {
      prune();
      if (jobs.size >= maxJobs) throw new HttpError(503, 'job store is full');
      const id = newId();
      if (!/^[A-Za-z0-9-]{1,128}$/.test(id) || jobs.has(id))
        throw new Error('invalid or repeated job id');
      const job: StoredJob = { state: 'queued', events: [] };
      jobs.set(id, job);
      void Promise.resolve().then(async () => {
        job.state = 'running';
        try {
          job.result = await work((event) => {
            if (job.state === 'running') job.events.push(publicEvent(event));
          });
          job.state = 'done';
        } catch (cause) {
          try {
            job.error = (jobErrorOf ?? errorOf)(cause);
          } catch {
            job.error = { code: 'InternalError', message: 'job failed' };
          }
          job.state = 'failed';
        } finally {
          job.finishedAt = now();
        }
      });
      return { jobId: id };
    },
    get<Result>(id: string, after?: string): ServiceWire.Job<Result> | undefined {
      prune();
      const job = jobs.get(id);
      if (!job) return undefined;
      if (after !== undefined && !/^(0|[1-9][0-9]*)$/.test(after))
        throw new HttpError(400, 'invalid job cursor');
      const offset = after === undefined ? 0 : Number(after);
      if (!Number.isSafeInteger(offset) || offset > job.events.length)
        throw new HttpError(400, 'invalid job cursor');
      return {
        state: job.state,
        events: job.events.slice(offset),
        cursor: String(job.events.length),
        ...(job.state === 'done' ? { result: job.result as Result } : {}),
        ...(job.state === 'failed' ? { error: job.error } : {}),
      };
    },
  };
}

/** GET /v1/jobs/{id}?after={cursor}; compose beside the versioned work routes. */
export function jobsRoute(store: JobStore): Route {
  return async (req, res, url) => {
    const match = /^\/v1\/jobs\/([A-Za-z0-9-]{1,128})$/.exec(url.pathname);
    if (!match || req.method !== 'GET') return false;
    if (
      [...url.searchParams.keys()].some((key) => key !== 'after') ||
      url.searchParams.getAll('after').length > 1
    )
      throw new HttpError(400, 'invalid job cursor');
    const job = store.get(match[1]!, url.searchParams.get('after') ?? undefined);
    if (!job) throw new HttpError(404, 'job not found');
    json(res, 200, job);
    return true;
  };
}
