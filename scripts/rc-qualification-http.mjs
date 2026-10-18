/** Wait for the expected localnet service, tolerating transient proxy/readiness responses.
 * @param {string} base
 * @param {string} manifestSha256
 * @param {{fetcher?: typeof fetch, pause?: () => Promise<void>, timeoutMs?: number}} [options]
 */
export async function waitForFundingReady(
  base,
  manifestSha256,
  {
    fetcher = fetch,
    pause = async () => {
      await new Promise((resolve) => setTimeout(() => resolve(undefined), 2_000));
    },
    timeoutMs = 15 * 60_000,
  } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let response;
    try {
      response = await fetcher(`${base}/healthz`, { signal: AbortSignal.timeout(5_000) });
    } catch {
      await pause();
      continue;
    }
    if ([502, 503, 504].includes(response.status)) {
      await pause();
      continue;
    }
    if (response.status !== 200) throw new Error(`funding health HTTP ${response.status}`);
    const body = await response.json();
    if (!body || typeof body !== 'object' || !('status' in body))
      throw new Error('invalid funding readiness body');
    if (body.status !== 'ready') {
      await pause();
      continue;
    }
    if (
      !('networkId' in body) ||
      body.networkId !== 'undeployed' ||
      !('bindingId' in body) ||
      body.bindingId !== 'acc-s3r1.1' ||
      !('manifestSha256' in body) ||
      body.manifestSha256 !== manifestSha256
    )
      throw new Error('funding readiness binding/network mismatch');
    return;
  }
  throw new Error('funding readiness timed out before any transfer request');
}

/** Record public transport outcomes before throwing; never retain raw error bodies or headers.
 * @param {{base: string, headers: Record<string,string>, request: import('../packages/protocol/dist/service.js').FundAccRequest, onAttempt: (event: {outcome: string, httpStatus?: number}) => void, fetcher?: typeof fetch}} options
 * @returns {Promise<import('../packages/protocol/dist/service.js').FundAccResponse>}
 */
export async function submitQualificationFunding({
  base,
  headers,
  request,
  onAttempt,
  fetcher = fetch,
}) {
  onAttempt({ outcome: 'started' });
  let response;
  try {
    response = await fetcher(`${base}/v1/faucet/fund`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });
  } catch {
    onAttempt({ outcome: 'transport-error' });
    throw new Error('funding transport failed; outcome uncertain, reconcile the saved request ID');
  }
  if (response.status !== 200) {
    onAttempt({ outcome: 'http-error', httpStatus: response.status });
    throw new Error(
      `funding HTTP ${response.status}; reconcile the saved request ID before retrying`,
    );
  }
  let body;
  try {
    body = await response.json();
  } catch {
    onAttempt({ outcome: 'invalid-response', httpStatus: response.status });
    throw new Error(
      'funding response was not JSON; outcome uncertain, reconcile the saved request ID',
    );
  }
  if (
    !body ||
    typeof body !== 'object' ||
    !('requestId' in body) ||
    body.requestId !== request.requestId ||
    !('txId' in body) ||
    typeof body.txId !== 'string' ||
    !/^[0-9a-f]{64,128}$/.test(body.txId) ||
    !('creditedBalance' in body) ||
    typeof body.creditedBalance !== 'string' ||
    !/^\d+$/.test(body.creditedBalance) ||
    ('preparationTxId' in body &&
      (typeof body.preparationTxId !== 'string' ||
        !/^[0-9a-f]{64,128}$/.test(body.preparationTxId)))
  ) {
    onAttempt({ outcome: 'invalid-response', httpStatus: response.status });
    throw new Error(
      'funding response has an invalid public receipt; reconcile the saved request ID',
    );
  }
  const receipt = {
    requestId: request.requestId,
    txId: body.txId,
    creditedBalance: body.creditedBalance,
    ...('preparationTxId' in body && typeof body.preparationTxId === 'string'
      ? { preparationTxId: body.preparationTxId }
      : {}),
  };
  onAttempt({ outcome: 'response-received', httpStatus: response.status });
  return receipt;
}
