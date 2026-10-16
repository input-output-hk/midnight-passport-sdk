import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';
import { defaultFetch } from '@input-output-hk/mn-passport-adapter-service';

/** Public, shareable details only. Never pass a passkey result, seed, PRF output or bearer token. */
export interface OperationTraceEntry {
  readonly at: string;
  readonly kind: string;
  readonly details: Record<string, unknown>;
}

let sink: ((entry: OperationTraceEntry) => void) | undefined;

export function setOperationTraceSink(listener: (entry: OperationTraceEntry) => void): void {
  sink = listener;
}

export function traceOperation(kind: string, details: Record<string, unknown>): void {
  sink?.({ at: new Date().toISOString(), kind, details });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A fixed allowlist prevents request bodies and service responses from leaking into evidence. */
export function publicFields(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const out: Record<string, unknown> = {};
  for (const key of [
    'networkId',
    'bindingId',
    'manifestSha256',
    'accountAddress',
    'address',
    'status',
    'state',
    'scheme',
    'firstArm',
    'retireAuthority',
    'requestId',
    'color',
    'amount',
    'creditedBalance',
    'night',
    'fundedAsset',
    'jobId',
    'cursor',
    'txId',
  ]) {
    const field = value[key];
    if (typeof field === 'string' || typeof field === 'number' || typeof field === 'boolean')
      out[key] = field;
  }
  if (Array.isArray(value.txIds) && value.txIds.every((id) => typeof id === 'string'))
    out.txIds = value.txIds;
  if (Array.isArray(value.events)) out.eventCount = value.events.length;
  for (const key of ['tx', 'boot', 'encKey']) {
    const bytes = value[key];
    if (typeof bytes === 'string' && /^[0-9a-f]*$/i.test(bytes))
      out[`${key}Bytes`] = bytes.length / 2;
  }
  if (isRecord(value.result)) out.result = publicFields(value.result);
  if (isRecord(value.asset)) out.asset = publicFields(value.asset);
  if (isRecord(value.balances)) out.balances = publicFields(value.balances);
  if (isRecord(value.error) && typeof value.error.code === 'string')
    out.errorCode = value.error.code;
  return out;
}

function safePath(raw: string): string {
  const url = new URL(raw, typeof location === 'undefined' ? 'http://localhost' : location.origin);
  // The URL contains a credential ID on directory calls. Its presence matters; its value does not.
  return url.pathname
    .replace(/(\/v1\/accounts\/[^/]+\/)[^/]+$/, '$1:credential')
    .replace(/(\/accounts\/[^/]+\/)[^/]+$/, '$1:credential');
}

/** Trace the HTTP seam used by the connector, without copying large transactions or secrets. */
export const tracedFetch: FetchLike = async (url, init) => {
  const method = init?.method ?? 'GET';
  const path = safePath(url);
  const started = Date.now();
  let request: unknown;
  if (init?.body) {
    try {
      request = JSON.parse(init.body);
    } catch {
      request = undefined;
    }
  }
  traceOperation('http.request', { method, path, body: publicFields(request) });
  try {
    const response = await defaultFetch(url, init);
    traceOperation('http.response', {
      method,
      path,
      status: response.status,
      durationMs: Date.now() - started,
    });
    return {
      ok: response.ok,
      status: response.status,
      async json() {
        const body = await response.json();
        traceOperation('http.response.body', { method, path, body: publicFields(body) });
        return body;
      },
    };
  } catch (error) {
    traceOperation('http.error', {
      method,
      path,
      durationMs: Date.now() - started,
      errorName: error instanceof Error ? error.name : 'Error',
    });
    throw error;
  }
};
