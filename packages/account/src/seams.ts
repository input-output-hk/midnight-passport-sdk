import type { FlowOptions, PassportTxResult } from '@midnight-ntwrk/mn-passport-protocol';

export interface P256PublicKey {
  readonly x: bigint;
  readonly y: bigint;
  readonly identity: false;
}
/** WebAuthn binding the contract enrols: SHA-256 of the RP id, and the 21-byte origin. */
export interface WebAuthnPolicy {
  readonly rp_id_hash: Uint8Array;
  readonly origin: Uint8Array;
}

export interface PasskeyCredential {
  readonly credentialId: Uint8Array;
  readonly publicKey: P256PublicKey;
  readonly policy: WebAuthnPolicy;
}
/** The signed material the P-256 arm consumes; validated client-side by the adapter. */
export interface PasskeySignature {
  readonly authenticator_data: Uint8Array;
  readonly sig: { readonly r: bigint; readonly s: bigint };
}
/** What the discoverable-credential prompt proves about the passkey the user picked. */
export interface PasskeyIdentity {
  readonly credentialId: Uint8Array;
  /**
   * True only when the assertion `identify()` already obtained verifies under `publicKey` and
   * `policy` (wa-json134). It binds an untrusted registry record to the picked passkey without a
   * second prompt (Ruling R10(b)); a record naming another account's key answers false.
   */
  owns(publicKey: P256PublicKey, policy: WebAuthnPolicy): boolean;
}
export interface PasskeySeam {
  create(userName: string): Promise<PasskeyCredential>;
  /** Discoverable-credential prompt: which credential the user picked, and proof it holds a key. */
  identify(): Promise<PasskeyIdentity>;
  sign(credential: PasskeyCredential, challenge: Uint8Array): Promise<PasskeySignature>;
}

export type AccountStatus = 'deployed' | 'active';
export interface AccountRecord {
  readonly credentialId: Uint8Array;
  readonly address: string;
  readonly publicKey: P256PublicKey;
  readonly policy: WebAuthnPolicy;
  /** Opens the boot commitment; needed to activate a deployed account. */
  readonly salt: Uint8Array;
  readonly status: AccountStatus;
}
export interface RegistrySeam {
  put(networkId: string, record: AccountRecord): Promise<void>;
  get(networkId: string, credentialId: Uint8Array): Promise<AccountRecord | undefined>;
}

/** The ledger facts the MVP flows read (spec §5). */
export interface AccLedgerView {
  readonly booted: boolean;
  readonly authNonce: bigint;
  readonly deviceEpoch: bigint;
  readonly entryCount: number;
  readonly specVersion: number;
  hasEntry(entry: Uint8Array): boolean;
}
export interface ConstructorArgs {
  readonly boot: Uint8Array;
  readonly encKey: Uint8Array;
}
export type MvpCircuit = 'activate_initial_device_with_p256' | 'rotate_enc_key_with_p256';
export interface ChainSeam {
  /**
   * Deploys the account. Despite the name, `txHashes` are the waves' submission ids, not the
   * hashes of the transactions as included (Final review M4); `call` answers the real `txHash`.
   */
  deploy(
    args: ConstructorArgs,
  ): Promise<{ readonly address: string; readonly txHashes: readonly string[] }>;
  readLedger(address: string): Promise<AccLedgerView | undefined>;
  /** `options` carries the flow's signal and `onEvent`, for the steps the call reports itself. */
  call(
    address: string,
    circuit: MvpCircuit,
    args: readonly unknown[],
    options?: FlowOptions,
  ): Promise<PassportTxResult>;
}

type ContractAddressArg = { readonly bytes: Uint8Array };
/** The subset of the generated module's pure circuits the MVP calls (Compact runs them in JS). */
export interface AccPureCircuits {
  derive_boot_commitment_with_p256(
    salt: Uint8Array,
    pk: P256PublicKey,
    policy: WebAuthnPolicy,
  ): Uint8Array;
  derive_device_entry_with_p256(
    self: ContractAddressArg,
    pk: P256PublicKey,
    policy: WebAuthnPolicy,
    epoch: bigint,
    counter: bigint,
  ): Uint8Array;
  challenge_rotate_enc_key_with_p256(
    self: ContractAddressArg,
    pk: P256PublicKey,
    key: Uint8Array,
    nonce: bigint,
  ): Uint8Array;
}

export interface PassportSeams {
  readonly networkId: string;
  readonly bindingId: string;
  readonly pureCircuits: AccPureCircuits;
  readonly passkey: PasskeySeam;
  readonly chain: ChainSeam;
  readonly registry: RegistrySeam;
  /** Cryptographically secure random bytes. */
  random(length: number): Uint8Array;
  /**
   * The account's 32-byte X25519 encryption key, for the passkey just created. The browser derives
   * it from the passkey's PRF (Lace recipe v1, MIP-0015): from the PRF outputs the provider
   * returned at creation when it did (no prompt), else from one more PRF ceremony. The MVP keeps
   * no inbox.
   */
  encryptionKey(credential: PasskeyCredential): Uint8Array | Promise<Uint8Array>;
}
