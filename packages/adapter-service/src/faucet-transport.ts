import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';
import type { ServiceWire } from '@input-output-hk/mn-passport-protocol';
import { responseOwner } from './response-owner.js';
import {
  transportLifetime,
  TransportInterrupted,
  type TransportLifetime,
} from './transport-lifetime.js';
import { FaucetClientError, fundingFailure, fundingResponse } from './faucet-codec.js';

interface FundingTransport {
  readonly fetch: FetchLike;
  readonly headers: () => Promise<Record<string, string>>;
  readonly url: string;
}
/** No hidden lifetime in the unset branch. Explicit observations include fresh credentials,
 * body decoding and projection. No retry, default body cap, or remote cancellation claim. */
export async function observeFunding(
  options: FundingTransport,
  requestId: string,
  body: string,
  deadline?: number,
): Promise<ServiceWire.FundAccResponse> {
  let lifetime: TransportLifetime | undefined;
  let owner: ReturnType<typeof responseOwner> | undefined;
  let status: number | undefined;
  let ok: boolean | undefined;
  let stage: 'transport' | 'body' | 'result' = 'transport';
  const work = async () => {
    const fresh = await options.headers();
    lifetime?.check();
    const headers = { ...fresh, 'content-type': 'application/json' };
    lifetime?.check();
    const fetchFn = options.fetch;
    const current = await fetchFn(options.url, {
      method: 'POST',
      headers,
      body,
      ...(lifetime && { signal: lifetime.signal }),
    });
    owner?.adopt(current);
    lifetime?.check();
    status = current.status;
    ok = current.ok;
    stage = 'body';
    lifetime?.check();
    const value: unknown = owner ? await owner.json() : await current.json();
    lifetime?.check();
    stage = 'result';
    if (!ok) throw fundingFailure(status, value);
    const result = fundingResponse(value, requestId, status);
    lifetime?.check();
    return result;
  };
  try {
    if (deadline !== undefined) {
      lifetime = transportLifetime(deadline);
      owner = responseOwner(lifetime.signal);
    }
    return await (lifetime ? lifetime.observe(work()) : work());
  } catch (error) {
    let primary = error;
    try {
      lifetime?.check();
    } catch (interrupted) {
      primary = interrupted;
    }
    if (stage === 'transport')
      throw new FaucetClientError(0, 'funding service is unreachable', { cause: primary });
    if (stage === 'body' || primary instanceof TransportInterrupted)
      throw new FaucetClientError(status ?? 0, 'funding service answered invalid JSON');
    if (primary instanceof FaucetClientError) throw primary;
    throw new FaucetClientError(status ?? 0, 'funding service answered an invalid result');
  } finally {
    owner?.dispose();
    lifetime?.close();
  }
}
