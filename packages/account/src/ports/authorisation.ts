import type { GrantScopeInput } from '../grant-scope.js';
import type { AuthScheme, CurvePoint, WebAuthnPolicy, DeviceReader } from './index.js';

/** The flow a key session serves, so a consent step can show it (lace-platform's `KeySessionFlow`). */
export interface FlowDescriptor {
  readonly kind:
    | 'create-account'
    | 'sign-in'
    | 'rotate-encryption-key'
    | 'add-device'
    | 'remove-device'
    | 'read-holdings'
    | 'issue-grant'
    | 'revoke-grant'
    | 'revoke-all-grants'
    | 'withdraw-unshielded'
    | 'withdraw-shielded'
    | 'backfill-shielded-change';
  /** The device entry a device flow targets. */
  readonly commitmentHex?: string;
  /** The ACC whose owner operation the signer is approving. */
  readonly account?: string;
  /** Scope context shown before an owner signs a grant issue call. */
  readonly grantId?: string;
  readonly scope?: GrantScopeInput;
  readonly scopeSalt?: string;
  readonly scopeDigest?: string;
  readonly slot?: number;
  /** A read revocation requires rotation; the surviving device set is shown by the signer. */
  readonly read?: boolean;
  readonly devices?: readonly string[];
  readonly reader?: DeviceReader;
  /** Creation can permanently retire the ACC's maintenance authority. */
  readonly lockAccount?: boolean;
  /** Public amount and recipient shown before a value-bearing owner transfer. */
  readonly color?: string;
  readonly amount?: string;
  readonly recipient?: string;
  /** Selected inbox coin entry for a shielded withdrawal. */
  readonly inboxIndex?: number;
}
/** JubJub's challenge, built per attempt from the announcement and the grind nonce. */
export type ChallengeBuilder = (sigR: CurvePoint, grindNonce: bigint) => Uint8Array;

export interface AuthorisationRequest {
  readonly account: string;
  readonly circuit: string;
  /** The circuit's arguments; `unknown` because the binding owns their types. */
  readonly args: readonly unknown[];
  readonly witnessValues: readonly unknown[];
  readonly authNonce: bigint;
  readonly useCounter: bigint;
  /**
   * The digest from the binding's pure circuits, or a builder for JubJub's grinding. The core
   * always sets it; it is optional so that an authoriser that builds its own, as lace-platform's
   * does, still fits, since with tagged parameter types only a request type assignable to this
   * one does.
   */
  readonly challenge?: Uint8Array | ChallengeBuilder;
  /** Passkey-backed arms: the account's credential, which the ceremony pins to. */
  readonly credentialId?: Uint8Array;
}
export interface P256Authorisation {
  readonly scheme: 'p256-webauthn';
  readonly pk: CurvePoint;
  readonly useCounter: bigint;
  /** The assertion's material, checked against the wa-json134 profile. */
  readonly authenticatorData: Uint8Array;
  readonly sig: { readonly r: bigint; readonly s: bigint };
}
/** lace-platform's `Authorisation`. */
export interface JubjubAuthorisation {
  readonly scheme: 'jubjub-schnorr';
  readonly pk: CurvePoint;
  readonly useCounter: bigint;
  readonly sigR: CurvePoint;
  readonly sigS: bigint;
  readonly grindNonce: bigint;
}
export type Authorisation = P256Authorisation | JubjubAuthorisation;

/** One device's key (lace-platform's `PassportAuthoriser`); its secret never crosses the port. */
export interface Authoriser {
  readonly scheme: AuthScheme;
  devicePublicKey(): Promise<CurvePoint>;
  /** Canonical compressed authoriser point, as lowercase hex (32 bytes JubJub; 33 P-256). */
  devicePublicKeyHex?(): Promise<string>;
  /** The P-256 arm's WebAuthn binding: the policy and the credential the key lives in. */
  deviceBinding?(): Promise<{ readonly policy: WebAuthnPolicy; readonly credentialId: Uint8Array }>;
  authorise(request: AuthorisationRequest): Promise<Authorisation>;
  /** Device entries in hex, in order, so an interactive key source prompts once for a scan. */
  deviceCommitments?(
    account: string,
    epoch: bigint,
    counters: readonly bigint[],
  ): Promise<string[]>;
  /** One ceremony for a whole flow; a nested call joins the open session. */
  withKeySession?<T>(operation: () => Promise<T>, flow?: FlowDescriptor): Promise<T>;
}

export interface CredentialRef {
  readonly credentialId: Uint8Array;
}
export interface CredentialPort {
  /**
   * Optional operation-scoped login: combine discovery and reader-key derivation in one
   * credential ceremony. Implementations dispose private material when work ends and refuse
   * overlapping logins. This does not approve a transaction or extend an owner-key lease.
   */
  withLoginSession?<T>(work: () => Promise<T>): Promise<T>;
  create(user: { readonly name: string }): Promise<CredentialRef>;
  /**
   * The discoverable prompt. `owns` is true only when the assertion it obtained verifies under
   * `key` (and `policy`, P-256), so a directory hint binds to the picked passkey with no second prompt.
   */
  identify(): Promise<{
    readonly credentialId: Uint8Array;
    owns(key: CurvePoint, policy?: WebAuthnPolicy): boolean;
  }>;
}
