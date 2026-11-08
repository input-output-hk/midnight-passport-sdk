import { HEX, WATCH, cursor, fail, fields, whole } from './host-job-identity.js';
import type {
  RemoteHostJobEvent,
  RemoteHostJobIdentity,
  RemoteHostJobOutcome,
  RemoteHostJobSnapshot,
  RemoteHostJobState,
} from './host-jobs.js';
import type { identityHashes } from './host-job-identity.js';

type Milestones = RemoteHostJobSnapshot['milestones'];
function jobState(value: unknown): RemoteHostJobState {
  if (
    value === 'queued' ||
    value === 'running' ||
    value === 'unknown' ||
    value === 'done' ||
    value === 'expired'
  )
    return value;
  return fail();
}
function eventState(value: unknown): RemoteHostJobEvent['state'] {
  const state = jobState(value);
  return state === 'expired' ? fail() : state;
}
function milestones(value: unknown, max: number): Milestones {
  if (!fields(value, ['preparedSteps', 'confirmedSteps'])) return fail();
  const preparedSteps = value.preparedSteps,
    confirmedSteps = value.confirmedSteps;
  if (
    !whole(preparedSteps) ||
    !whole(confirmedSteps) ||
    preparedSteps > max ||
    confirmedSteps > preparedSteps
  )
    return fail();
  return { preparedSteps, confirmedSteps };
}
function eventTail(values: unknown[], start: number, max: number): RemoteHostJobEvent[] {
  let previousAt = 0,
    previousPrepared = 0,
    previousConfirmed = 0;
  return values.map((value, n) => {
    if (!fields(value, ['sequence', 'state', 'at', 'preparedSteps', 'confirmedSteps']))
      return fail();
    const sequence = value.sequence,
      at = value.at,
      progress = milestones(
        { preparedSteps: value.preparedSteps, confirmedSteps: value.confirmedSteps },
        max,
      );
    if (
      !whole(sequence) ||
      sequence !== start + n + 1 ||
      !whole(at) ||
      at < previousAt ||
      progress.preparedSteps < previousPrepared ||
      progress.confirmedSteps < previousConfirmed
    )
      return fail();
    previousAt = at;
    previousPrepared = progress.preparedSteps;
    previousConfirmed = progress.confirmedSteps;
    return { sequence, state: eventState(value.state), at, ...progress };
  });
}
function callResult(value: unknown): Extract<RemoteHostJobOutcome['result'], { txHash: string }> {
  if (!fields(value, ['txHash', 'submissionId', 'blockHeight'], ['txHash', 'submissionId']))
    return fail();
  const txHash = value.txHash,
    submissionId = value.submissionId,
    blockHeight = value.blockHeight;
  if (
    typeof txHash !== 'string' ||
    !HEX.test(txHash) ||
    typeof submissionId !== 'string' ||
    !WATCH.test(submissionId) ||
    (blockHeight !== undefined && !whole(blockHeight))
  )
    return fail();
  return { txHash, submissionId, ...(blockHeight === undefined ? {} : { blockHeight }) };
}
const watchId = (value: unknown): value is string => typeof value === 'string' && WATCH.test(value);
function deployResult(
  value: unknown,
): Extract<RemoteHostJobOutcome['result'], { address: string }> {
  if (!fields(value, ['address', 'txIds'])) return fail();
  const address = value.address,
    txIds = value.txIds;
  if (
    typeof address !== 'string' ||
    !HEX.test(address) ||
    !Array.isArray(txIds) ||
    !txIds.length ||
    txIds.length > 64 ||
    new Set(txIds).size !== txIds.length ||
    !txIds.every(watchId)
  )
    return fail();
  return { address, txIds: [...txIds] };
}
function stateOutcome(
  value: Record<string, unknown>,
  state: RemoteHostJobState,
  progress: Milestones,
  identity: RemoteHostJobIdentity,
): RemoteHostJobOutcome | undefined {
  if (state === 'unknown') {
    if (
      !fields(value.error, ['code', 'message']) ||
      value.error.code !== 'MutationUnsettled' ||
      value.error.message !== 'Host job is unsettled; retain the original identity and reconcile.'
    )
      return fail();
  } else if (value.error !== undefined) return fail();
  if (state !== 'done') {
    if (value.outcome !== undefined) return fail();
    return undefined;
  }
  const outcome = value.outcome;
  if (
    !progress.preparedSteps ||
    progress.preparedSteps !== progress.confirmedSteps ||
    !fields(outcome, ['kind', 'digest', 'result']) ||
    outcome.kind !== 'confirmed' ||
    outcome.digest !== identity.intentSha256
  )
    return fail();
  return {
    kind: 'confirmed',
    digest: identity.intentSha256,
    result: identity.kind === 'deploy' ? deployResult(outcome.result) : callResult(outcome.result),
  };
}
function snapshotEnvelope(value: unknown, expected: Awaited<ReturnType<typeof identityHashes>>) {
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
    !cursor(value.cursor) ||
    !cursor(value.firstCursor) ||
    Number(value.firstCursor) > Number(value.cursor) ||
    Number(value.cursor) < 1 ||
    !Array.isArray(value.events) ||
    value.events.length > 256
  )
    return fail();
  return {
    value,
    state: jobState(value.state),
    cursor: value.cursor,
    firstCursor: value.firstCursor,
    rawEvents: value.events,
  };
}
function snapshotEvents(
  envelope: ReturnType<typeof snapshotEnvelope>,
  after: string | undefined,
  max: number,
  progress: Milestones,
) {
  const start = Number(after ?? envelope.firstCursor);
  if (start < Number(envelope.firstCursor) || start > Number(envelope.cursor)) return fail();
  if (envelope.state === 'expired') {
    if (
      envelope.rawEvents.length ||
      envelope.value.outcome !== undefined ||
      envelope.value.error !== undefined
    )
      return fail();
    return [];
  }
  if (envelope.rawEvents.length !== Number(envelope.cursor) - start) return fail();
  const events = eventTail(envelope.rawEvents, start, max),
    last = events.at(-1);
  if (
    last &&
    (last.state !== envelope.state ||
      last.preparedSteps !== progress.preparedSteps ||
      last.confirmedSteps !== progress.confirmedSteps)
  )
    return fail();
  return events;
}
export function checkedSnapshot(
  value: unknown,
  identity: RemoteHostJobIdentity,
  expected: Awaited<ReturnType<typeof identityHashes>>,
  after?: string,
): RemoteHostJobSnapshot {
  const envelope = snapshotEnvelope(value, expected),
    max = identity.kind === 'call' ? 1 : 64,
    progress = milestones(envelope.value.milestones, max);
  const events = snapshotEvents(envelope, after, max, progress);
  if (
    envelope.state === 'queued' &&
    (Number(envelope.cursor) !== 1 || progress.preparedSteps !== 0)
  )
    return fail();
  const outcome = stateOutcome(envelope.value, envelope.state, progress, identity);
  return {
    jobId: expected.jobId,
    identitySha256: expected.identitySha256,
    state: envelope.state,
    milestones: progress,
    events,
    cursor: envelope.cursor,
    firstCursor: envelope.firstCursor,
    ...(outcome && { outcome }),
  };
}
