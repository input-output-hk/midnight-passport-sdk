import { isClaimSponsorOrigin } from './claim-dispatch.js';
import { claimReceiptLimit, type ClaimReceipt } from './claim-receipt.js';
import {
  ClaimPreIntentRefusal,
  ClaimSponsorBusy,
  claimOwnerProof,
  type ClaimPreparation,
} from './claim-quote.js';

export const claimQuotePath = '/v1/midnames/claim/quote';
export const claimPreparePath = '/v1/midnames/claim/prepare';
export const claimPreparedPath = '/v1/midnames/claim/prepared';
export const claimRetirePath = '/v1/midnames/claim/retire-expired-unsent';
export const claimRetireUnpreparedPath = '/v1/midnames/claim/retire-expired-unprepared';
export const claimRetireFailurePath = '/v1/midnames/claim/retire-indexed-failure';
export const claimStatusPath = '/v1/midnames/claim/dispatch-status';

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
  if (path === claimQuotePath && response.status === 423)
    throw new ClaimSponsorBusy(
      'The local sponsor has an unresolved original claim. This quote request did not prepare or send a new claim. Preserve any earlier receipt and reconcile it before requesting another quote.',
    );
  if ((path === claimPreparePath || path === claimPreparedPath) && response.status === 412)
    throw new ClaimPreIntentRefusal('The sponsor refused this quote before preparation began.');
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
    async dispatchStatus(receipt: ClaimReceipt) {
      const result = await request(claimStatusPath, receipt);
      if (
        !result ||
        typeof result !== 'object' ||
        !('status' in result) ||
        (result.status !== 'prepared' &&
          result.status !== 'sent-or-unknown' &&
          result.status !== 'retired')
      )
        throw new Error('The local sponsor did not confirm dispatch status.');
      return result.status;
    },
    async retireExpiredUnsent(receipt: ClaimReceipt) {
      const result = await request(claimRetirePath, receipt);
      if (
        !result ||
        typeof result !== 'object' ||
        !('status' in result) ||
        result.status !== 'retired'
      )
        throw new Error('The local sponsor did not confirm retirement.');
    },
    async retireExpiredUnprepared(quote, ownerCommitment) {
      const result = await request(claimRetireUnpreparedPath, { quote, ownerCommitment });
      if (
        !result ||
        typeof result !== 'object' ||
        !('status' in result) ||
        result.status !== 'retired'
      )
        throw new Error('The local sponsor did not confirm unprepared retirement.');
    },
    async retireIndexedFailure(receipt: ClaimReceipt) {
      const result = await request(claimRetireFailurePath, receipt);
      if (
        !result ||
        typeof result !== 'object' ||
        !('status' in result) ||
        result.status !== 'retired' ||
        !('reason' in result) ||
        (result.reason !== 'failed' && result.reason !== 'claim-failed')
      )
        throw new Error('The local sponsor did not confirm indexed failure retirement.');
      return result.reason;
    },
  };
}
