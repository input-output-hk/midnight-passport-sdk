import { HttpError } from './http.js';
import { hostHash } from './host-mutations.js';
import { cloneHostJob, hostJobFailure, whole } from './host-job-validation.js';
import type { HostJobRecord, HostJobMilestones, HostJobState, HostJobView } from './host-jobs.js';

export function transitionHostJob(
  record: HostJobRecord,
  state: HostJobState,
  at: number,
  milestones: HostJobMilestones = record.milestones,
  outcome?: HostJobRecord['outcome'],
): HostJobRecord {
  const updatedAt = Math.max(at, record.updatedAt),
    sequence = record.eventSequence + 1;
  return {
    ...record,
    revision: record.revision + 1,
    state,
    milestones,
    updatedAt,
    eventSequence: sequence,
    events: [...record.events, { sequence, state, at: updatedAt, ...milestones }].slice(
      -record.policy.eventLimit,
    ),
    ...(outcome && { outcome, finishedAt: updatedAt }),
  };
}

export function hostJobView(
  record: HostJobRecord,
  time: () => number,
  after?: string,
  retainedResult = false,
): HostJobView {
  const initial = record.events[0];
  if (!initial) return hostJobFailure();
  const first = initial.sequence - 1;
  if (
    after !== undefined &&
    (!/^(0|[1-9][0-9]*)$/.test(after) ||
      !whole(Number(after)) ||
      Number(after) > record.eventSequence)
  )
    throw new HttpError(400, 'invalid host job cursor');
  if (after !== undefined && Number(after) < first)
    throw new HttpError(410, 'host job cursor expired; read a fresh snapshot');
  const finishedAt = record.finishedAt;
  if (record.state === 'done' && finishedAt === undefined) return hostJobFailure();
  const expired =
    !retainedResult &&
    record.state === 'done' &&
    finishedAt !== undefined &&
    time() - finishedAt >= record.policy.completedTtlMs;
  return cloneHostJob({
    jobId: record.id,
    identitySha256: hostHash(record.descriptor.identity),
    state: expired ? 'expired' : record.state,
    milestones: record.milestones,
    events: expired ? [] : record.events.filter((event) => event.sequence > Number(after ?? first)),
    cursor: String(record.eventSequence),
    firstCursor: String(first),
    ...(!expired && record.outcome && { outcome: record.outcome }),
    ...(record.state === 'unknown' && {
      error: {
        code: 'MutationUnsettled',
        message: 'Host job is unsettled; retain the original identity and reconcile.',
      },
    }),
  });
}
