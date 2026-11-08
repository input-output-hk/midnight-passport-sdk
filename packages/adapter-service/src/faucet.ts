import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';
import type { ServiceWire } from '@input-output-hk/mn-passport-protocol';
import { defaultFetch, trimBase } from './service-client.js';
import { validTimer } from './transport-lifetime.js';
import { FaucetClientError, fundingRequest } from './faucet-codec.js';
import { observeFunding } from './faucet-transport.js';
export { FaucetClientError } from './faucet-codec.js';

export interface FaucetClientOptions {
  readonly fetch?: FetchLike;
  /** Inject a fresh caller credential on each request; the library does not retain secrets. */
  readonly headers: () => Promise<Record<string, string>>;
  readonly timeoutMs?: number;
}
export interface FaucetClient {
  /** The caller owns the UUID so retries use exactly the same idempotency key. */
  fund(request: ServiceWire.FundAccRequest): Promise<ServiceWire.FundAccResponse>;
}

/** Backend-to-backend client. Snapshot intent before credentials; never retry a POST. */
export function remoteFaucet(base: string, options: FaucetClientOptions): FaucetClient {
  const fetchFn = options.fetch ?? defaultFetch,
    timeoutMs = options.timeoutMs;
  const readHeaders = options.headers,
    receiver = options;
  const transport = {
    fetch: fetchFn,
    url: `${trimBase(base)}/v1/faucet/fund`,
    headers: () => readHeaders.call(receiver),
  };
  return {
    async fund(request) {
      const started = performance.now();
      if (timeoutMs !== undefined && !validTimer(timeoutMs, 1))
        throw new FaucetClientError(0, 'invalid funding timeout');
      const deadline = timeoutMs === undefined ? undefined : started + timeoutMs;
      let captured: ServiceWire.FundAccRequest;
      try {
        captured = fundingRequest(request);
      } catch {
        throw new FaucetClientError(0, 'invalid funding request');
      }
      const body = JSON.stringify(captured);
      return observeFunding(transport, captured.requestId, body, deadline);
    },
  };
}
