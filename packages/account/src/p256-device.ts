import type { AccountHint, WebAuthnPolicy, CurvePoint, P256PublicKey } from './ports/index.js';

/** A hint for the P-256 arm. */
export type P256Hint = AccountHint & {
  readonly credentialId: Uint8Array;
  readonly policy: WebAuthnPolicy;
  /** Active address-based recovery has no local creation entries, but validates the ledger envelope. */
  readonly sealed?: true;
};
export const isP256 = (hint: AccountHint): hint is P256Hint =>
  hint.scheme === 'p256-webauthn' && hint.credentialId !== undefined && hint.policy !== undefined;
export type SealedP256Hint = P256Hint &
  ({ readonly keyEntries: readonly Uint8Array[] } | { readonly sealed: true });
export const validSealedEntries = (entries: readonly Uint8Array[] | undefined): boolean =>
  entries?.length === 2 &&
  entries[0]?.length === 192 &&
  entries[0][0] === 0xd1 &&
  (entries[0][1] === 1 || entries[0][1] === 2) &&
  entries[1]?.length === 192 &&
  (entries[1][0] === 0xd4 || entries[1][0] === 0xd5) &&
  entries[1][1] === entries[0][1];
export const isSealedP256 = (hint: P256Hint): hint is SealedP256Hint =>
  validSealedEntries(hint.keyEntries) || (hint.status === 'active' && hint.sealed === true);
/** The circuits' P-256 key; a point that already is one passes as is, so the same key reaches the chain. */
export const p256 = (point: CurvePoint): P256PublicKey =>
  (point as Partial<P256PublicKey>).identity === false
    ? (point as P256PublicKey)
    : { x: point.x, y: point.y, identity: false };
