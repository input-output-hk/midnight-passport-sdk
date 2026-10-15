// The ports of the account core (design §2.1, D-2, D-4), exported as `./ports`: types only, so an
// adapter or a host gets the interfaces without the flows. Where a port means what a lace-platform
// seam means, it takes that seam's member names and compatible shapes where possible. The current
// Lace authoriser still needs a key-session flow adapter; see docs/compatibility.md. Members use
// method syntax so a host's tagged parameter types can fit where their flow contracts agree.
import type {
  AuthScheme,
  FlowOptions,
  PassportTxResult,
} from '@input-output-hk/mn-passport-protocol';
import type {
  AccLedgerView,
  AccPureCircuits,
  JubjubPureCircuits,
  P256PublicKey,
  WebAuthnPolicy,
} from '../seams.js';
import type { GrantScopeInput } from '../grant-scope.js';
import type { GrantPublicationJournal } from '../jubjub-grant-publication.js';

/** The host reads these ids from the live ACC grants map, not local bookkeeping. */
export interface ActiveGrantSource {
  readActiveGrantIds(account: string): Promise<readonly string[]>;
}
/** Issue uses one grant-map snapshot whose nonce must match its ACC signing view. */
export interface ActiveGrantSnapshotSource extends ActiveGrantSource {
  readActiveGrantSnapshot(
    account: string,
  ): Promise<{ readonly authNonce: bigint; readonly ids: readonly string[] }>;
}

/** The host reads the record and nonce from one live ACC grant-map snapshot. */
export interface GrantDetailSource {
  readGrant(
    account: string,
    grantId: string,
  ): Promise<{ active: boolean; read: boolean; authNonce: bigint } | undefined>;
}

/** Live ACC commitments used to authenticate a staged grant opening before inbox publication. */
export interface GrantCommitmentSource {
  readGrantCommitment(
    account: string,
    grantId: string,
  ): Promise<
    | {
        readonly active: boolean;
        readonly read: boolean;
        readonly authNonce: bigint;
        readonly objectCommit: Uint8Array;
        readonly readPkHash: Uint8Array;
      }
    | undefined
  >;
}

/** Complete live ACC grant map, including tombstones, for revoke-all generation checks. */
export interface GrantRosterSource {
  readGrantRoster(account: string): Promise<{
    readonly authNonce: bigint;
    readonly generation: bigint;
    readonly entries: readonly {
      readonly id: string;
      readonly active: boolean;
      readonly read: boolean;
    }[];
  }>;
}

export interface ActiveReadGrantTarget {
  readonly grantId: string;
  /** Absent when this device lacks an opening for an otherwise active read grant. */
  readonly readPublicKey?: string;
}
export interface ActiveReadGrantSnapshot {
  readonly authNonce: bigint;
  readonly targets: readonly ActiveReadGrantTarget[];
}
/** The host must verify every active read grant and each known key's on-chain hash. */
export interface ActiveReadGrantTargetSource {
  readActiveReadGrantTargets(account: string): Promise<ActiveReadGrantSnapshot>;
}

export type { AuthScheme } from '@input-output-hk/mn-passport-protocol';
// Defined beside the prototype's seams until T5 to T9 retire them; this is their public home.
export type {
  AccLedgerView,
  AccPureCircuits,
  JubjubPureCircuits,
  P256PublicKey,
  WebAuthnPolicy,
  PasskeyCredential,
  PasskeySeam,
} from '../seams.js';
export type { AccountRecord as LegacyAccountRecord, RegistrySeam } from '../seams.js';
/** The part of an `AbortSignal` a caller hands to fetch; the real one satisfies it. */
export interface FetchAbortSignal {
  readonly aborted: boolean;
}
/** Structural fetch: neutral adapters compile without Node or DOM types. */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: FetchAbortSignal;
  },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** An affine point: P-256 for the WebAuthn arm, JubJub for the PRF arm. */
export interface CurvePoint {
  readonly x: bigint;
  readonly y: bigint;
}

// ---- Core-facing ports

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
    | 'revoke-all-grants';
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

/** Prototype X25519 public-key source. Lace's current `PassportEncryptionKey` fits `AccountViewingKey`. */
export interface EncryptionKeySource {
  publicKey(networkId: string): Promise<Uint8Array>;
}

/** One enrolled device's X25519 reader key paired with its compressed authoriser key. */
export interface DeviceReader {
  readonly readerPublicKey: string;
  /** Omitted for Lace's v1 compressed JubJub registration. */
  readonly scheme?: 'jubjub-schnorr' | 'p256-webauthn';
  readonly devicePublicKey: string;
  /** P-256 policy carried by the versioned registration so its ACC entry can be resolved. */
  readonly policy?: WebAuthnPolicy;
}
export interface LiveDeviceReader extends DeviceReader {
  readonly epoch: bigint;
  readonly counter: bigint;
}
/** Public ledger key plus this device's sealed envelopes, newest first. */
export interface AccountKeyring {
  readonly account: string;
  readonly encKey: Uint8Array;
  readonly envelopes: readonly Uint8Array[];
}
export interface CreateAccountKeys {
  readonly devicePublicKey: string;
  /** Omitted for Lace's v1 compressed JubJub registration. */
  readonly scheme?: DeviceReader['scheme'];
  readonly policy?: WebAuthnPolicy;
  readonly keyring?: AccountKeyring;
  readonly registrations?: readonly Uint8Array[];
  readonly readers?: readonly LiveDeviceReader[];
  readonly rotateRoster?: boolean;
  readonly removed?: {
    readonly devicePublicKey: string;
    readonly epoch: bigint;
    readonly counter: bigint;
  };
}
export interface AccountKeys {
  readonly encKey: Uint8Array;
  readonly envelopes: Uint8Array[];
  readonly registrations: Uint8Array[];
}
export interface DeviceDelivery {
  readonly envelope: Uint8Array;
  readonly registration: Uint8Array;
}
export interface ShieldedCoin {
  readonly nonce: Uint8Array;
  readonly color: Uint8Array;
  readonly value: bigint;
}
export interface GrantBookkeeping {
  readonly grantId: string;
  /** ACC grant map position, an unsigned 8-bit integer. */
  readonly slot: number;
  readonly scopeSalt: string;
  readonly granteePublicKey: string;
  readonly readPublicKey?: string;
  readonly object: {
    readonly color: string;
    readonly recipient:
      | { readonly kind: 'any' }
      | {
          readonly kind: 'coin-public-key' | 'contract-address' | 'user-address';
          readonly value: string;
        };
    readonly maxCoinValue: string;
  };
}
export type GrantRecordPart =
  | ({ readonly part: 'grant' } & Omit<GrantBookkeeping, 'object'>)
  | {
      readonly part: 'object';
      readonly grantId: string;
      readonly object: GrantBookkeeping['object'];
    }
  | {
      readonly part: 'view';
      readonly grantId: string;
      readonly encKeyPrefix: string;
      readonly seal: string;
    };
export type OpenedInboxEntry =
  | { readonly kind: 'coin'; readonly coin: ShieldedCoin }
  | { readonly kind: 'device'; readonly device: DeviceReader }
  | { readonly kind: 'grant'; readonly record: GrantRecordPart };
/**
 * Random account viewing secrets remain inside this port. The account flow receives only the
 * public encryption key, sealed device deliveries, opened inbox data or sealed read grants.
 * This is distinct from the prototype's passkey-derived `EncryptionKeySource`.
 */
export interface AccountViewingKey {
  /** Decode a roster's compressed JubJub device key; malformed points return undefined. */
  decodeDevicePublicKey?(compressedHex: string): CurvePoint | undefined;
  /** Decode a canonical compressed P-256 authoriser key for live roster matching. */
  decodeP256DevicePublicKey?(compressedHex: string): P256PublicKey | undefined;
  readerPublicKey(networkId: string): Promise<Uint8Array>;
  createKeys(networkId: string, request: CreateAccountKeys): Promise<AccountKeys>;
  sealToDevice(
    networkId: string,
    keyring: AccountKeyring,
    reader: LiveDeviceReader,
  ): Promise<DeviceDelivery>;
  openInbox(
    networkId: string,
    keyring: AccountKeyring,
    entries: readonly Uint8Array[],
  ): Promise<(OpenedInboxEntry | null)[]>;
  sealGrant(networkId: string, account: string, grant: GrantBookkeeping): Promise<Uint8Array[]>;
  reencryptInbox?(
    networkId: string,
    rotation: { readonly keyring: AccountKeyring; readonly to: Uint8Array },
    entries: readonly Uint8Array[],
  ): Promise<(Uint8Array | null)[]>;
  sealView?(
    networkId: string,
    keyring: AccountKeyring,
    request: { readonly grantId: string; readonly account: string; readonly readPublicKey: string },
  ): Promise<{ readonly seal: Uint8Array; readonly entry: Uint8Array }>;
}

/**
 * A host's chain-backed custody walk. It confirms which opened coin descriptions correspond to
 * distinct outputs actually received by the ACC; inbox ciphertext alone is not proof of a holding.
 */
export interface VerifiedHoldingSource {
  selectHeldEntries(
    account: string,
    entries: readonly Uint8Array[],
    opened: readonly (OpenedInboxEntry | null)[],
  ): Promise<readonly number[]>;
}

export interface CallRequest extends FlowOptions {
  readonly address: string;
  readonly circuit: string;
  readonly args: readonly unknown[];
}
export type TxResult = PassportTxResult;
export interface Chain {
  call(request: CallRequest): Promise<TxResult>;
  /** Opt in to bounded inbox entries and live device commitments for owner flows. */
  readAccount(
    address: string,
    options?: { readonly includeInbox?: boolean; readonly includeDevices?: boolean },
  ): Promise<AccLedgerView | undefined>;
}

export interface DeployRequest extends FlowOptions {
  /** The 32-byte boot commitment, and the ACC's `enc_key`. */
  readonly boot: Uint8Array;
  readonly encKey: Uint8Array;
  /** Irreversible, so no default (D-11). */
  readonly retireAuthority: boolean;
  /** Which device arm receives the first verifier-key wave. Omitted only by legacy P-256 hosts. */
  readonly firstArm?: 'p256' | 'jubjub';
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
  /** Sealed device entries retained until a deployed JubJub account has appended them on chain. */
  readonly keyEntries?: readonly Uint8Array[];
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
  readonly pureCircuits: AccPureCircuits & Partial<JubjubPureCircuits>;
}
/** A value, or a loader the core calls once, so heavy code stays behind `import()`. */
export type Lazy<T> = T | (() => Promise<T>);

export interface PassportPorts {
  readonly network: NetworkConfig;
  readonly binding: Lazy<AccBinding>;
  readonly credentials: CredentialPort;
  readonly authoriser: Authoriser;
  readonly encryptionKey: EncryptionKeySource;
  /** Random ACC viewing secret behind sealed device envelopes. */
  readonly viewingKey?: AccountViewingKey;
  readonly holdings?: VerifiedHoldingSource;
  readonly readGrants?: ActiveReadGrantTargetSource;
  /** Live ACC grant map, used to pin issue consent and confirm settlement. */
  readonly grants?: ActiveGrantSnapshotSource;
  /** Live individual grant detail and inactive tombstones for settled revocation. */
  readonly grantDetails?: GrantDetailSource;
  readonly grantRoster?: GrantRosterSource;
  /** Must outlive crashes between issue submission and sealed bookkeeping publication. */
  readonly grantJournal?: GrantPublicationJournal;
  /** Trusted relying party id; never taken from a DApp's grant request. */
  readonly grantOrigin?: string;
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
