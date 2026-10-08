// The ports of the account core (design §2.1, D-2, D-4), exported as `./ports`: types only, so an
// adapter or a host gets the interfaces without the flows. Where a port means what a lace-platform
// seam means, it takes that seam's member names and a superset of its shapes, so a lace-platform
// object fits by assignment. Members use method syntax, so a host's tagged parameter types fit.
import type {
  AuthScheme,
  FlowOptions,
  PassportTxResult,
} from '@midnight-ntwrk/mn-passport-protocol';
import type { AccLedgerView, AccPureCircuits, WebAuthnPolicy } from '../seams.js';

export type { AuthScheme } from '@midnight-ntwrk/mn-passport-protocol';
// Defined beside the prototype's seams until T5 to T9 retire them; this is their public home.
export type { AccLedgerView, AccPureCircuits, P256PublicKey, WebAuthnPolicy } from '../seams.js';

/** An affine point: P-256 for the WebAuthn arm, JubJub for the PRF arm. */
export interface CurvePoint {
  readonly x: bigint;
  readonly y: bigint;
}

// ---- Core-facing ports

/** The flow a key session serves, so a consent step can show it (lace-platform's `KeySessionFlow`). */
export interface FlowDescriptor {
  readonly kind:
    'create-account' | 'sign-in' | 'rotate-encryption-key' | 'add-device' | 'remove-device';
  /** The device entry a device flow targets. */
  readonly commitmentHex?: string;
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

/** lace-platform's `PassportEncryptionKey`: the X25519 public key, the ACC's `enc_key`. */
export interface EncryptionKeySource {
  publicKey(networkId: string): Promise<Uint8Array>;
}

export interface CallRequest extends FlowOptions {
  readonly address: string;
  readonly circuit: string;
  readonly args: readonly unknown[];
}
export type TxResult = PassportTxResult;
export interface Chain {
  call(request: CallRequest): Promise<TxResult>;
  readAccount(address: string): Promise<AccLedgerView | undefined>;
}

export interface DeployRequest extends FlowOptions {
  /** The 32-byte boot commitment, and the ACC's `enc_key`. */
  readonly boot: Uint8Array;
  readonly encKey: Uint8Array;
  /** Irreversible, so no default (D-11). */
  readonly retireAuthority: boolean;
}
export interface Deployer {
  /** `txIds`: each wave's submission id, in order. */
  deploy(request: DeployRequest): Promise<{ address: string; txIds: readonly string[] }>;
}

/** Q9 is open: a derived key would join as another `kind`. */
export interface DirectoryKey {
  readonly kind: 'credential-id';
  readonly credentialId: Uint8Array;
}
/** An untrusted pointer from a device key to its account; the core checks it on chain (D-12). */
export interface AccountHint {
  readonly address: string;
  readonly scheme: AuthScheme;
  /** Passkey-backed arms. */
  readonly credentialId?: Uint8Array;
  readonly publicKey: CurvePoint;
  /** The P-256 arm. */
  readonly policy?: WebAuthnPolicy;
  /** Opens the boot commitment, to activate a deployed account. */
  readonly salt?: Uint8Array;
  readonly status: 'deployed' | 'active';
}
/** Proof that the writer holds the hint's device key, over a challenge that binds the hint. */
export type OwnershipProof =
  | {
      readonly scheme: 'p256-webauthn';
      readonly challenge: Uint8Array;
      readonly authenticatorData: Uint8Array;
      readonly clientDataJSON: Uint8Array;
      readonly signature: Uint8Array;
    }
  | {
      readonly scheme: 'jubjub-schnorr';
      readonly challenge: Uint8Array;
      readonly sigR: CurvePoint;
      readonly sigS: bigint;
    };
/** Cross-device discovery. */
export interface AccountDirectory {
  get(networkId: string, key: DirectoryKey): Promise<AccountHint | undefined>;
  put(networkId: string, hint: AccountHint, proof?: OwnershipProof): Promise<void>;
}

/** This device's memory of its account: lace-platform's record, plus the arm and the credential. */
export interface AccountRecord {
  readonly address: string;
  readonly bindingId: string;
  readonly scheme: AuthScheme;
  readonly credentialId?: Uint8Array;
  /** The use counter this device last spent; the scan starts there. */
  readonly localUseCounter: bigint;
}
export interface AccountRecordStore {
  read(): Promise<AccountRecord | undefined>;
  write(record: AccountRecord): Promise<void>;
  exists(): Promise<boolean>;
}

/** lace-platform's `PassportNetworkConfig` plus the binding pin; a value pinned at build time. */
export interface NetworkConfig {
  readonly networkId: string;
  readonly indexerUrl: string;
  readonly indexerWsUrl: string;
  readonly nodeUrl: string;
  readonly artefactUrl: string;
  readonly bindingId: string;
  readonly manifestSha256: string;
}

/** What the core reads of a binding; `info`, `Contract` and `ledger` join with `contract/bindings`. */
export interface AccBinding {
  readonly pureCircuits: AccPureCircuits;
}
/** A value, or a loader the core calls once, so heavy code stays behind `import()`. */
export type Lazy<T> = T | (() => Promise<T>);

export interface PassportPorts {
  readonly network: NetworkConfig;
  readonly binding: Lazy<AccBinding>;
  readonly credentials: CredentialPort;
  readonly authoriser: Authoriser;
  readonly encryptionKey: EncryptionKeySource;
  readonly chain: Lazy<Chain>;
  readonly deployer: Deployer;
  readonly directory?: AccountDirectory;
  readonly records?: AccountRecordStore;
  readonly random?: (length: number) => Uint8Array;
}

// ---- Chain-facing ports

/** lace-platform's `PasskeyKeySource`. */
export interface PrfKeySource {
  withSession<T>(operation: () => Promise<T>): Promise<T>;
  /** PRF output #1; the caller zeroes it. */
  deviceSecret(): Promise<Uint8Array>;
  /** MIP-0015 under the root. */
  deriveSecret(params: { domain: string; context: string; length?: number }): Promise<Uint8Array>;
}
export interface ProveContext extends FlowOptions {
  readonly networkId: string;
  readonly bindingId: string;
  readonly circuits: readonly string[];
}
/** Transaction-level (D-5); `provenance` lets a host tell the user where the proof ran. */
export interface Prover {
  proveTx(
    unproven: Uint8Array,
    context: ProveContext,
  ): Promise<{ tx: Uint8Array; provenance: 'remote' | 'local' }>;
}
/** lace-platform's `FeeSponsor`. */
export interface FeeSponsor {
  balanceAndSign(unbalancedTx: Uint8Array): Promise<Uint8Array>;
}
export interface Submitter {
  /** Answers the submission id. */
  submit(finalisedTx: Uint8Array): Promise<string>;
}
