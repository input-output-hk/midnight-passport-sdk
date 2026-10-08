// The service's HTTP wire v1 (design §4.1, §3.4), exported as `ServiceWire`. Every path sits under
// `PASSPORT_SERVICE_PATH_PREFIX`; bodies are JSON and bytes travel as lowercase hex, bigints as
// lowercase hex without `0x`.
import type { AuthScheme } from './api.js';
import type { PassportErrorCode } from './errors.js';
import type { PassportEvent } from './events.js';

/** Non-empty lowercase hex. */
export type Hex = string;

/** The body of every refusal (a non-2xx status); the client maps the status to a code. */
export interface ErrorBody {
  readonly error: string;
}

/** `GET /v1/config`. Clients check it against their build-time network pin and never trust it. */
export interface Config {
  readonly networkId: string;
  /** The binding new accounts are deployed from, and the manifest hash it is pinned to. */
  readonly bindingId: string;
  readonly manifestSha256: Hex;
  readonly indexerUri: string;
  readonly indexerWsUri: string;
  readonly nodeUri: string;
  readonly proofServerUri: string;
  /** Base URL of the artefact host for `bindingId`: `…/v1/zk/{bindingId}`. */
  readonly zkBaseUrl: string;
  /** The sponsor's keys. */
  readonly coinPublicKey: Hex;
  readonly encryptionPublicKey: Hex;
  /** The service API versions this service serves, one per path prefix. */
  readonly apiVersions: readonly string[];
}

/** A transaction, unproven or proven, unbalanced or balanced. */
export interface TxBody {
  readonly tx: Hex;
}
/** `POST /v1/prove-tx`, answered `202 JobAccepted`; the job's result is the proven `TxBody`. */
export type ProveTxRequest = TxBody;
export type ProveTxResult = TxBody;
/** `POST /v1/sponsor/balance`, answered `200` with the balanced and signed `TxBody`. */
export type SponsorBalanceRequest = TxBody;
export type SponsorBalanceResponse = TxBody;
/** `POST /v1/sponsor/submit`, answered `200` with the submission id. */
export type SponsorSubmitRequest = TxBody;
export interface SponsorSubmitResponse {
  readonly txId: string;
}

/** `POST /v1/deploy`, answered `202 JobAccepted`; the job's result is a `DeployResult`. */
export interface DeployRequest {
  /** The 32-byte boot commitment. */
  readonly boot: Hex;
  /** The 32-byte X25519 public key, the ACC's `enc_key`. */
  readonly encKey: Hex;
  /** Retire the maintenance authority after the waves; required, no default (D-11). */
  readonly retireAuthority: boolean;
}
export interface DeployResult {
  readonly address: Hex;
  /** Each wave's submission id, in order. */
  readonly txIds: readonly string[];
}

export interface JobAccepted {
  readonly jobId: string;
}

export type JobState = 'queued' | 'running' | 'done' | 'failed';

/** `GET /v1/jobs/{jobId}?after={cursor}`: the events after `cursor`, and the outcome once known. */
export interface Job<Result> {
  readonly state: JobState;
  /** Stamped by the service (`clock: 'service'`). */
  readonly events: readonly PassportEvent[];
  /** Opaque; the next poll passes it as `after`. */
  readonly cursor: string;
  /** When `state` is `done`. */
  readonly result?: Result;
  /** When `state` is `failed`. */
  readonly error?: { readonly code: PassportErrorCode; readonly message: string };
}

/** A curve point; each coordinate a hex bigint. */
export interface PointBody {
  readonly x: Hex;
  readonly y: Hex;
}
/** An `AccountHint` of account/ports. The directory never vouches for it (D-12). */
export interface AccountHintBody {
  readonly address: Hex;
  readonly scheme: AuthScheme;
  readonly credentialId?: Hex;
  readonly publicKey: PointBody;
  readonly policy?: { readonly rp_id_hash: Hex; readonly origin: Hex };
  readonly salt?: Hex;
  readonly status: 'deployed' | 'active';
}
/** An `OwnershipProof` of account/ports. */
export type OwnershipProofBody =
  | {
      readonly scheme: 'p256-webauthn';
      readonly challenge: Hex;
      readonly authenticatorData: Hex;
      readonly clientDataJSON: Hex;
      readonly signature: Hex;
    }
  | {
      readonly scheme: 'jubjub-schnorr';
      readonly challenge: Hex;
      readonly sigR: PointBody;
      readonly sigS: Hex;
    };
/**
 * `PUT /v1/accounts/{networkId}/{key}`, answered `204`. Write-once, except `deployed` to `active`.
 * `key` is the hex `DirectoryKey` (the credential id).
 */
export interface DirectoryPutRequest {
  readonly hint: AccountHintBody;
  readonly proof?: OwnershipProofBody;
}
/** `GET /v1/accounts/{networkId}/{key}`, answered `200`, or `404` when there is no hint. */
export type DirectoryGetResponse = AccountHintBody;
