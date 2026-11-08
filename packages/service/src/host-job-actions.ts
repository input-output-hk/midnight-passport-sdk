import { HttpError } from './http.js';
import { hostHash } from './host-mutations.js';
import {
  cloneHostJob,
  hostJobId,
  validateHostJobDescriptor,
  validateHostJobArm,
} from './host-job-validation.js';
import { hostJobView, transitionHostJob } from './host-job-state.js';
import { unavailableHostJob, type HostJobRuntime } from './host-job-runtime.js';
import type { HostJobDescriptor, HostJobRecord } from './host-jobs.js';

const HEX = /^[0-9a-f]{64}$/;
async function acceptHostJob(runtime: HostJobRuntime, value: HostJobDescriptor) {
  runtime.work.checkOpen();
  let descriptor: HostJobDescriptor;
  try {
    descriptor = cloneHostJob(value);
    validateHostJobDescriptor(descriptor);
    validateHostJobArm(descriptor);
  } catch {
    throw new HttpError(400, 'invalid host job descriptor');
  }
  if (!runtime.policy.samePins(descriptor))
    throw new HttpError(409, 'host job service pins differ');
  const id = hostJobId(descriptor),
    hash = hostHash(descriptor),
    existing = await runtime.records.read(id);
  if (existing) {
    if (existing.descriptorSha256 !== hash)
      throw new HttpError(409, 'host job input conflicts with the original intent');
    return { jobId: id };
  }
  const at = runtime.policy.time(),
    milestones = { preparedSteps: 0, confirmedSteps: 0 };
  const record: HostJobRecord = {
    version: 1,
    revision: 0,
    id,
    descriptor,
    descriptorSha256: hash,
    createdAt: at,
    updatedAt: at,
    state: 'queued',
    policy: {
      eventLimit: runtime.policy.eventLimit,
      completedTtlMs: runtime.policy.completedTtlMs,
    },
    milestones,
    eventSequence: 1,
    events: [{ sequence: 1, state: 'queued', at, ...milestones }],
  };
  if (!(await runtime.records.save(undefined, record))) {
    const raced = await runtime.records.read(id);
    if (!raced) return unavailableHostJob();
    if (raced.descriptorSha256 !== hash)
      throw new HttpError(409, 'host job input conflicts with the original intent');
  }
  return { jobId: id };
}
async function readBoundHostJob(
  runtime: HostJobRuntime,
  id: string,
  expectedIdentitySha256?: string,
) {
  const record = await runtime.records.read(id);
  if (!record) throw new HttpError(404, 'host job not found');
  if (
    expectedIdentitySha256 !== undefined &&
    expectedIdentitySha256 !== hostHash(record.descriptor.identity)
  )
    throw new HttpError(409, 'host job identity conflicts with the original intent');
  return record;
}
async function startHostJob(runtime: HostJobRuntime, id: string, expectedIdentitySha256?: string) {
  const record = await readBoundHostJob(runtime, id, expectedIdentitySha256);
  if (record.state !== 'queued') return { jobId: id };
  runtime.work.admit();
  let claimed = false;
  try {
    const next = transitionHostJob(record, 'running', runtime.policy.time());
    claimed = await runtime.records.save(record.revision, next);
    if (claimed) runtime.schedule(next, true);
  } finally {
    if (!claimed) runtime.work.release();
  }
  return { jobId: id };
}
async function reconcileHostJob(
  runtime: HostJobRuntime,
  id: string,
  expectedIdentitySha256?: string,
) {
  const record = await readBoundHostJob(runtime, id, expectedIdentitySha256);
  if (record.state !== 'queued' && record.state !== 'done' && !runtime.work.activeIds.has(id)) {
    runtime.work.admit();
    runtime.schedule(record, false);
  }
  return { jobId: id };
}
async function retainedHostJob(
  runtime: HostJobRuntime,
  id: string,
  expectedIdentitySha256: string,
) {
  const record = await readBoundHostJob(runtime, id, expectedIdentitySha256);
  if (!HEX.test(expectedIdentitySha256))
    throw new HttpError(409, 'host job identity conflicts with the original intent');
  if (record.state !== 'done') throw new HttpError(409, 'host job result is not confirmed');
  return hostJobView(record, runtime.policy.time, undefined, true);
}
export function createHostJobActions(runtime: HostJobRuntime) {
  return {
    accept: (value: HostJobDescriptor) => acceptHostJob(runtime, value),
    async get(id: string, after?: string) {
      const record = await runtime.records.read(id);
      return record ? hostJobView(record, runtime.policy.time, after) : undefined;
    },
    result: (id: string, expectedIdentitySha256: string) =>
      retainedHostJob(runtime, id, expectedIdentitySha256),
    start: (id: string, expectedIdentitySha256?: string) =>
      startHostJob(runtime, id, expectedIdentitySha256),
    reconcile: (id: string, expectedIdentitySha256?: string) =>
      reconcileHostJob(runtime, id, expectedIdentitySha256),
    stopAdmission: runtime.work.stopAdmission,
    drain: runtime.work.drain,
  };
}
