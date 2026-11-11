import type { ClaimReceipt } from './claim-receipt.js';

export const claimDispatchPath = '/v1/midnames/claim/dispatch';

export function isClaimSponsorOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.origin === origin && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/** A transport outcome never establishes claim finality. */
export async function requestClaimDispatch(receipt: ClaimReceipt): Promise<void> {
  await fetch(claimDispatchPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(receipt),
    mode: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
}
