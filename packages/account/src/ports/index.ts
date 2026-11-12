import type { PartialShieldedWithdrawalHost } from '../partial-shielded-withdrawal.js';
export type { PartialShieldedWithdrawalHost } from '../partial-shielded-withdrawal.js';
export type { ShieldedWithdrawalFinalitySource } from '../shielded-withdrawal-recovery.js';
export type { P256UnshieldedGrantScope } from '../p256-grant-opening.js';
export type {
  AgentGrantSpendReceiptStore,
  AgentGrantSpendReservation,
  P256GrantSpendReceiptStore,
} from '../p256-grant-spend-recovery.js';
export type { P256GrantSpendReservation } from '../p256-grant-holder.js';
export type {
  ShieldedWithdrawalJournal,
  ShieldedWithdrawalReservation,
} from '../shielded-withdrawal-journal.js';
export type { LiveP256GrantSpendContext, P256GrantSpendSource } from './p256-grant-spend.js';
import type { Authoriser, CredentialPort } from './authorisation.js';
export type {
  Authoriser,
  CredentialPort,
  CredentialRef,
  FlowDescriptor,
  ChallengeBuilder,
  AuthorisationRequest,
  P256Authorisation,
  JubjubAuthorisation,
  Authorisation,
} from './authorisation.js';
export type { PasskeyIdentity } from '../seams.js';
// The ports of the account core (design §2.1, D-2, D-4), exported as `./ports`: types only, so an
// adapter or a host gets the interfaces without the flows. Where a port means what a lace-platform
// seam means, it takes that seam's member names and compatible shapes where possible. The current
// Lace authoriser still needs a key-session flow adapter; see docs/compatibility.md. Members use
// method syntax so a host's tagged parameter types can fit where their flow contracts agree.
import type {
  AuthScheme,
  FlowOptions,
  PassportAccount,
  PassportTxResult,
} from '@input-output-hk/mn-passport-protocol';
import type {
  AccLedgerView,
  AccPureCircuits,
  JubjubPureCircuits,
  P256PublicKey,
  WebAuthnPolicy,
} from '../seams.js';
import type { GrantPublicationJournal } from '../jubjub-grant-publication.js';

export type {
  PassportNameQuery,
  PassportNameRecord,
  PassportNameProvider,
  PassportNameService,
} from './names.js';

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
export interface LiveGrantCommitment {
  readonly active: boolean;
  readonly read: boolean;
  readonly authNonce: bigint;
  readonly objectCommit: Uint8Array;
  readonly readPkHash: Uint8Array;
}
export interface GrantCommitmentSource {
  readGrantCommitment(account: string, grantId: string): Promise<LiveGrantCommitment | undefined>;
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
    redirect?: 'error';
    headers?: Record<string, string>;
    body?: string;
    signal?: FetchAbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  /** Optional streaming response enables adapters to bound bytes before JSON parsing. */
  readonly headers?: { get(name: string): string | null };
  readonly body?: {
    getReader(): {
      read(): Promise<{ done?: boolean; value?: Uint8Array | undefined }>;
      cancel(): Promise<void>;
      releaseLock(): void;
    };
  } | null;
}>;

/** An affine point: P-256 for the WebAuthn arm, JubJub for the PRF arm. */
export interface CurvePoint {
  readonly x: bigint;
  readonly y: bigint;
}

// ---- Core-facing ports

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
/** Private `held_coin` input, qualified by the output's Merkle tree index. */
export interface QualifiedShieldedCoin extends ShieldedCoin {
  readonly mt_index: bigint;
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
  /** A nonempty request authenticates the live keyring even if every opened item is null.
   * Empty batches may be a transport no-op; callers must not use them to validate ownership. */
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

/** A received-output source that also resolves the output's Merkle position for `held_coin`. */
export interface QualifiedHoldingSource extends VerifiedHoldingSource {
  selectQualifiedHeldCoins(
    account: string,
    entries: readonly Uint8Array[],
    opened: readonly (OpenedInboxEntry | null)[],
  ): Promise<readonly { readonly inboxIndex: number; readonly coin: QualifiedShieldedCoin }[]>;
}

export interface MutationSubmissionContext {
  readonly requestId: string;
  readonly intentSha256: string;
  readonly validUntilSeconds?: number;
}
export interface CallRequest extends FlowOptions {
  /** Host receipt correlation only; never substitute this for a finalized chain result. */
  readonly mutation?: MutationSubmissionContext;
  readonly address: string;
  readonly circuit: string;
  readonly args: readonly unknown[];
  /** Per-call private input for ACC shielded spends; omitted from proof-service metadata. */
  readonly heldCoin?: QualifiedShieldedCoin;
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

/** A chain that exposes the network and binding it uses for each call. */
export interface PinnedChain extends Chain {
  readonly networkId: string;
  readonly bindingId: string;
}

export interface DeadlineFencedGrantIssueRequest extends CallRequest {
  readonly circuit: 'issue_grant_with_jubjub' | 'issue_grant_with_p256';
  readonly mutation: MutationSubmissionContext & { readonly validUntilSeconds: number };
}

export interface DurableAgentGrantSpendRequest extends CallRequest {
  readonly circuit: 'withdraw_unshielded_with_grant_jubjub';
  readonly mutation: MutationSubmissionContext & { readonly validUntilSeconds: number };
}

export interface DurableAgentGrantSpendPort {
  submitDurableAgentGrantSpend(request: DurableAgentGrantSpendRequest): Promise<TxResult>;
}

/** Carry the original request through proving, balancing and final broadcast with its deadline. */
export interface DeadlineFencedGrantIssuePort {
  submitDeadlineFencedGrantIssue(request: DeadlineFencedGrantIssueRequest): Promise<TxResult>;
}

export interface DeployRequest extends FlowOptions {
  readonly mutation?: MutationSubmissionContext;
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
  /** Runs after a verified open, inside an optional credential login scope. Never runs on create
   * or failed open. A host may adopt already-unlocked routine keys; the core retains no secrets. */
  readonly onAccountOpened?: (account: PassportAccount) => Promise<void>;
  /** Opt-in handoff after confirmed creation and sealed-key readiness, inside its key scope.
   * Failure does not undo deployment; retain original creation records for reopening. */
  readonly onAccountCreated?: (account: PassportAccount) => Promise<void>;
  readonly authoriser: Authoriser;
  readonly encryptionKey: EncryptionKeySource;
  /** Random ACC viewing secret behind sealed device envelopes. */
  readonly viewingKey?: AccountViewingKey;
  /** Optional host-approved, bounded reader session. Used only for verified holdings reads;
   * never for owner signatures, key delivery, grants or account changes. */
  readonly routineViewingKey?: (context: {
    readonly account: string;
    readonly networkId: string;
    readonly bindingId: string;
    readonly credentialId: Uint8Array;
  }) => Pick<AccountViewingKey, 'openInbox'> | undefined;
  readonly holdings?: VerifiedHoldingSource;
  readonly partialShieldedWithdrawal?: PartialShieldedWithdrawalHost;
  readonly readGrants?: ActiveReadGrantTargetSource;
  /** Live ACC grant map, used to pin issue consent and confirm settlement. */
  readonly grants?: ActiveGrantSnapshotSource;
  /** Chain-backed commitments that authenticate staged openings before publication. */
  readonly grantCommitments?: GrantCommitmentSource;
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
  /** A known fee-only provider can reject shielded offers before expensive proving. */
  readonly supportsShieldedOffers?: boolean;
  balanceAndSign(unbalancedTx: Uint8Array): Promise<Uint8Array>;
}
/** Hand a proved, unbound grant issue to a host that retains and dispatches the original. */
export interface GrantIssueSponsorPort {
  execute(
    proven: Uint8Array,
    request: MutationSubmissionContext & { readonly address: string; readonly circuit: string },
    signal?: FlowOptions['signal'],
  ): Promise<PassportTxResult>;
}

export interface Submitter {
  /** Answers the submission id. */
  submit(
    finalisedTx: Uint8Array,
    context?: {
      readonly mutation: MutationSubmissionContext;
      readonly address: string;
      readonly circuit: string;
      readonly signal?: FlowOptions['signal'];
    },
  ): Promise<string>;
}

export type { SecretReference, StoredSecret, SecretStore } from './secrets.js';

export type { BackgroundPort, BackgroundClient } from './background.js';

export type {
  MutationJournal,
  MutationByteStore,
  MutationConsent,
  MutationOutcomeSource,
  MutationOutcome,
  MutationEffect,
  MutationDocument,
  MutationPins,
} from '../mutation-types.js';
