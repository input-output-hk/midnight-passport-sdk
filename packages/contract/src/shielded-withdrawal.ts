import type { EncodedShieldedCoinInfo } from '@midnight-ntwrk/compact-runtime';

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayName = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)?.get;
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'length')?.get;

function copyBytes32(value: Uint8Array): Uint8Array {
  if (typedArrayName?.call(value) !== 'Uint8Array')
    throw new TypeError('Expected a shielded coin byte array.');
  if (typedArrayLength?.call(value) !== 32)
    throw new RangeError('Expected 32 shielded coin bytes.');
  return new Uint8Array(value);
}

/**
 * Predict the private coin descriptions emitted by acc-s3r1.1 owner withdrawals.
 * Use the resulting commitments to verify observed effects. This function does
 * not establish custody, Merkle indices, finality, or withdrawal authorization.
 */
export async function deriveAccS3r1ShieldedWithdrawal(
  input: EncodedShieldedCoinInfo,
  amount: bigint,
): Promise<{
  readonly sent: EncodedShieldedCoinInfo;
  readonly change?: EncodedShieldedCoinInfo;
}> {
  const { nonce, color, value } = input;
  if (
    typeof value !== 'bigint' ||
    typeof amount !== 'bigint' ||
    value >= 1n << 128n ||
    amount <= 0n ||
    amount > value
  )
    throw new RangeError('Withdrawal amount must be positive and within the qualified coin value.');

  const nonceBytes = copyBytes32(nonce);
  const colorBytes = copyBytes32(color);
  const runtime = await import('@midnight-ntwrk/compact-runtime');
  const fieldPair = new runtime.CompactTypeVector(2, runtime.CompactTypeField);
  const inputNonce = runtime.degradeToTransient(nonceBytes);
  const evolve = (label: string) => {
    const bytes = Uint8Array.from(Array.from(label, (character) => character.charCodeAt(0)));
    const domain = runtime.convertBytesToUint(
      runtime.maxField(),
      bytes.length,
      bytes,
      'Field',
      'Compact standard library',
    );
    return runtime.upgradeFromTransient(runtime.transientHash(fieldPair, [domain, inputNonce]));
  };
  const sent = {
    nonce: evolve('midnight:kernel:nonce_evolve'),
    color: colorBytes,
    value: amount,
  };
  if (amount === value) return { sent };
  const change = {
    nonce: evolve('midnight:kernel:nonce_evolve/2'),
    color: new Uint8Array(colorBytes),
    value: value - amount,
  };
  return { sent, change };
}
