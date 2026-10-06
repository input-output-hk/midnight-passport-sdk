import { PassportConnectorError, type FetchLike } from '@midnight-ntwrk/mn-passport-account';

/** What `GET /config` answers (apps/passport-service routes/zk.ts, plus the sponsor's keys). */
export interface ServiceConfigWire {
  readonly networkId: string;
  readonly bindingId: string;
  readonly manifestSha256: string;
  readonly indexerUri: string;
  readonly indexerWsUri: string;
  readonly nodeUri: string;
  readonly zkBaseUrl: string;
  readonly coinPublicKey: string;
  readonly encryptionPublicKey: string;
}

// The structural `signal` is a real `AbortSignal` whenever the adapter made it, so the cast only
// restores the DOM type the structural FetchLike dropped.
export const defaultFetch: FetchLike = (url, init) => fetch(url, init as RequestInit | undefined);

/** Strips trailing slashes, so `${base}/path` never doubles one. */
export const trimBase = (base: string): string => base.replace(/\/+$/, '');

/**
 * Which half of the service an endpoint belongs to, which decides how a refusal is named: the
 * proving endpoints (`/prove`, `/check`) fail as `ProverUnavailable`, the fee-sponsoring ones
 * (`/sponsor/*`, `/deploy`) as `SponsorRejected`.
 */
export type ServiceRole = 'prover' | 'sponsor';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

async function readBody(res: { json(): Promise<unknown> }): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined; // a proxy's HTML error page, say; the status alone then speaks
  }
}

/** The server's `{error}` text when it sent one, else a status line. */
function messageOf(body: unknown, what: string, status: number): string {
  const text = isRecord(body) ? body.error : undefined;
  return typeof text === 'string' && text.length > 0 ? text : `${what} failed: HTTP ${status}`;
}

/**
 * Maps a refused request to the connector taxonomy by HTTP status (Ruling R16(b)).
 *
 * - prover: a 5xx (the service answers 502 for a prover fault and 503 for a full queue) is
 *   `ProverUnavailable`; a 4xx (400 malformed, 403 not this binding's circuit) is a defect in this
 *   adapter, so `InternalError`.
 * - sponsor: 403 (policy refusal), 429 (deployment cap) and any 5xx (a failed or busy sponsor) are
 *   `SponsorRejected`; any other 4xx is `InternalError`.
 */
export function serviceFailure(
  role: ServiceRole,
  status: number,
  body: unknown,
  what: string,
): PassportConnectorError {
  const message = messageOf(body, what, status);
  if (role === 'prover') {
    return new PassportConnectorError(
      status >= 500 ? 'ProverUnavailable' : 'InternalError',
      message,
    );
  }
  const rejected = status === 403 || status === 429 || status >= 500;
  return new PassportConnectorError(rejected ? 'SponsorRejected' : 'InternalError', message);
}

/**
 * POSTs a JSON body to the service and returns the 200 answer's object. Any other status, an
 * unreadable answer or an unreachable service throws a `PassportConnectorError`.
 */
export async function postService(
  fetchFn: FetchLike,
  base: string,
  path: string,
  body: unknown,
  role: ServiceRole,
  /** Gives up on a request that has not answered by then; the abort reads as an unreachable service. */
  timeoutMs?: number,
): Promise<Record<string, unknown>> {
  let res;
  try {
    res = await fetchFn(`${trimBase(base)}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
    });
  } catch (cause) {
    // No answer at all: only the prover has a named code for "not there"; for the sponsor this is
    // a transport fault, not a refusal.
    const timedOut =
      timeoutMs !== undefined && cause instanceof Error && cause.name === 'TimeoutError';
    throw new PassportConnectorError(
      role === 'prover' ? 'ProverUnavailable' : 'InternalError',
      timedOut
        ? `${path}: no answer within ${timeoutMs} ms`
        : `${path}: the service is unreachable`,
      { cause },
    );
  }
  const answer = await readBody(res);
  if (res.status !== 200) throw serviceFailure(role, res.status, answer, path);
  if (!isRecord(answer)) {
    throw new PassportConnectorError(
      'InternalError',
      `${path} answered a body that is not an object`,
    );
  }
  return answer;
}

/** Reads a string member of a service answer, or fails with `InternalError`. */
export function stringMember(answer: Record<string, unknown>, name: string, what: string): string {
  const value = answer[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new PassportConnectorError('InternalError', `${what} answered no "${name}"`);
  }
  return value;
}

export async function fetchServiceConfig(
  base: string,
  fetchFn: FetchLike,
  networkId: string,
): Promise<ServiceConfigWire> {
  let res;
  try {
    res = await fetchFn(`${trimBase(base)}/config`);
  } catch (cause) {
    throw new PassportConnectorError('InternalError', 'service /config is unreachable', { cause });
  }
  if (!res.ok)
    throw new PassportConnectorError('InternalError', `service /config failed: ${res.status}`);
  const config = await readBody(res);
  if (!isRecord(config)) {
    throw new PassportConnectorError(
      'InternalError',
      'service /config answered a body that is not an object',
    );
  }
  // The network is checked first: a service on another network is the more useful thing to say.
  if (config.networkId !== networkId) {
    throw new PassportConnectorError(
      'NetworkMismatch',
      `service is on ${String(config.networkId)}, connector is bound to ${networkId}`,
    );
  }
  const text = (field: keyof ServiceConfigWire): string => {
    const value = config[field];
    if (typeof value !== 'string') {
      throw new PassportConnectorError('InternalError', `service /config has no "${field}"`);
    }
    return value;
  };
  return {
    networkId: text('networkId'),
    bindingId: text('bindingId'),
    manifestSha256: text('manifestSha256'),
    indexerUri: text('indexerUri'),
    indexerWsUri: text('indexerWsUri'),
    nodeUri: text('nodeUri'),
    zkBaseUrl: text('zkBaseUrl'),
    coinPublicKey: text('coinPublicKey'),
    encryptionPublicKey: text('encryptionPublicKey'),
  };
}
