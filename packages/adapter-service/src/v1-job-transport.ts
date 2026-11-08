import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';
import { responseOwner } from './response-owner.js';
import { type TransportLifetime, TransportInterrupted } from './transport-lifetime.js';
import type { ServiceRole } from './service-client.js';

/** Distinguishes retryable header transport failure from body/protocol errors. */
export class JobTransportFailure extends PassportConnectorError {}
export function jobInterruption(role: ServiceRole, path: string, error: unknown): never {
  if (error instanceof TransportInterrupted)
    throw new PassportConnectorError(
      error.reason === 'aborted'
        ? 'Aborted'
        : role === 'prover'
          ? 'ProverUnavailable'
          : 'SponsorRejected',
      error.reason === 'aborted' ? 'The service job was aborted.' : `${path}: job timed out`,
      { cause: error },
    );
  throw error;
}
export async function readJobResponse(
  fetchFn: FetchLike,
  url: string,
  lifetime: TransportLifetime,
  role: ServiceRole,
  path: string,
  init?: Parameters<FetchLike>[1],
): Promise<{ status: number; body: unknown }> {
  lifetime.check();
  const owner = responseOwner(lifetime.signal);
  const work = async () => {
    let response;
    try {
      response = await fetchFn(url, { ...init, signal: lifetime.signal });
    } catch (cause) {
      lifetime.check();
      throw new JobTransportFailure(
        role === 'prover' ? 'ProverUnavailable' : 'SponsorRejected',
        `${path}: service unreachable`,
        { cause },
      );
    }
    owner.adopt(response);
    lifetime.check();
    const status = response.status;
    let body: unknown;
    try {
      body = await owner.json();
    } catch {
      lifetime.check();
      // Unreadable JSON keeps the existing HTTP/status or invalid-answer taxonomy.
      body = undefined;
    }
    lifetime.check();
    return { status, body };
  };
  try {
    return await lifetime.observe(work());
  } finally {
    owner.dispose();
  }
}
