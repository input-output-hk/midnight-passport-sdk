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

/** Public joining keys; the compressed device key must derive the enrolled ACC commitment. */
export interface JubjubDeviceReader {
  readonly readerPublicKey: string;
  readonly devicePublicKey: string;
}

export interface DeviceEnrollmentResult extends PassportTxResult {
  readonly commitmentHex: string;
  readonly nextUseCounter: bigint;
  /** Present when live read grants required a viewing and roster key rotation. */
  readonly rotationTxHash?: string;
  readonly sealedReadGrants?: ViewingKeyRotationResult['sealedReadGrants'];
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

export type GrantOperation =
  'withdraw-unshielded' | 'withdraw-shielded' | 'withdraw-shielded-to-contract';
export type GrantRecipient =
  | { readonly kind: 'any' }
  | {
      readonly kind: 'user-address' | 'coin-public-key' | 'contract-address';
      readonly value: string;
    };

/** Owner request shape aligned with Lace; amounts are decimal unsigned 128-bit strings. */
export interface GrantScopeInput {
  readonly grantee: { readonly scheme: 'jubjub-schnorr'; readonly publicKey: string };
  readonly operations: readonly GrantOperation[];
  readonly color: string;
  readonly recipient: GrantRecipient;
  readonly maxCoinValue: string;
  readonly perCallCap: string;
  readonly cap: string;
  readonly expiresAt: number | null;
  readonly window?: { readonly lengthSeconds: number; readonly cap: string };
  readonly read?: boolean;
  readonly readPublicKey?: string;
  readonly caller?: string;
  readonly rpId?: string;
}

/** Settled unshielded spend grant; both sealed bookkeeping parts are live in the ACC inbox. */
export interface PassportGrantIssueResult extends PassportTxResult {
  readonly grantId: string;
  readonly slot: number;
  readonly scopeDigest: string;
  readonly status: 'active';
  readonly appendTxHashes: readonly string[];
  readonly nextUseCounter: bigint;
}

/** A grant confirmed inactive in the live ACC grant map. */
export interface PassportGrantRevokeResult extends PassportTxResult {
  readonly grantId: string;
  readonly status: 'revoked';
  readonly nextUseCounter: bigint;
}

/** All grants and tombstones cleared in the next ACC grant generation. */
export interface PassportGrantRevokeAllResult extends PassportTxResult {
  readonly status: 'cleared';
  readonly generation: bigint;
  readonly nextUseCounter: bigint;
}

export interface PassportGrantRecoveryResult {
  readonly published: readonly {
    readonly grantId: string;
    readonly status: 'active';
    readonly appendTxHashes: readonly string[];
    readonly nextUseCounter: bigint;
  }[];
  readonly unsettledGrantIds: readonly string[];
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
  /** JubJub owner operation; rotates first when live read grants require a fresh account key. */
  addDevice?(reader: JubjubDeviceReader, options?: FlowOptions): Promise<DeviceEnrollmentResult>;
  /** JubJub accounts can read only chain-confirmed shielded holdings through their viewing key. */
  readShieldedHoldings?(options?: FlowOptions): Promise<readonly PassportShieldedHolding[]>;
  /** JubJub owner issue; the host pins the origin and supplies durable grant bookkeeping. */
  issueGrant?(scope: GrantScopeInput, options?: FlowOptions): Promise<PassportGrantIssueResult>;
  /** JubJub owner revoke for a grant without read access; confirms the inactive tombstone. */
  revokeGrant?(grantId: string, options?: FlowOptions): Promise<PassportGrantRevokeResult>;
  /** JubJub owner revoke-all when no read grants are live; confirms the new generation. */
  revokeAllGrants?(options?: FlowOptions): Promise<PassportGrantRevokeAllResult>;
  /** Resume durable grant publication without submitting another issue call. */
  recoverPendingGrants?(options?: FlowOptions): Promise<PassportGrantRecoveryResult>;
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
