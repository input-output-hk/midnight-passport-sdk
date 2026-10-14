import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';
import type { ServiceWire } from '@input-output-hk/mn-passport-protocol';
import { defaultFetch, trimBase } from './service-client.js';

const DECIMAL = /^[1-9][0-9]*$/;

export interface FaucetClientOptions {
  readonly fetch?: FetchLike;
  /** Inject a fresh caller credential on each request; the library does not retain secrets. */
  readonly headers: () => Promise<Record<string, string>>;
  readonly timeoutMs?: number;
}

export class FaucetClientError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FaucetClientError';
    this.status = status;
  }
}

export interface FaucetClient {
  /** The caller owns the UUID so retries use exactly the same idempotency key. */
  fund(request: ServiceWire.FundAccRequest): Promise<ServiceWire.FundAccResponse>;
}

/** Backend-to-backend client for the isolated ACC funding route. */
export function remoteFaucet(base: string, options: FaucetClientOptions): FaucetClient {
  const fetchFn = options.fetch ?? defaultFetch;
  return {
    async fund(request) {
      let response;
      try {
        const headers = await options.headers();
        response = await fetchFn(`${trimBase(base)}/v1/faucet/fund`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify(request),
          ...(options.timeoutMs === undefined
            ? {}
            : { signal: AbortSignal.timeout(options.timeoutMs) }),
        });
      } catch (cause) {
        throw new FaucetClientError(0, 'funding service is unreachable', { cause });
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new FaucetClientError(response.status, 'funding service answered invalid JSON');
      }
      if (!response.ok) {
        const error =
          typeof body === 'object' &&
          body !== null &&
          'error' in body &&
          typeof body.error === 'string'
            ? body.error
            : `funding request failed: HTTP ${response.status}`;
        throw new FaucetClientError(response.status, error);
      }
      if (
        !body ||
        typeof body !== 'object' ||
        !('requestId' in body) ||
        body.requestId !== request.requestId ||
        !('txId' in body) ||
        typeof body.txId !== 'string' ||
        body.txId.length === 0 ||
        !('creditedBalance' in body) ||
        typeof body.creditedBalance !== 'string' ||
        !DECIMAL.test(body.creditedBalance)
      )
        throw new FaucetClientError(response.status, 'funding service answered an invalid result');
      return body as ServiceWire.FundAccResponse;
    },
  };
}
