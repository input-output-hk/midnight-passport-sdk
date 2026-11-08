import type {
  PassportShieldedWithdrawal,
  PassportUnshieldedWithdrawal,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { UnshieldedWithdrawalSchema } from './validation.js';

/** Validate public transfer fields before opening a key session or asking a signer for consent. */
export function prepareUnshieldedWithdrawal(request: PassportUnshieldedWithdrawal): {
  readonly color: Uint8Array;
  readonly amount: bigint;
  readonly recipient: { readonly bytes: Uint8Array };
} {
  const parsed = UnshieldedWithdrawalSchema.safeParse(request);
  if (!parsed.success)
    throw new PassportConnectorError(
      'TransferInvalid',
      'A transfer needs a 32-byte color and recipient plus a positive decimal amount.',
    );
  const { color, recipient, amount } = parsed.data;
  return {
    color: fromHex(color),
    amount: BigInt(amount),
    recipient: { bytes: fromHex(recipient) },
  };
}

export function prepareShieldedWithdrawal(request: PassportShieldedWithdrawal) {
  const fields = prepareUnshieldedWithdrawal(request);
  if (!Number.isSafeInteger(request.inboxIndex) || request.inboxIndex < 0)
    throw new PassportConnectorError('TransferInvalid', 'Invalid shielded inbox index.');
  return { ...fields, inboxIndex: request.inboxIndex };
}
