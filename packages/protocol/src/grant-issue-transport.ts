// The encrypted host record retains both proved input and finalized bytes as hex.
export const MAX_HOST_GRANT_ISSUE_BYTES = 1024 * 1024;

/** Stable one-step host identity for the original browser grant UUID. */
export function grantIssueHostRequestId(requestId: string): string | undefined {
  if (
    typeof requestId !== 'string' ||
    requestId.length !== 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)
  )
    return undefined;
  return requestId.toLowerCase().replaceAll('-', '') + ':0';
}

export function grantIssueOwnerCircuit(scheme: 'p256-webauthn' | 'jubjub-schnorr') {
  return scheme === 'p256-webauthn' ? 'issue_grant_with_p256' : 'issue_grant_with_jubjub';
}
