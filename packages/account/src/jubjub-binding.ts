/** Checked capabilities and comparisons shared by JubJub account operations. */
import type { PassportDeviceReader } from '@input-output-hk/mn-passport-protocol';
import type {
  AccountHint,
  Authoriser,
  CurvePoint,
  DeviceReader,
  FlowDescriptor,
  JubjubPureCircuits,
} from './ports/index.js';
import type { JubjubHint } from './jubjub-rotation-types.js';
import type { IssueJubjubGrantPure } from './jubjub-grant-issue.js';
import type { RevokeJubjubGrantPure } from './jubjub-grant-revoke.js';
import type { RevokeAllJubjubGrantPure } from './jubjub-grant-revoke-all.js';
import { PassportConnectorError } from './errors.js';

export function withJubjubOwnerSession<T>(
  authoriser: Authoriser,
  operation: () => Promise<T>,
  descriptor?: FlowDescriptor,
): Promise<T> {
  const current = authoriser.withKeySession;
  if (!current)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'JubJub accounts need a directory, viewing key, and session-capable authoriser.',
    );
  return current.bind(authoriser)(operation, descriptor);
}

export function jubjubOwnerKeyHex(authoriser: Authoriser): Promise<string> {
  const current = authoriser.devicePublicKeyHex;
  if (!current)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'JubJub accounts need a directory, viewing key, and session-capable authoriser.',
    );
  return current.call(authoriser);
}
export const equal = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);
export const samePoint = (a: CurvePoint, b: CurvePoint): boolean => a.x === b.x && a.y === b.y;
export const conflictsWithReader = (registered: DeviceReader, joining: PassportDeviceReader) =>
  (registered.readerPublicKey === joining.readerPublicKey ||
    registered.devicePublicKey === joining.devicePublicKey) &&
  (registered.readerPublicKey !== joining.readerPublicKey ||
    registered.devicePublicKey !== joining.devicePublicKey ||
    (registered.scheme === 'p256-webauthn') !==
      ('scheme' in joining && joining.scheme === 'p256-webauthn') ||
    (registered.scheme === 'p256-webauthn' &&
      'policy' in joining &&
      (!registered.policy ||
        !equal(registered.policy.rp_id_hash, joining.policy.rp_id_hash) ||
        !equal(registered.policy.origin, joining.policy.origin))));
export function isJubjubHint(hint: AccountHint): hint is JubjubHint {
  const entries = hint.keyEntries;
  const validEntries =
    Array.isArray(entries) &&
    entries.length === 2 &&
    entries[0]?.length === 192 &&
    entries[0][0] === 0xd1 &&
    (entries[0][1] === 1 || entries[0][1] === 2) &&
    entries[1]?.length === 192 &&
    entries[1][0] === 0xd2 &&
    entries[1][1] === entries[0][1];
  return (
    hint.scheme === 'jubjub-schnorr' &&
    hint.credentialId instanceof Uint8Array &&
    (hint.salt === undefined || hint.salt.length === 32) &&
    (entries === undefined || validEntries) &&
    (hint.status !== 'deployed' || (hint.salt?.length === 32 && validEntries))
  );
}

export function requirePure(value: unknown): JubjubPureCircuits {
  const pure = (value ?? {}) as Partial<JubjubPureCircuits>;
  for (const name of [
    'derive_boot_commitment_with_jubjub',
    'derive_device_entry_with_jubjub',
    'challenge_append_inbox_with_jubjub',
    'challenge_rotate_enc_key_with_jubjub',
    'challenge_remove_device_with_jubjub',
    'challenge_add_device_with_jubjub',
  ] as const) {
    if (typeof pure[name] !== 'function')
      throw new PassportConnectorError('BindingUnsupported', `ACC binding lacks ${name}.`);
  }
  return pure as JubjubPureCircuits;
}

export function requireGrantPure(value: unknown): IssueJubjubGrantPure & JubjubPureCircuits {
  const pure = requirePure(value) as Partial<IssueJubjubGrantPure>;
  for (const name of [
    'derive_grant_id_with_jubjub',
    'derive_grant_object_commit',
    'derive_grant_scope_digest',
    'challenge_issue_grant_with_jubjub',
  ] as const) {
    if (typeof pure[name] !== 'function')
      throw new PassportConnectorError('BindingUnsupported', `ACC binding lacks ${name}.`);
  }
  return pure as IssueJubjubGrantPure & JubjubPureCircuits;
}

export function requireRevokePure(value: unknown): RevokeJubjubGrantPure {
  const pure = requirePure(value) as Partial<RevokeJubjubGrantPure>;
  if (typeof pure.challenge_revoke_grant_with_jubjub !== 'function')
    throw new PassportConnectorError(
      'BindingUnsupported',
      'ACC binding lacks challenge_revoke_grant_with_jubjub.',
    );
  return pure as RevokeJubjubGrantPure;
}

export function requireRevokeAllPure(value: unknown): RevokeAllJubjubGrantPure {
  const pure = requirePure(value) as Partial<RevokeAllJubjubGrantPure>;
  if (typeof pure.challenge_revoke_all_grants_with_jubjub !== 'function')
    throw new PassportConnectorError(
      'BindingUnsupported',
      'ACC binding lacks challenge_revoke_all_grants_with_jubjub.',
    );
  return pure as RevokeAllJubjubGrantPure;
}
