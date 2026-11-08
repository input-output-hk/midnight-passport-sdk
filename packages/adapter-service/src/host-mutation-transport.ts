import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';
import type { TransportLifetime } from './transport-lifetime.js';
import { responseOwner } from './response-owner.js';
import {
  decodeMutationOutcome,
  mutationFailure,
  MUTATION_OUTCOME_BYTES_LIMIT,
  type MutationIdentity,
  type RemoteOutcome,
} from './host-mutation-outcome.js';

export interface MutationTransport {
  readonly base: string;
  readonly token: string;
  readonly fetch: FetchLike;
}
/** One POST observation. Failure is never retried; reconciliation remains a caller decision. */
export async function mutationRequest(
  options: MutationTransport,
  path: 'execute' | 'reconcile',
  body: string,
  identity: MutationIdentity,
  lifetime: TransportLifetime,
): Promise<RemoteOutcome> {
  lifetime.check();
  const owner = responseOwner(lifetime.signal),
    fetchFn = options.fetch;
  const work = async () => {
    const response = await fetchFn(`${options.base}/v1/mutations/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.token}` },
      body,
      signal: lifetime.signal,
    });
    owner.adopt(response);
    lifetime.check();
    if (response.status !== 200) return mutationFailure();
    const value = await owner.json(MUTATION_OUTCOME_BYTES_LIMIT);
    lifetime.check();
    const answer = decodeMutationOutcome(value, identity);
    lifetime.check();
    return answer;
  };
  try {
    return await lifetime.observe(work());
  } finally {
    owner.dispose();
  }
}
