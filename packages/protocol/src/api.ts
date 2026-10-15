// The account API v1 (design §3.1, §3.2), the account owner's surface (D-8). The prototype called
// it the "DApp Connector API"; its shapes remain as deprecated `…Prototype` types (connector.ts).
import type { CreateAccountStep, PassportEvent } from './events.js';

export const PASSPORT_NETWORK_UNDEPLOYED = 'undeployed';

/** The authoriser arm an account's device key belongs to (#24). */
export type AuthScheme = 'p256-webauthn' | 'jubjub-schnorr' | 'k256-ecdsa';

/** The part of an `AbortSignal` a flow watches; the real one satisfies it. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

export interface FlowOptions {
  /** Aborting it ends the flow with `Aborted`. */
  readonly signal?: AbortSignalLike;
  readonly onEvent?: (event: PassportEvent) => void;
}

export interface CreateAccountOptions extends FlowOptions {
  readonly userName: string;
  /** Retire the maintenance authority at deploy. Irreversible, so required, with no default (D-11). */
  readonly retireAuthority: boolean;
  /** @deprecated since 1.0.0: use `onEvent`. Removed in 2.0.0. */
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

export interface ViewingKeyRotationResult extends PassportTxResult {
  /** Live device commitments that lacked a unique, usable reader registration. */
  readonly droppedDeviceEntries: readonly string[];
  /** Confirmed view seals for the host's grant record and agent policy export. */
  readonly sealedReadGrants: readonly {
    readonly grantId: string;
    readonly readPublicKey: string;
    readonly seal: Uint8Array;
    readonly sealedEncKey: string;
  }[];
  /** Active read grants without a usable read-key opening or seal; these cannot read future holdings. */
  readonly unsealedGrantIds: readonly string[];
}

/** A device removal rotates the viewing and roster keys before revoking its ACC entry. */
export interface DeviceRemovalResult extends ViewingKeyRotationResult {
  readonly removedCommitmentHex: string;
  readonly rotationTxHash: string;
}

export interface PassportShieldedHolding {
  /** ACC inbox index of the sealed description confirmed against a chain-created output. */
  readonly inboxIndex: number;
  readonly coin: {
    readonly nonce: Uint8Array;
    readonly color: Uint8Array;
    readonly value: bigint;
  };
}

export interface PassportAccount {
  readonly address: string;
  readonly networkId: string;
  /** The binding the account was deployed from. */
  readonly bindingId: string;
  readonly scheme: AuthScheme;
  /** Passkey-backed arms: the credential later ceremonies pin to. Not a secret. */
  readonly credentialId?: Uint8Array;
  state(): Promise<PassportAccountState>;
  rotateEncryptionKey(newKey: Uint8Array, options?: FlowOptions): Promise<PassportTxResult>;
  /** JubJub accounts rotate a random sealed viewing secret; requires a verified holding source. */
  rotateViewingKey?(options?: FlowOptions): Promise<ViewingKeyRotationResult>;
  /** JubJub owner operation; refuses self-removal and a target absent from the live ACC. */
  removeDevice?(commitmentHex: string, options?: FlowOptions): Promise<DeviceRemovalResult>;
  /** JubJub accounts can read only chain-confirmed shielded holdings through their viewing key. */
  readShieldedHoldings?(options?: FlowOptions): Promise<readonly PassportShieldedHolding[]>;
}

export interface PassportConnectorAPI {
  /** The `PASSPORT_API_VERSION` implemented. */
  readonly apiVersion: string;
  readonly networkId: string;
  /** The binding new accounts are deployed from. */
  readonly bindingId: string;
  createAccount(options: CreateAccountOptions): Promise<PassportAccount>;
  openAccount(options?: FlowOptions): Promise<PassportAccount>;
}

export interface ConnectOptions {
  /** A semver range of API versions the caller accepts; refused with `ApiVersionUnsupported`. */
  readonly apiVersion?: string;
}

/** What a host installs, frozen, at `window.midnight.passport`. */
export interface PassportConnectorDescriptor {
  /** Reverse-DNS id of the host, for example 'io.lace.passport'. */
  readonly rdns: string;
  readonly name: string;
  /** A data URI. */
  readonly icon?: string;
  /** The `PASSPORT_API_VERSION` the host implements. */
  readonly apiVersion: string;
  /** Binding ids the host can open; the first is the one it deploys. */
  readonly bindings: readonly string[];
  connect(networkId: string, options?: ConnectOptions): Promise<PassportConnectorAPI>;
}

/** @deprecated since 1.0.0-pre.0: use `CreateAccountOptions`, of which it is an alias. */
export type CreateAccountOptionsV1 = CreateAccountOptions;
/** @deprecated since 1.0.0-pre.0: use `PassportAccount`, of which it is an alias. */
export type PassportAccountV1 = PassportAccount;
/** @deprecated since 1.0.0-pre.0: use `PassportConnectorAPI`, of which it is an alias. */
export type PassportConnectorAPIV1 = PassportConnectorAPI;
/** @deprecated since 1.0.0-pre.0: use `PassportConnectorDescriptor`, of which it is an alias. */
export type PassportConnectorDescriptorV1 = PassportConnectorDescriptor;
