import type {
  ChallengeBuilder,
  CurvePoint,
  JubjubAuthorisation,
} from '@input-output-hk/mn-passport-account/ports';

/** Prime-order subgroup of the ACC's JubJub signing curve. */
export const JUBJUB_ORDER = 0x0e7db4ea6533afa906673b0101343b00a6682093ccc81082d0970e5ed6f72cb7n;

export interface JubjubPointCircuit {
  compute_public_point_with_jubjub(scalar: bigint): CurvePoint;
}

/** The ACC interprets PRF and challenge bytes as little-endian scalars. */
export function littleEndianScalar(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i]!);
  return value;
}

/** Rejection sampling avoids bias and never produces the identity key. */
export function randomJubjubScalar(): bigint {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const scalar = littleEndianScalar(bytes);
    bytes.fill(0);
    if (scalar > 0n && scalar < JUBJUB_ORDER) return scalar;
  }
}

/** Internal signing primitive; callers provide only the contract-built challenge. */
export function signJubjubChallenge(
  pure: JubjubPointCircuit,
  secret: bigint,
  challenge: ChallengeBuilder,
  useCounter: bigint,
  nonce = randomJubjubScalar(),
): JubjubAuthorisation {
  if (secret <= 0n || secret >= JUBJUB_ORDER || nonce <= 0n || nonce >= JUBJUB_ORDER)
    throw new Error('JubJub secret and nonce must be nonzero subgroup scalars');
  const pk = pure.compute_public_point_with_jubjub(secret);
  const sigR = pure.compute_public_point_with_jubjub(nonce);
  for (let grindNonce = 0n; grindNonce < 1024n; grindNonce++) {
    const hash = challenge(sigR, grindNonce);
    if (hash.length !== 32) throw new Error('the ACC challenge must be 32 bytes');
    const scalar = littleEndianScalar(hash);
    if (scalar < JUBJUB_ORDER) {
      return {
        scheme: 'jubjub-schnorr',
        pk,
        useCounter,
        sigR,
        sigS: (nonce + scalar * secret) % JUBJUB_ORDER,
        grindNonce,
      };
    }
  }
  throw new Error('the ACC challenge did not produce a JubJub scalar');
}
