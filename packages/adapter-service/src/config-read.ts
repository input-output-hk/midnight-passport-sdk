import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';
import { boundedJson } from './bounded-json.js';

type Response = Awaited<ReturnType<FetchLike>>;
type Reader = ReturnType<NonNullable<Response['body']>['getReader']>;
export const CONFIG_BYTES_LIMIT = 65_536;
export const CONFIG_TIMEOUT_MS = 30_000;

function cancelBody(response: Response | undefined, active?: Reader): void {
  try {
    const reader = active ?? response?.body?.getReader();
    if (!reader) return;
    try {
      void reader.cancel().catch(() => undefined);
    } finally {
      reader.releaseLock();
    }
  } catch {
    /* Best effort: a custom transport may already be closed or ignore cancellation. */
  }
}

/**
 * One optional 1..600000 ms deadline covers headers and JSON. Checked config APIs
 * supply a 30s default; legacy three-argument discovery retains its unset deadline.
 * Native streams are bounded before parsing. Custom json() owns its allocation limit;
 * the deadline rejects promptly but cannot forcibly stop an uncooperative transport.
 */
export async function readConfigJson(
  fetchFn: FetchLike,
  url: string,
  path: '/config' | '/v1/config',
  timeoutMs?: number,
): Promise<unknown> {
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)
  )
    throw new PassportConnectorError('InternalError', 'Invalid configuration read timeout.');
  const controller = new AbortController();
  let response: Response | undefined;
  let reader: Reader | undefined;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = () =>
    new PassportConnectorError('InternalError', `service ${path} exceeded its read timeout`);
  const deadline =
    timeoutMs === undefined
      ? undefined
      : new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            expired = true;
            controller.abort();
            cancelBody(response, reader);
            reject(timeout());
          }, timeoutMs);
        });
  const work = async () => {
    try {
      response = await fetchFn(
        url,
        timeoutMs === undefined ? undefined : { signal: controller.signal },
      );
    } catch (cause) {
      if (expired) throw timeout();
      throw new PassportConnectorError('InternalError', `service ${path} is unreachable`, {
        cause,
      });
    }
    const current = response;
    if (expired) {
      cancelBody(current);
      throw timeout();
    }
    if (!current.ok) {
      cancelBody(current);
      throw new PassportConnectorError(
        'InternalError',
        `service ${path} failed: ${current.status}`,
      );
    }
    try {
      const bodySource = current.body;
      const body = await boundedJson(
        {
          ok: current.ok,
          status: current.status,
          json: () => current.json(),
          ...(current.headers && { headers: current.headers }),
          ...(bodySource && {
            body: {
              getReader() {
                reader = bodySource.getReader();
                return reader;
              },
            },
          }),
        },
        CONFIG_BYTES_LIMIT,
      );
      if (expired) throw timeout();
      return body;
    } catch (cause) {
      if (expired) throw timeout();
      throw new PassportConnectorError(
        'InternalError',
        path === '/config'
          ? 'service /config answered a body that is not an object'
          : 'service /v1/config answered invalid JSON',
        { cause },
      );
    }
  };
  try {
    return await (deadline ? Promise.race([work(), deadline]) : work());
  } finally {
    clearTimeout(timer);
  }
}
