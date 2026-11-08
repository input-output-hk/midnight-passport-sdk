import type { GrantScopeInput, PassportDeviceReader } from '@input-output-hk/mn-passport-protocol';
import { PassportConnectorError } from './errors.js';

/** Readonly parameter types do not prevent mutation through the caller's original aliases. */
export function snapshotGrantScope(input: GrantScopeInput): GrantScopeInput {
  return Object.freeze({
    grantee: Object.freeze({ scheme: input.grantee.scheme, publicKey: input.grantee.publicKey }),
    operations: Object.freeze([...input.operations]),
    color: input.color,
    recipient: Object.freeze(
      input.recipient.kind === 'any'
        ? { kind: 'any' as const }
        : { kind: input.recipient.kind, value: input.recipient.value },
    ),
    maxCoinValue: input.maxCoinValue,
    perCallCap: input.perCallCap,
    cap: input.cap,
    expiresAt: input.expiresAt,
    ...(input.window !== undefined && {
      window: Object.freeze({ lengthSeconds: input.window.lengthSeconds, cap: input.window.cap }),
    }),
    ...(input.read !== undefined && { read: input.read }),
    ...(input.readPublicKey !== undefined && { readPublicKey: input.readPublicKey }),
    ...(input.caller !== undefined && { caller: input.caller }),
    ...(input.rpId !== undefined && { rpId: input.rpId }),
  });
}

/** Snapshot signing/reader registration and policy bytes before loading a binding or key session. */
export function snapshotDeviceReader(input: PassportDeviceReader): PassportDeviceReader {
  const base = { readerPublicKey: input.readerPublicKey, devicePublicKey: input.devicePublicKey };
  if ('scheme' in input) {
    if (
      input.scheme !== 'p256-webauthn' ||
      !(input.policy?.rp_id_hash instanceof Uint8Array) ||
      input.policy.rp_id_hash.length !== 32 ||
      !(input.policy.origin instanceof Uint8Array) ||
      input.policy.origin.length !== 21
    )
      throw new PassportConnectorError(
        'DeviceRosterInvalid',
        'The joining WebAuthn policy is malformed.',
      );
    return Object.freeze({
      ...base,
      scheme: 'p256-webauthn' as const,
      policy: Object.freeze({
        rp_id_hash: Uint8Array.from(input.policy.rp_id_hash),
        origin: Uint8Array.from(input.policy.origin),
      }),
    });
  }
  if ('policy' in input)
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'A JubJub reader cannot carry a WebAuthn policy.',
    );
  return Object.freeze(base);
}
