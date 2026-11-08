import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';
import { toHex } from './hex.js';
import { postService, serviceFailure, trimBase } from './service-client.js';
import { transportLifetime, TransportInterrupted, validTimer } from './transport-lifetime.js';
import { responseOwner } from './response-owner.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const transportError = (path: string, timeoutMs: number, cause: unknown) =>
  new PassportConnectorError(
    'InternalError',
    cause instanceof TransportInterrupted ||
      (cause instanceof Error && cause.name === 'TimeoutError')
      ? `${path}: no answer within ${timeoutMs} ms`
      : `${path}: the service is unreachable`,
    { cause },
  );

/** Only an explicitly configured sponsor timeout changes the legacy observation contract.
 * Native streams are owned without a new size cap. Custom JSON allocation and blocking JS
 * remain host-owned; expiry cannot undo a send or authorize another POST. */
export async function requestV1Sponsor<T>(
  fetchFn: FetchLike,
  base: string,
  path: '/v1/sponsor/balance' | '/v1/sponsor/submit',
  transaction: Uint8Array,
  timeoutMs: number | undefined,
  project: (answer: Record<string, unknown>) => T,
): Promise<T> {
  if (timeoutMs === undefined)
    return project(await postService(fetchFn, base, path, { tx: toHex(transaction) }, 'sponsor'));
  if (!validTimer(timeoutMs, 1))
    throw new PassportConnectorError('InternalError', 'Invalid v1 sponsor timeout.');
  const deadline = performance.now() + timeoutMs;
  // Capture wire bytes and URL synchronously before any transport work can yield.
  const body = JSON.stringify({ tx: toHex(transaction) }),
    url = `${trimBase(base)}${path}`;
  let lifetime: ReturnType<typeof transportLifetime>;
  try {
    lifetime = transportLifetime(deadline);
  } catch (cause) {
    throw transportError(path, timeoutMs, cause);
  }
  const owner = responseOwner(lifetime.signal);
  let status: number | undefined;
  const work = async () => {
    lifetime.check();
    let response;
    try {
      response = await fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: lifetime.signal,
      });
    } catch (cause) {
      throw transportError(path, timeoutMs, cause);
    }
    owner.adopt(response);
    lifetime.check();
    status = response.status;
    let answer: unknown;
    try {
      answer = await owner.json();
    } catch {
      lifetime.check();
      answer = undefined;
    }
    lifetime.check();
    if (status !== 200) throw serviceFailure('sponsor', status, answer, path);
    if (!isRecord(answer))
      throw new PassportConnectorError(
        'InternalError',
        `${path} answered a body that is not an object`,
      );
    const result = project(answer);
    lifetime.check();
    return result;
  };
  try {
    return await lifetime.observe(work());
  } catch (error) {
    let primary = error;
    try {
      lifetime.check();
    } catch (interrupted) {
      primary = interrupted;
    }
    if (primary instanceof TransportInterrupted) {
      // An already admitted refusal keeps its status when optional diagnostics stall.
      if (status !== undefined && status !== 200)
        throw serviceFailure('sponsor', status, undefined, path);
      throw transportError(path, timeoutMs, primary);
    }
    throw primary;
  } finally {
    owner.dispose();
    lifetime.close();
  }
}
