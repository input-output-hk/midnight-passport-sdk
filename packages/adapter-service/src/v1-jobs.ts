import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';
import type { AbortSignalLike, PassportEvent } from '@input-output-hk/mn-passport-protocol';
import type { RemoteOptions } from './options.js';
import { defaultFetch, serviceFailure, trimBase, type ServiceRole } from './service-client.js';
import { acceptedJob, decodeJob } from './v1-job-codec.js';
import { JobTransportFailure, jobInterruption, readJobResponse } from './v1-job-transport.js';
import { transportLifetime, validTimer, type TransportLifetime } from './transport-lifetime.js';

export interface V1RemoteOptions extends RemoteOptions {
  /** Delay between polls; defaults to 250 ms. Zero is useful for a local test server. */
  readonly pollIntervalMs?: number;
}

function emitBatch(
  events: readonly PassportEvent[],
  observer: ((event: PassportEvent) => void) | undefined,
  lifetime: TransportLifetime,
): void {
  for (const event of events) {
    lifetime.check();
    if (observer) {
      // Preserve synchronous callback ordering; consume async rejection without awaiting it.
      // Host JS cannot be preempted, and an async observer is not part of job completion.
      const result: unknown = observer(event);
      void Promise.resolve(result).catch(() => undefined);
    }
    lifetime.check();
  }
}

/** Submit once and poll the original cursor under one total observation deadline.
 * Generic V1 results retain their existing unbounded size contract. */
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
  const fetchFn: FetchLike = options.fetch ?? defaultFetch;
  if (!validTimer(timeoutMs, 1) || !validTimer(pollIntervalMs, 0))
    throw new Error('invalid v1 service polling limits');
  const deadline = performance.now() + timeoutMs;
  const body = JSON.stringify(request);
  const url = trimBase(base);
  let lifetime: TransportLifetime | undefined;
  try {
    lifetime = transportLifetime(deadline, signal);
    const started = await readJobResponse(fetchFn, `${url}${path}`, lifetime, role, path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    if (started.status !== 202) throw serviceFailure(role, started.status, started.body, path);
    const jobId = acceptedJob(started.body, path);
    let cursor = '0',
      transientPollFailures = 0;
    while (true) {
      lifetime.check();
      const pollPath = `/v1/jobs/${jobId}?after=${encodeURIComponent(cursor)}`;
      let response;
      try {
        response = await readJobResponse(fetchFn, `${url}${pollPath}`, lifetime, role, path);
        transientPollFailures = 0;
      } catch (error) {
        // Retry only header transport failure: the original POST is never replayed.
        if (!(error instanceof JobTransportFailure) || ++transientPollFailures > 3) throw error;
        await lifetime.pause(250 * 2 ** (transientPollFailures - 1));
        continue;
      }
      if (response.status !== 200)
        throw serviceFailure(role, response.status, response.body, pollPath);
      const batch = decodeJob(response.body, pollPath, cursor);
      lifetime.check();
      emitBatch(batch.events, onEvent, lifetime);
      cursor = batch.cursor;
      if (batch.state === 'done') return batch.result;
      if (batch.state === 'failed') throw batch.error;
      await lifetime.pause(pollIntervalMs);
    }
  } catch (error) {
    return jobInterruption(role, path, error);
  } finally {
    lifetime?.close();
  }
}
