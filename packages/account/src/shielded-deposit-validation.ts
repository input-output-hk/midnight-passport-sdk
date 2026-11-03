import { PassportConnectorError } from './errors.js';
import type { ShieldedDepositPorts, ShieldedDepositRequest } from './shielded-deposit.js';

export function depositInput(input: ShieldedDepositRequest, ports: ShieldedDepositPorts) {
  if (
    !/^[0-9a-f]{64}$/.test(input.account) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.requestId) ||
    !(input.color instanceof Uint8Array) ||
    input.color.length !== 32 ||
    !(input.nonce instanceof Uint8Array) ||
    input.nonce.length !== 32 ||
    typeof input.amount !== 'bigint' ||
    input.amount < 1n ||
    input.amount > (1n << 128n) - 1n
  )
    throw new PassportConnectorError('InternalError', 'Invalid shielded deposit request.');
  const pollMs = ports.pollMs ?? 2_000,
    confirmationMs = ports.confirmationMs ?? 120_000;
  if (
    !Number.isSafeInteger(pollMs) ||
    !Number.isSafeInteger(confirmationMs) ||
    pollMs < 1 ||
    confirmationMs < pollMs ||
    confirmationMs > 2_147_483_647
  )
    throw new PassportConnectorError('InternalError', 'Invalid deposit confirmation window.');
  return {
    input: { ...input, color: input.color.slice(), nonce: input.nonce.slice() },
    pollMs,
    confirmationMs,
  };
}

/** Sender IDs are opaque, bounded public identifiers; do not embed arbitrary reply text. */
export function validDepositTransactionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,256}$/.test(value);
}
