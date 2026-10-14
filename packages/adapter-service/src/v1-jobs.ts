import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';
import {
  asPassportErrorCode,
  PASSPORT_EVENT_PHASES,
  PASSPORT_STEPS,
  type AbortSignalLike,
  type PassportEvent,
} from '@input-output-hk/mn-passport-protocol';
import type { RemoteOptions } from './options.js';
import { defaultFetch, serviceFailure, trimBase, type ServiceRole } from './service-client.js';

export interface V1RemoteOptions extends RemoteOptions {
  /** Delay between polls; defaults to 250 ms. Zero is useful for a local test server. */
  readonly pollIntervalMs?: number;
}

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new PassportConnectorError('InternalError', `${path} answered a non-object`);
  return value as Record<string, unknown>;
};

async function bodyOf(response: { json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

const aborted = (signal?: AbortSignalLike): void => {
  if (signal?.aborted) throw new PassportConnectorError('Aborted', 'The service job was aborted.');
};

async function pause(ms: number, signal?: AbortSignalLike): Promise<void> {
  aborted(signal);
  if (ms === 0) return;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new PassportConnectorError('Aborted', 'The service job was aborted.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort);
    if (signal?.aborted) onAbort();
  });
}

/** Emit only the protocol's public progress fields from an untrusted HTTP answer. */
function eventOf(value: unknown): PassportEvent {
  const item = record(value, 'job event');
  if (
    typeof item.id !== 'string' ||
    typeof item.flowId !== 'string' ||
    typeof item.at !== 'number' ||
    !Number.isFinite(item.at) ||
    item.clock !== 'service' ||
    !PASSPORT_STEPS.includes(item.step as PassportEvent['step']) ||
    !PASSPORT_EVENT_PHASES.includes(item.phase as PassportEvent['phase'])
  )
    throw new PassportConnectorError('InternalError', 'job answered an invalid progress event');
  const detail = item.detail === undefined ? undefined : record(item.detail, 'job event detail');
  const error = item.error === undefined ? undefined : record(item.error, 'job event error');
  if (error && (typeof error.code !== 'string' || typeof error.message !== 'string'))
    throw new PassportConnectorError('InternalError', 'job answered an invalid progress error');
  return {
    id: item.id,
    flowId: item.flowId,
    step: item.step as PassportEvent['step'],
    phase: item.phase as PassportEvent['phase'],
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
      : { error: { code: asPassportErrorCode(error.code), message: error.message as string } }),
  };
}

/** Submit a v1 long-running request and poll its cursor until a result or error arrives. */
export async function requestV1Job(
  base: string,
  path: '/v1/prove-tx' | '/v1/deploy',
  request: unknown,
  role: ServiceRole,
  options: V1RemoteOptions = {},
  signal?: AbortSignalLike,
  onEvent?: (event: PassportEvent) => void,
): Promise<Record<string, unknown>> {
  const timeoutMs = options.timeoutMs ?? 600_000;
  const pollIntervalMs = options.pollIntervalMs ?? 250;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 0
  )
    throw new Error('invalid v1 service polling limits');
  const deadline = Date.now() + timeoutMs;
  const fetchFn: FetchLike = options.fetch ?? defaultFetch;
  const requestOnce = async (url: string, init?: Parameters<FetchLike>[1]) => {
    aborted(signal);
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new PassportConnectorError(
        role === 'prover' ? 'ProverUnavailable' : 'SponsorRejected',
        `${path}: job timed out`,
      );
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => controller.abort(), remaining);
    let response;
    let body;
    try {
      response = await fetchFn(url, { ...init, signal: controller.signal });
      body = await bodyOf(response);
    } catch (cause) {
      aborted(signal);
      if (controller.signal.aborted || Date.now() >= deadline)
        throw new PassportConnectorError(
          role === 'prover' ? 'ProverUnavailable' : 'SponsorRejected',
          `${path}: job timed out`,
          { cause },
        );
      throw new PassportConnectorError(
        role === 'prover' ? 'ProverUnavailable' : 'SponsorRejected',
        `${path}: service unreachable`,
        { cause },
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
    aborted(signal);
    if (controller.signal.aborted)
      throw new PassportConnectorError(
        role === 'prover' ? 'ProverUnavailable' : 'SponsorRejected',
        `${path}: job timed out`,
      );
    return { status: response.status, body };
  };

  const started = await requestOnce(`${trimBase(base)}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    ...(signal ? { signal } : {}),
  });
  const accepted = started.body;
  if (started.status !== 202) throw serviceFailure(role, started.status, accepted, path);
  const jobId = record(accepted, path).jobId;
  if (typeof jobId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(jobId))
    throw new PassportConnectorError('InternalError', `${path} answered an invalid job id`);

  let cursor = '0';
  while (true) {
    const pollPath = `/v1/jobs/${jobId}?after=${encodeURIComponent(cursor)}`;
    const response = await requestOnce(
      `${trimBase(base)}${pollPath}`,
      signal ? { signal } : undefined,
    );
    const answer = response.body;
    if (response.status !== 200) throw serviceFailure(role, response.status, answer, pollPath);
    const job = record(answer, pollPath);
    if (
      typeof job.cursor !== 'string' ||
      !/^(0|[1-9][0-9]*)$/.test(job.cursor) ||
      !Array.isArray(job.events)
    )
      throw new PassportConnectorError('InternalError', `${pollPath} answered an invalid job`);
    const next = Number(job.cursor);
    if (!Number.isSafeInteger(next) || next - Number(cursor) !== job.events.length)
      throw new PassportConnectorError('InternalError', `${pollPath} answered an invalid cursor`);
    for (const event of job.events) onEvent?.(eventOf(event));
    cursor = job.cursor;
    if (job.state === 'done') return record(job.result, `${pollPath} result`);
    if (job.state === 'failed') {
      const error = record(job.error, `${pollPath} error`);
      if (typeof error.message !== 'string')
        throw new PassportConnectorError('InternalError', `${pollPath} answered an invalid error`);
      throw new PassportConnectorError(asPassportErrorCode(error.code), error.message);
    }
    if (job.state !== 'queued' && job.state !== 'running')
      throw new PassportConnectorError(
        'InternalError',
        `${pollPath} answered an unknown job state`,
      );
    await pause(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())), signal);
  }
}
