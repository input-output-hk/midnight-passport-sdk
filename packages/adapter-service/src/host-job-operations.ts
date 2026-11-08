import type { AbortSignalLike } from '@input-output-hk/mn-passport-protocol';
import type {
  RemoteHostJobIdentity,
  RemoteHostJobInput,
  RemoteHostJobOptions,
  RemoteHostJobSnapshot,
} from './host-jobs.js';
import type { HostJobRequest } from './host-job-transport.js';
import {
  cursor,
  fail,
  fields,
  identityCheck,
  identityHashes,
  inputCheck,
  samePins,
} from './host-job-identity.js';
import { checkedSnapshot } from './host-job-snapshot.js';
import { observeHostJobSnapshot, pauseHostJob } from './host-job-observer.js';
export interface HostJobOperations {
  readonly request: HostJobRequest;
  readonly pins: RemoteHostJobIdentity['pins'];
  readonly timeoutMs: number;
  readonly delay: number;
  readonly observer: RemoteHostJobOptions['onSnapshot'];
}
export function checkedJobIdentity(
  context: HostJobOperations,
  identity: RemoteHostJobIdentity,
): RemoteHostJobIdentity {
  const captured = { ...identity, pins: { ...identity.pins } };
  identityCheck(captured);
  if (!samePins(captured.pins, context.pins)) return fail();
  return captured;
}
export async function getRemoteHostJob(
  context: HostJobOperations,
  identity: RemoteHostJobIdentity,
  signal?: AbortSignalLike,
  after?: string,
  deadline?: number,
) {
  const captured = checkedJobIdentity(context, identity),
    hashes = await identityHashes(captured);
  if (after !== undefined && !cursor(after)) return fail();
  const value = await context.request(
    hashes.jobId + (after === undefined ? '' : `?after=${after}`),
    undefined,
    signal,
    deadline,
  );
  return value === undefined ? undefined : checkedSnapshot(value, captured, hashes, after);
}
export async function actRemoteHostJob(
  context: HostJobOperations,
  operation: 'start' | 'reconcile',
  identity: RemoteHostJobIdentity,
  signal?: AbortSignalLike,
  deadline?: number,
) {
  const captured = checkedJobIdentity(context, identity),
    hashes = await identityHashes(captured),
    answer = await context.request(operation, hashes, signal, deadline);
  if (!fields(answer, ['jobId']) || answer.jobId !== hashes.jobId) return fail();
  return { jobId: hashes.jobId };
}
export async function retainedRemoteHostJob(
  context: HostJobOperations,
  identity: RemoteHostJobIdentity,
  signal?: AbortSignalLike,
  deadline?: number,
) {
  const captured = checkedJobIdentity(context, identity),
    hashes = await identityHashes(captured),
    value = await context.request('result', hashes, signal, deadline),
    snapshot = checkedSnapshot(value, captured, hashes);
  if (snapshot.state !== 'done' || !snapshot.outcome) return fail();
  return snapshot;
}
export async function acceptRemoteHostJob(
  context: HostJobOperations,
  identity: RemoteHostJobIdentity,
  input: RemoteHostJobInput,
  signal?: AbortSignalLike,
  deadline?: number,
) {
  const captured = checkedJobIdentity(context, identity),
    protectedInput = { ...input };
  inputCheck(captured, protectedInput);
  const hashes = await identityHashes(captured),
    answer = await context.request(
      'accept',
      { version: 1, identity: captured, input: protectedInput },
      signal,
      deadline,
    );
  if (!fields(answer, ['jobId']) || answer.jobId !== hashes.jobId) return fail();
  return { jobId: hashes.jobId };
}
function checkProgress(
  previous: RemoteHostJobSnapshot | undefined,
  snapshot: RemoteHostJobSnapshot,
): void {
  if (
    previous &&
    (Number(snapshot.cursor) < Number(previous.cursor) ||
      snapshot.milestones.preparedSteps < previous.milestones.preparedSteps ||
      snapshot.milestones.confirmedSteps < previous.milestones.confirmedSteps ||
      (previous.state !== 'queued' && snapshot.state === 'queued'))
  )
    return fail();
}
export async function waitRemoteHostJob(
  context: HostJobOperations,
  identity: RemoteHostJobIdentity,
  signal?: AbortSignalLike,
  deadline = performance.now() + context.timeoutMs,
) {
  const captured = checkedJobIdentity(context, identity);
  let previous: RemoteHostJobSnapshot | undefined;
  while (true) {
    const snapshot = await getRemoteHostJob(context, captured, signal, undefined, deadline);
    if (!snapshot) return undefined;
    checkProgress(previous, snapshot);
    previous = snapshot;
    await observeHostJobSnapshot(snapshot, context.observer, deadline, signal);
    if (snapshot.state === 'expired')
      return retainedRemoteHostJob(context, captured, signal, deadline);
    if (snapshot.state === 'done' || snapshot.state === 'unknown') return snapshot;
    try {
      await pauseHostJob(
        Math.min(context.delay, Math.max(0, deadline - performance.now())),
        signal,
      );
    } catch {
      return fail();
    }
  }
}
export async function executeRemoteHostJob(
  context: HostJobOperations,
  identity: RemoteHostJobIdentity,
  input: RemoteHostJobInput,
  signal?: AbortSignalLike,
) {
  const deadline = performance.now() + context.timeoutMs,
    captured = checkedJobIdentity(context, identity);
  await acceptRemoteHostJob(context, captured, input, signal, deadline);
  await actRemoteHostJob(context, 'start', captured, signal, deadline);
  return waitRemoteHostJob(context, captured, signal, deadline);
}
export async function resumeRemoteHostJob(
  context: HostJobOperations,
  identity: RemoteHostJobIdentity,
  signal?: AbortSignalLike,
) {
  const deadline = performance.now() + context.timeoutMs,
    captured = checkedJobIdentity(context, identity),
    snapshot = await getRemoteHostJob(context, captured, signal, undefined, deadline);
  if (!snapshot || snapshot.state === 'done') return snapshot;
  if (snapshot.state === 'expired')
    return retainedRemoteHostJob(context, captured, signal, deadline);
  await actRemoteHostJob(
    context,
    snapshot.state === 'queued' ? 'start' : 'reconcile',
    captured,
    signal,
    deadline,
  );
  return waitRemoteHostJob(context, captured, signal, deadline);
}
