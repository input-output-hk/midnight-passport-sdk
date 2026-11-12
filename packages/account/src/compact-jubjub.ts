import { jubjub } from '@noble/curves/misc.js';
import type { CurvePoint } from './ports/index.js';

// Compact uses a different prime-order generator from the Zcash default.
const generator = jubjub.Point.fromAffine({
  x: 0x3ea5c4673a121ca35ed37ee3b172f5ee04315c657fbe375f512dfea318d56fe5n,
  y: 0x57137b83ea6edb4f78f7d30d3f616cb3b9aa6e8e40808413c10cea38d50c55cbn,
});
export const compactJubjubOrder = jubjub.Point.CURVE().n;

export const compactLittleEndian = (bytes: Uint8Array) =>
  bytes.reduceRight((n, byte) => (n << 8n) | BigInt(byte), 0n);

export function compactJubjubPoint(coordinates: CurvePoint) {
  const { x, y } = coordinates;
  if (x < 0n || y < 0n || x >= jubjub.Point.Fp.ORDER || y >= jubjub.Point.Fp.ORDER)
    throw new Error('Noncanonical Compact JubJub coordinates.');
  const point = jubjub.Point.fromAffine({ x, y });
  point.assertValidity();
  if (point.is0() || !point.isTorsionFree()) throw new Error('Invalid Compact JubJub point.');
  return point;
}

export function verifyCompactJubjub(
  publicKey: ReturnType<typeof compactJubjubPoint>,
  commitment: ReturnType<typeof compactJubjubPoint>,
  scalar: bigint,
  challenge: bigint,
): boolean {
  return (
    scalar >= 0n &&
    scalar < compactJubjubOrder &&
    challenge >= 0n &&
    challenge < compactJubjubOrder &&
    generator.multiplyUnsafe(scalar).equals(commitment.add(publicKey.multiplyUnsafe(challenge)))
  );
}
