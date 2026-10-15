import type { PassportUnshieldedWithdrawal } from '@input-output-hk/mn-passport-protocol';
import { fromHex } from './codec.js';
import { PassportConnectorError } from './errors.js';

const U128_MAX = (1n << 128n) - 1n;
const HEX32 = /^[0-9a-f]{64}$/;
const DECIMAL = /^[1-9][0-9]*$/;

/** Validate public transfer fields before opening a key session or asking a signer for consent. */
export function prepareUnshieldedWithdrawal(request: PassportUnshieldedWithdrawal): {
  readonly color: Uint8Array;
  readonly amount: bigint;
  readonly recipient: { readonly bytes: Uint8Array };
} {
  if (
    !request ||
    typeof request.color !== 'string' ||
    !HEX32.test(request.color) ||
    typeof request.recipient !== 'string' ||
    !HEX32.test(request.recipient) ||
    typeof request.amount !== 'string' ||
    !DECIMAL.test(request.amount)
  )
    throw new PassportConnectorError(
      'TransferInvalid',
      'A transfer needs a 32-byte color and user address plus a positive decimal amount.',
    );
  const amount = BigInt(request.amount);
  if (amount > U128_MAX)
    throw new PassportConnectorError('TransferInvalid', 'Transfer amount exceeds u128.');
  return {
    color: fromHex(request.color),
    amount,
    recipient: { bytes: fromHex(request.recipient) },
  };
}
