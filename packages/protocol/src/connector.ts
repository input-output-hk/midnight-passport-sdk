// Prototype Midnight Passport DApp Connector API (spec §4.1). Types and
// constants only, as everything in protocol: the implementation is
// mn-passport-account's, and a wallet (lace-sdk) exposes it to dApps.

export const PASSPORT_CONNECTOR_VERSION = '0.1.0-prototype';
export const PASSPORT_ERROR_TYPE = 'PassportConnectorError';
export const PASSPORT_NETWORK_UNDEPLOYED = 'undeployed';

export const PASSPORT_ERROR_CODES = Object.freeze([
  'UserCancelled',
  'UnsupportedAuthenticator',
  'AccountNotFound',
  'ArtefactIntegrity',
  'ProverUnavailable',
  'SponsorRejected',
  'NetworkMismatch',
  'InternalError',
] as const);

export type PassportErrorCode = (typeof PASSPORT_ERROR_CODES)[number];

/** The shape every connector error has; discriminate on `type` and `code`. */
export interface PassportErrorShape extends Error {
  readonly type: typeof PASSPORT_ERROR_TYPE;
  readonly code: PassportErrorCode;
}

export type CreateAccountStep =
  'passkey-created' | 'deploying' | 'deployed' | 'activating' | 'active';

export interface CreateAccountOptions {
  readonly userName: string;
  readonly onProgress?: (step: CreateAccountStep) => void;
}

export interface PassportTxResult {
  readonly txHash: string;
  readonly blockHeight?: number;
}

export interface PassportAccountState {
  readonly booted: boolean;
  readonly authNonce: bigint;
  readonly deviceEpoch: bigint;
  /** Entries in the device set; not a device count (erratum 8). */
  readonly entryCount: number;
  readonly specVersion: number;
}

export interface PassportAccount {
  readonly address: string;
  readonly networkId: string;
  /** The artefact build the account was deployed from, e.g. 'acc-45721e1'. */
  readonly bindingId: string;
  /**
   * The WebAuthn credential id of the passkey the account was created with. Not a secret; a wallet
   * pins its later ceremonies to it (`allowCredentials`), so the browser offers no other passkey.
   */
  readonly credentialId: Uint8Array;
  state(): Promise<PassportAccountState>;
  /** MVP passkey-authorised call: rotates the account's encryption key. */
  rotateEncryptionKey(newKey: Uint8Array): Promise<PassportTxResult>;
}

export interface PassportConnectorAPI {
  readonly apiVersion: typeof PASSPORT_CONNECTOR_VERSION;
  readonly networkId: string;
  createAccount(options: CreateAccountOptions): Promise<PassportAccount>;
  openAccount(): Promise<PassportAccount>;
}

/** What a wallet injects at `window.midnight.passport`. */
export interface PassportConnectorDescriptor {
  readonly name: string;
  readonly apiVersion: typeof PASSPORT_CONNECTOR_VERSION;
  connect(networkId: string): Promise<PassportConnectorAPI>;
}
