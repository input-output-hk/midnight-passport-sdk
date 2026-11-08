import { hostCanonical, hostHash, validateHostIdentity } from './host-mutations.js';
import type { HostMutationOutcome } from './host-mutations.js';
import type { HostJobDescriptor, HostJobRecord, HostJobMilestones } from './host-jobs.js';
type Confirmed = Extract<HostMutationOutcome, { kind: 'confirmed' }>;
const HEX = /^[0-9a-f]{64}$/;
const WATCH = /^(?:[0-9a-f]{64}|[0-9a-f]{66})$/;
export const HOST_JOB_INPUT_LIMIT = 4 * 1024 * 1024;
export function hostJobFailure(): never {
  throw new Error('Invalid or unavailable host job.');
}
export const whole = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0;
export const fields = (
  v: unknown,
  allowed: string[],
  required = allowed,
): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).every((key) => allowed.includes(key)) &&
  required.every((key) => Object.hasOwn(v, key));
export const cloneHostJob = <T>(value: T): T => {
  hostCanonical(value);
  return structuredClone(value);
};
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
  validateHostJobInput(d);
}
function validateHostJobInput(d: HostJobDescriptor): void {
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
/** New admission policy only. Historical descriptors retain their readable original identity. */
export function validateHostJobArm(d: HostJobDescriptor): void {
  if (d.identity.kind !== 'deploy') return;
  const expected = d.identity.pins.scheme === 'p256-webauthn' ? 'p256' : 'jubjub';
  if (
    !fields(d.input, ['boot', 'encKey', 'retireAuthority', 'firstArm']) ||
    d.input.firstArm !== expected
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
export function validateOutcome(o: Confirmed, d: HostJobDescriptor): void {
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
  validateHostJobEvents(r);
  validateHostJobCompletion(r);
}

function validateHostJobEvents(r: HostJobRecord): void {
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
      typeof e.state !== 'string' ||
      !['queued', 'running', 'unknown', 'done'].includes(e.state) ||
      !whole(e.preparedSteps) ||
      !whole(e.confirmedSteps) ||
      !validMilestones({ preparedSteps: e.preparedSteps, confirmedSteps: e.confirmedSteps })
    )
      hostJobFailure();
  });
  const last = r.events.at(-1);
  if (!last) hostJobFailure();
  if (
    last.state !== r.state ||
    last.preparedSteps !== r.milestones.preparedSteps ||
    last.confirmedSteps !== r.milestones.confirmedSteps
  )
    hostJobFailure();
}

function validateHostJobCompletion(r: HostJobRecord): void {
  if (r.state === 'done') {
    const outcome = r.outcome;
    if (
      !outcome ||
      !whole(r.finishedAt) ||
      r.finishedAt !== r.updatedAt ||
      !r.milestones.preparedSteps ||
      r.milestones.preparedSteps !== r.milestones.confirmedSteps
    )
      hostJobFailure();
    validateOutcome(outcome, r.descriptor);
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
