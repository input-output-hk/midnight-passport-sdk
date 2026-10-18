import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import type { PassportUnshieldedWithdrawal } from '@input-output-hk/mn-passport-protocol';

const HEX32 = /^[0-9a-f]{64}$/;
const POSITIVE = /^[1-9][0-9]*$/;
const U128_MAX = (1n << 128n) - 1n;
const invalid = (message: string): never => {
  const error = new Error(message);
  error.name = 'TransferInvalid';
  throw error;
};

/** Validate the visible destination and amount before requesting passkey consent. */
export function withdrawalRequest(
  networkId: string,
  color: string,
  amountInput: string,
  recipientInput: string,
  freshBalance: string,
): PassportUnshieldedWithdrawal {
  if (!HEX32.test(color)) invalid('Select a valid 32-byte asset color.');
  const amount = amountInput.trim();
  if (!POSITIVE.test(amount) || BigInt(amount) > U128_MAX)
    invalid('Amount must be a positive decimal number of smallest units within u128.');
  if (!/^\d+$/.test(freshBalance)) invalid('A fresh ACC balance is required.');
  if (BigInt(amount) > BigInt(freshBalance)) invalid('Amount exceeds the fresh ACC balance.');
  const recipient = (() => {
    try {
      return MidnightBech32m.parse(recipientInput.trim()).decode(UnshieldedAddress, networkId);
    } catch {
      return invalid(`Enter a valid unshielded Midnight address for ${networkId}.`);
    }
  })();
  return { color, amount, recipient: recipient.hexString };
}
