// The prototype's "DApp Connector API" (prototype spec §4.1), version 0.1.0-prototype. The account
// API v1 (api.ts) replaces it (D-8); only the deprecated `createPassportConnector` still serves it.
import type { FlowOptions, PassportAccountState, PassportTxResult } from './api.js';
import type { CreateAccountStep } from './events.js';

/**
 * @deprecated since 1.0.0: the prototype connector's version. Use `PASSPORT_API_VERSION`. Removed
 * in 2.0.0.
 */
export const PASSPORT_CONNECTOR_VERSION = '0.1.0-prototype';

/** @deprecated since 1.0.0: use `CreateAccountOptions`. Removed in 2.0.0. */
export interface CreateAccountOptionsPrototype extends FlowOptions {
  readonly userName: string;
  readonly onProgress?: (step: CreateAccountStep) => void;
}

/** @deprecated since 1.0.0: use `PassportAccount`. Removed in 2.0.0. */
export interface PassportAccountPrototype {
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
  rotateEncryptionKey(newKey: Uint8Array, options?: FlowOptions): Promise<PassportTxResult>;
}

/** @deprecated since 1.0.0: use `PassportConnectorAPI`. Removed in 2.0.0. */
export interface PassportConnectorAPIPrototype {
  readonly apiVersion: typeof PASSPORT_CONNECTOR_VERSION;
  readonly networkId: string;
  createAccount(options: CreateAccountOptionsPrototype): Promise<PassportAccountPrototype>;
  openAccount(options?: FlowOptions): Promise<PassportAccountPrototype>;
}
