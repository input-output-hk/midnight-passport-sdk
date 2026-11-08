import { HttpError } from './http.js';
import { serial } from './queue.js';
import { hostHash, validateHostIdentity, type HostMutationOutcome } from './host-mutations.js';
import {
  cloneHostJob,
  fields,
  hostJobFailure,
  validateHostJobId,
  validateHostJobRecord,
  validateOutcome,
  whole,
} from './host-job-validation.js';
import { transitionHostJob } from './host-job-state.js';
import type {
  HostJobDescriptor,
  HostJobExecutor,
  HostJobOptions,
  HostJobRecord,
  HostJobStore,
} from './host-jobs.js';

export const unavailableHostJob = (): never => {
  throw new HttpError(503, 'host job unavailable; retain the original identity');
};

function jobPolicy(options: HostJobOptions) {
  const pins = cloneHostJob(options.pins);
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
  const eventLimit = options.eventLimit ?? 32,
    completedTtlMs = options.completedTtlMs ?? 600000,
    maxActive = options.maxActive ?? 8;
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
  const now = options.now ?? Date.now;
  return {
    pins,
    eventLimit,
    completedTtlMs,
    maxActive,
    exclusive: options.runExclusive ?? serial(maxActive - 1),
    time() {
      const at = now();
      if (!whole(at)) return unavailableHostJob();
      return at;
    },
    samePins(descriptor: HostJobDescriptor) {
      return (
        descriptor.identity.pins.networkId === pins.networkId &&
        descriptor.identity.pins.bindingId === pins.bindingId &&
        descriptor.identity.pins.manifestSha256 === pins.manifestSha256
      );
    },
  };
}

function jobRecords(store: HostJobStore, policy: ReturnType<typeof jobPolicy>) {
  return {
    async read(id: string) {
      try {
        validateHostJobId(id);
      } catch {
        throw new HttpError(400, 'invalid host job ID');
      }
      try {
        const record = await store.read(id);
        if (record) {
          validateHostJobRecord(record);
          if (record.id !== id || !policy.samePins(record.descriptor)) return unavailableHostJob();
        }
        return record;
      } catch {
        return unavailableHostJob();
      }
    },
    async save(expected: number | undefined, next: HostJobRecord) {
      try {
        validateHostJobRecord(next);
        return await store.compareAndSwap(expected, next);
      } catch {
        return unavailableHostJob();
      }
    },
  };
}

async function observeHostJob(
  record: HostJobRecord,
  execute: boolean,
  executor: HostJobExecutor,
  records: ReturnType<typeof jobRecords>,
  time: () => number,
) {
  let outcome: HostMutationOutcome = { kind: 'unknown' },
    milestones = record.milestones;
  try {
    const status = await executor.inspect(record.descriptor.identity);
    if (
      status &&
      (status.preparedSteps < milestones.preparedSteps ||
        status.confirmedSteps < milestones.confirmedSteps)
    )
      throw Error('Host journal regressed.');
    if (execute)
      outcome = await executor.execute(record.descriptor.identity, record.descriptor.input);
    else if (status)
      outcome = await executor.resume(record.descriptor.identity, {
        expectedInputSha256: hostHash(record.descriptor.input),
      });
    const final = await executor.inspect(record.descriptor.identity);
    if (
      final &&
      final.preparedSteps >= milestones.preparedSteps &&
      final.confirmedSteps >= milestones.confirmedSteps
    )
      milestones = { preparedSteps: final.preparedSteps, confirmedSteps: final.confirmedSteps };
    if (outcome.kind === 'confirmed') {
      validateOutcome(outcome, record.descriptor);
      if (final?.phase !== 'complete') throw Error('Missing committed host outcome.');
    }
  } catch {
    outcome = { kind: 'unknown' };
  }
  const state = outcome.kind === 'confirmed' ? 'done' : 'unknown';
  if (state === record.state && hostHash(milestones) === hostHash(record.milestones)) return;
  await records.save(
    record.revision,
    transitionHostJob(
      record,
      state,
      time(),
      milestones,
      outcome.kind === 'confirmed' ? outcome : undefined,
    ),
  );
}

function jobAdmission(maxActive: number) {
  let open = true,
    admitted = 0;
  const activeIds = new Set<string>(),
    drainWaiters = new Set<() => void>();
  return {
    activeIds,
    checkOpen() {
      if (!open) return unavailableHostJob();
    },
    admit() {
      if (!open || admitted >= maxActive)
        throw new HttpError(503, 'host job work capacity reached');
      admitted++;
    },
    release() {
      admitted--;
      if (admitted === 0) {
        for (const resolve of drainWaiters) resolve();
        drainWaiters.clear();
      }
    },
    stopAdmission() {
      open = false;
    },
    async drain() {
      if (admitted) await new Promise<void>((resolve) => drainWaiters.add(resolve));
    },
  };
}

export function createHostJobRuntime(
  store: HostJobStore,
  executor: HostJobExecutor,
  options: HostJobOptions,
) {
  const policy = jobPolicy(options),
    records = jobRecords(store, policy),
    work = jobAdmission(policy.maxActive);
  const exclusive = policy.exclusive;
  const schedule = (record: HostJobRecord, execute: boolean) => {
    work.activeIds.add(record.id);
    void Promise.resolve()
      .then(() => exclusive(() => observeHostJob(record, execute, executor, records, policy.time)))
      .catch(async () => {
        // A custom queue may throw after entering work. Never infer no send or retry execution.
        try {
          if (record.state !== 'unknown')
            await records.save(
              record.revision,
              transitionHostJob(record, 'unknown', policy.time()),
            );
        } catch {
          /* Protected journal retained. */
        }
      })
      .finally(() => {
        work.release();
        work.activeIds.delete(record.id);
      });
  };
  return { policy, records, work, schedule };
}
export type HostJobRuntime = ReturnType<typeof createHostJobRuntime>;
