import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import {
  asPassportErrorCode,
  PASSPORT_EVENT_PHASES,
  PASSPORT_STEPS,
  type PassportEvent,
} from '@input-output-hk/mn-passport-protocol';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export function jobRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value))
    throw new PassportConnectorError('InternalError', `${path} answered a non-object`);
  return value;
}
const record = jobRecord;
const isStep = (value: unknown): value is PassportEvent['step'] =>
  PASSPORT_STEPS.some((step) => step === value);
const isPhase = (value: unknown): value is PassportEvent['phase'] =>
  PASSPORT_EVENT_PHASES.some((phase) => phase === value);

/** Emit only the protocol's public progress fields from an untrusted HTTP answer. */
function eventOf(value: unknown): PassportEvent {
  const item = record(value, 'job event');
  if (
    typeof item.id !== 'string' ||
    typeof item.flowId !== 'string' ||
    typeof item.at !== 'number' ||
    !Number.isFinite(item.at) ||
    item.clock !== 'service' ||
    !isStep(item.step) ||
    !isPhase(item.phase)
  )
    throw new PassportConnectorError('InternalError', 'job answered an invalid progress event');
  const detail = item.detail === undefined ? undefined : record(item.detail, 'job event detail');
  const error = item.error === undefined ? undefined : record(item.error, 'job event error');
  if (error && (typeof error.code !== 'string' || typeof error.message !== 'string'))
    throw new PassportConnectorError('InternalError', 'job answered an invalid progress error');
  return {
    id: item.id,
    flowId: item.flowId,
    step: item.step,
    phase: item.phase,
    at: item.at,
    clock: 'service',
    ...(typeof item.durationMs === 'number' ? { durationMs: item.durationMs } : {}),
    ...(detail === undefined
      ? {}
      : {
          detail: {
            ...(typeof detail.wave === 'number' ? { wave: detail.wave } : {}),
            ...(typeof detail.of === 'number' ? { of: detail.of } : {}),
            ...(typeof detail.queuePosition === 'number'
              ? { queuePosition: detail.queuePosition }
              : {}),
            ...(typeof detail.circuit === 'string' ? { circuit: detail.circuit } : {}),
            ...(typeof detail.txId === 'string' ? { txId: detail.txId } : {}),
          },
        }),
    ...(error === undefined
      ? {}
      : { error: { code: asPassportErrorCode(error.code), message: String(error.message) } }),
  };
}

export function acceptedJob(value: unknown, path: string): string {
  const { jobId } = jobRecord(value, path);
  if (typeof jobId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(jobId))
    throw new PassportConnectorError('InternalError', `${path} answered an invalid job id`);
  return jobId;
}
export type JobBatch = { cursor: string; events: PassportEvent[] } & (
  | { state: 'queued' | 'running' }
  | { state: 'done'; result: Record<string, unknown> }
  | { state: 'failed'; error: PassportConnectorError }
);
/** Validate the entire state/cursor/event batch before any observer can consume it. */
export function decodeJob(value: unknown, path: string, cursor: string): JobBatch {
  const job = jobRecord(value, path);
  const { cursor: nextCursor, events, state } = job;
  if (
    typeof nextCursor !== 'string' ||
    !/^(0|[1-9][0-9]*)$/.test(nextCursor) ||
    !Array.isArray(events)
  )
    throw new PassportConnectorError('InternalError', `${path} answered an invalid job`);
  const next = Number(nextCursor);
  if (!Number.isSafeInteger(next) || next - Number(cursor) !== events.length)
    throw new PassportConnectorError('InternalError', `${path} answered an invalid cursor`);
  const projected: PassportEvent[] = [];
  for (let index = 0; index < events.length; index++) projected.push(eventOf(events[index]));
  const base = { cursor: nextCursor, events: projected };
  if (state === 'done') return { ...base, state, result: jobRecord(job.result, `${path} result`) };
  if (state === 'failed') {
    const error = jobRecord(job.error, `${path} error`);
    if (typeof error.message !== 'string')
      throw new PassportConnectorError('InternalError', `${path} answered an invalid error`);
    return {
      ...base,
      state,
      error: new PassportConnectorError(asPassportErrorCode(error.code), error.message),
    };
  }
  if (state !== 'queued' && state !== 'running')
    throw new PassportConnectorError('InternalError', `${path} answered an unknown job state`);
  return { ...base, state };
}
