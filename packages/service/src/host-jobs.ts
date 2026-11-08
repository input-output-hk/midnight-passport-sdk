import type {
  HostJson,
  HostMutationIdentity,
  HostMutationOutcome,
  createHostMutationExecutor,
} from './host-mutations.js';
import type { serial } from './queue.js';
import { createHostJobRuntime } from './host-job-runtime.js';
import { createHostJobActions } from './host-job-actions.js';
export {
  HOST_JOB_INPUT_LIMIT,
  hostJobFailure,
  hostJobId,
  validateHostJobId,
  validateHostJobDescriptor,
  validateHostJobRecord,
  validateHostJobUpdate,
} from './host-job-validation.js';

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
  /** Binds status/explicit continuation to the full public mutation identity. */
  readonly identitySha256: string;
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
/** Async status over retained host work. No scanner, callback replay or automatic restart. */
export function createHostMutationJobs(
  store: HostJobStore,
  executor: HostJobExecutor,
  options: HostJobOptions,
) {
  return createHostJobActions(createHostJobRuntime(store, executor, options));
}
