import type { ServiceWire } from '@input-output-hk/mn-passport-protocol';

export class FaucetClientError extends Error {
  readonly status: number;
  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'FaucetClientError';
    this.status = status;
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hex = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const MAX_U128 = '340282366920938463463374607431768211455';
/** Check length before scanning/range admission; no unbounded BigInt conversion. */
const positiveU128 = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 39 &&
  /^[1-9][0-9]*$/.test(value) &&
  (value.length < 39 || value <= MAX_U128);
const invalidRequest = (): never => {
  throw new FaucetClientError(0, 'invalid funding request');
};

/** Read each supported caller field once, before credentials or transport work. */
export function fundingRequest(value: unknown): ServiceWire.FundAccRequest {
  if (!record(value)) return invalidRequest();
  const { requestId, networkId, bindingId, manifestSha256, accountAddress, color, amount } = value;
  if (
    typeof requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId) ||
    typeof networkId !== 'string' ||
    typeof bindingId !== 'string' ||
    !hex(manifestSha256) ||
    !hex(accountAddress) ||
    !hex(color) ||
    !positiveU128(amount)
  )
    return invalidRequest();
  return Object.freeze({
    requestId,
    networkId,
    bindingId,
    manifestSha256,
    accountAddress,
    color,
    amount,
  });
}
export function fundingResponse(
  value: unknown,
  requestId: string,
  status: number,
): ServiceWire.FundAccResponse {
  const invalid = (): never => {
    throw new FaucetClientError(status, 'funding service answered an invalid result');
  };
  if (!record(value)) return invalid();
  const { requestId: returnedId, txId, creditedBalance, preparationTxId } = value;
  if (
    returnedId !== requestId ||
    typeof txId !== 'string' ||
    txId.length === 0 ||
    !positiveU128(creditedBalance) ||
    (preparationTxId !== undefined && typeof preparationTxId !== 'string')
  )
    return invalid();
  return {
    requestId,
    txId,
    creditedBalance,
    ...(preparationTxId !== undefined && { preparationTxId }),
  };
}
export function fundingFailure(status: number, body: unknown): FaucetClientError {
  const error = record(body) ? body.error : undefined;
  return new FaucetClientError(
    status,
    typeof error === 'string' ? error : `funding request failed: HTTP ${status}`,
  );
}
