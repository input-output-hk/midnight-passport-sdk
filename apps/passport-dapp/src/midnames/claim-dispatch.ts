import type { ClaimReceipt } from './claim-receipt.js';

export const claimDispatchPath = '/v1/midnames/claim/dispatch';

export class ClaimSponsorFundingError extends Error {
  constructor() {
    super('The local claim sponsor needs NIGHT and two DUST inputs.');
    this.name = 'ClaimSponsorFundingError';
  }
}

export function isClaimSponsorOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.origin === origin &&
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

/** A transport outcome never establishes claim finality. */
export async function requestClaimDispatch(receipt: ClaimReceipt): Promise<void> {
  const response = await fetch(claimDispatchPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(receipt),
    mode: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 409) {
    const refusal: unknown = await response.json().catch(() => undefined);
    if (
      refusal &&
      typeof refusal === 'object' &&
      'code' in refusal &&
      refusal.code === 'SponsorNeedsFunding'
    )
      throw new ClaimSponsorFundingError();
  }
  if (response.status !== 202)
    throw new Error('The local sponsor did not acknowledge the prepared claim.');
}
