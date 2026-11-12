import { randomBytes } from '@noble/hashes/utils.js';
import { toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';

export function grantScopeInvalid(message: string): never {
  throw new PassportConnectorError('GrantScopeInvalid', `Invalid grant scope: ${message}`);
}

export function activeGrantIds(ids: readonly string[]): ReadonlySet<string> {
  const active = new Set(ids);
  if (active.size >= 16)
    throw new PassportConnectorError(
      'GrantLimitReached',
      'Account has the maximum 16 active grants.',
    );
  return active;
}

export function selectGrantSlot(
  active: ReadonlySet<string>,
  derive: (slot: bigint) => Uint8Array,
  requestedSlot?: number,
): { readonly grantId: string; readonly slot: number } {
  const lastSlot = requestedSlot ?? 255;
  for (let slot = requestedSlot ?? 0; slot <= lastSlot; slot++) {
    const id = derive(BigInt(slot));
    if (id.length !== 32) grantScopeInvalid('binding returned an invalid grant id');
    const grantId = toHex(id);
    if (!active.has(grantId)) return { grantId, slot };
  }
  throw new PassportConnectorError('GrantLimitReached', 'No grant slot is free.');
}

export function freshGrantScopeSalt(
  random: (length: number) => Uint8Array = randomBytes,
): Uint8Array {
  const salt = random(32);
  if (!(salt instanceof Uint8Array) || salt.length !== 32 || salt.every((byte) => byte === 0))
    return grantScopeInvalid('scope salt must be fresh 32-byte randomness');
  return Uint8Array.from(salt);
}
