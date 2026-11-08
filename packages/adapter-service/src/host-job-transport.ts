import type { AbortSignalLike } from '@input-output-hk/mn-passport-protocol';
import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';
import { boundedJson } from './bounded-json.js';
import { trimBase } from './service-client.js';
import { fail } from './host-job-identity.js';
import { HOST_JOB_RESPONSE_BYTES_LIMIT } from './host-job-response-limit.js';

type Response = Awaited<ReturnType<FetchLike>>;
type Reader = ReturnType<NonNullable<Response['body']>['getReader']>;
interface ResponseOwner {
  response?: Response;
  reader?: Reader;
}
export interface HostJobTransportOptions {
  readonly base: string;
  readonly token: string;
  readonly fetch: FetchLike;
  readonly timeoutMs: number;
  readonly requestTimeoutMs: number;
}
function cancelBody(owner: ResponseOwner): void {
  try {
    const reader = owner.reader ?? owner.response?.body?.getReader();
    if (!reader) return;
    try {
      void reader.cancel().catch(() => undefined);
    } finally {
      reader.releaseLock();
    }
  } catch {
    /* Custom transports may be closed, locked, or ignore cancellation. */
  }
}
function requestLifetime(owner: ResponseOwner, milliseconds: number, signal?: AbortSignalLike) {
  const controller = new AbortController(),
    abort = () => controller.abort();
  let removeAbort = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    const stop = () => {
      cancelBody(owner);
      reject(Error('host request interrupted'));
    };
    controller.signal.addEventListener('abort', stop, { once: true });
    removeAbort = () => controller.signal.removeEventListener('abort', stop);
  });
  const timer = setTimeout(abort, milliseconds);
  signal?.addEventListener('abort', abort);
  if (signal?.aborted) abort();
  return {
    controller,
    interrupted,
    close() {
      removeAbort();
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
}
async function readResponse(response: Response, owner: ResponseOwner): Promise<unknown> {
  const body = response.body;
  return boundedJson(
    {
      ok: response.ok,
      status: response.status,
      json: () => response.json(),
      ...(response.headers && { headers: response.headers }),
      ...(body && {
        body: {
          getReader() {
            const reader = body.getReader();
            owner.reader = reader;
            return reader;
          },
        },
      }),
    },
    HOST_JOB_RESPONSE_BYTES_LIMIT,
  );
}
/** Native response streams are bounded before parsing. A structural json()-only transport
 * owns any allocation it performs; a deadline cannot forcibly stop arbitrary host promises. */
export function createHostJobTransport(options: HostJobTransportOptions) {
  return async (
    path: string,
    body: unknown,
    signal?: AbortSignalLike,
    deadline = performance.now() + options.timeoutMs,
  ): Promise<unknown> => {
    if (signal?.aborted || performance.now() >= deadline) return fail();
    const owner: ResponseOwner = {},
      lifetime = requestLifetime(
        owner,
        Math.min(options.requestTimeoutMs, Math.max(1, deadline - performance.now())),
        signal,
      );
    const check = () => {
      if (lifetime.controller.signal.aborted || signal?.aborted || performance.now() >= deadline) {
        cancelBody(owner);
        lifetime.controller.abort();
        return fail();
      }
    };
    const work = async () => {
      const response = await options.fetch(`${trimBase(options.base)}/v1/host-jobs/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${options.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: lifetime.controller.signal,
      });
      owner.response = response;
      check();
      // Discard protected error diagnostics; close their body without reading it.
      if (
        (body === undefined && response.status !== 200 && response.status !== 404) ||
        (body !== undefined && response.status !== 202)
      )
        return fail();
      if (response.status === 404) {
        cancelBody(owner);
        return undefined;
      }
      const answer = await readResponse(response, owner);
      check();
      return answer;
    };
    try {
      return await Promise.race([work(), lifetime.interrupted]);
    } catch {
      lifetime.controller.abort();
      cancelBody(owner);
      return fail();
    } finally {
      lifetime.close();
    }
  };
}
export type HostJobRequest = ReturnType<typeof createHostJobTransport>;
