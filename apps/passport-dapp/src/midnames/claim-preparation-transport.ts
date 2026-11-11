import { isClaimSponsorOrigin } from './claim-dispatch.js';
import { claimReceiptLimit } from './claim-receipt.js';
import { claimOwnerProof, type ClaimPreparation } from './claim-quote.js';

export const claimQuotePath = '/v1/midnames/claim/quote';
export const claimPreparePath = '/v1/midnames/claim/prepare';
export const claimPreparedPath = '/v1/midnames/claim/prepared';

async function request(path: string, input: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    mode: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status === 202 || response.status === 404) return undefined;
  if (!response.ok || !response.body)
    throw new Error('The local claim sponsor refused the request.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return JSON.parse(text + decoder.decode()) as unknown;
      size += next.value.byteLength;
      if (size > claimReceiptLimit) throw new Error('The local sponsor reply is too large.');
      text += decoder.decode(next.value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** The prover stays on the owner side. Only proved transaction bytes cross this transport. */
export function createLocalClaimPreparation(prove: ClaimPreparation['prove']): ClaimPreparation {
  if (!isClaimSponsorOrigin(globalThis.location?.origin ?? ''))
    throw new Error('Claim preparation requires the loopback sponsor origin.');
  return {
    prove,
    quote: (destination) => request(claimQuotePath, destination),
    prepare(quote, original) {
      const { bytes, ownerCommitment } = claimOwnerProof(original);
      const proof = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
      return request(claimPreparePath, { quote, ownerCommitment, proof });
    },
    findPrepared: (quote, ownerCommitment) =>
      request(claimPreparedPath, { quote, ownerCommitment }),
  };
}
