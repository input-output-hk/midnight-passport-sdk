// The prototype's "DApp Connector API" (prototype spec §4.1), version 0.1.0-prototype. The account
// connector and the demo still implement it; the account API v1 (api.ts) replaces it (D-8).
import type { FlowOptions, PassportAccountState, PassportTxResult } from './api.js';
import type { CreateAccountStep } from './events.js';

/**
 * @deprecated since 1.0.0: the prototype connector's version. Use `PASSPORT_API_VERSION`. Removed
 * in 2.0.0.
 */
export const PASSPORT_CONNECTOR_VERSION = '0.1.0-prototype';

/** @deprecated since 1.0.0: use `CreateAccountOptionsV1`, whose shape this name takes. */
export interface CreateAccountOptions extends FlowOptions {
  readonly userName: string;
  readonly onProgress?: (step: CreateAccountStep) => void;
}

/** @deprecated since 1.0.0: use `PassportAccountV1`, whose shape this name takes. */
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
  rotateEncryptionKey(newKey: Uint8Array, options?: FlowOptions): Promise<PassportTxResult>;
}

/** @deprecated since 1.0.0: use `PassportConnectorAPIV1`, whose shape this name takes. */
export interface PassportConnectorAPI {
  readonly apiVersion: typeof PASSPORT_CONNECTOR_VERSION;
  readonly networkId: string;
  createAccount(options: CreateAccountOptions): Promise<PassportAccount>;
  openAccount(options?: FlowOptions): Promise<PassportAccount>;
}

/** @deprecated since 1.0.0: use `PassportConnectorDescriptorV1`, whose shape this name takes. */
export interface PassportConnectorDescriptor {
  readonly name: string;
  readonly apiVersion: typeof PASSPORT_CONNECTOR_VERSION;
  connect(networkId: string): Promise<PassportConnectorAPI>;
}
