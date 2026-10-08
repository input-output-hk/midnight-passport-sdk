// Error codes v1 (design §3.3). PascalCase codes; lace-platform's kebab-case codes map onto them.
import type { PassportStep } from './events.js';

export const PASSPORT_ERROR_TYPE = 'PassportConnectorError';

export interface PassportErrorInfo {
  /** Whether a retry can succeed. `'maybe'` depends on the cause; the error's own flag decides. */
  readonly retryable: boolean | 'maybe';
  /** The lace-platform codes (and one error class name) that mean this code. */
  readonly lace: readonly string[];
}

const row = (retryable: boolean | 'maybe', ...lace: string[]): PassportErrorInfo =>
  Object.freeze({ retryable, lace: Object.freeze(lace) });

const TABLE = {
  UserCancelled: row(true, 'ceremony-cancelled'),
  UnsupportedAuthenticator: row(false, 'prf-unsupported'),
  WrongPasskey: row(true, 'PasskeyCredentialMismatchError'),
  AccountNotFound: row(false, 'account-not-found', 'account-contract-missing'),
  EncryptionKeyMismatch: row(false, 'encryption-key-mismatch'),
  NotAuthorised: row(false, 'not-authorised'),
  DeviceEntryNotFound: row(false, 'device-entry-not-found'),
  BindingUnsupported: row(false),
  ArtefactIntegrity: row(false, 'artefact-integrity'),
  ProverUnavailable: row(true, 'proof-server'),
  SponsorRejected: row('maybe', 'sponsor-exhausted'),
  NetworkMismatch: row(false),
  ApiVersionUnsupported: row(false),
  Aborted: row(true),
  // Anything else, from Passport or from lace-platform: a defect.
  InternalError: row(false),
};

/** A minor release may add codes; consumers treat a code they do not know as `InternalError`. */
export type PassportErrorCode = keyof typeof TABLE;

/** Every v1 code, with its retry flag and its lace-platform codes. */
export const PASSPORT_ERRORS: Readonly<Record<PassportErrorCode, PassportErrorInfo>> =
  Object.freeze(TABLE);

/** The forward-compatibility rule: a code this release does not know is `InternalError`. */
export function asPassportErrorCode(code: unknown): PassportErrorCode {
  return typeof code === 'string' && Object.hasOwn(TABLE, code)
    ? (code as PassportErrorCode)
    : 'InternalError';
}

/** The code's default retry flag; `'maybe'` and unknown codes read as not retryable. */
export function isRetryable(code: unknown): boolean {
  return TABLE[asPassportErrorCode(code)].retryable === true;
}

const FROM_LACE = new Map<string, PassportErrorCode>();
for (const [code, info] of Object.entries(TABLE) as [PassportErrorCode, PassportErrorInfo][]) {
  for (const lace of info.lace) FROM_LACE.set(lace, code);
}

/** Maps a lace-platform error code to its v1 code; anything else is `InternalError`. */
export function fromLaceCode(code: unknown): PassportErrorCode {
  return (typeof code === 'string' && FROM_LACE.get(code)) || 'InternalError';
}

/** Every error is this shape; discriminate on `type` and `code`. */
export interface PassportErrorShapeV1 extends Error {
  readonly type: typeof PASSPORT_ERROR_TYPE;
  readonly code: PassportErrorCode;
  readonly retryable: boolean;
  /** The progress step that failed, so "Failed: …" can say where. */
  readonly step?: PassportStep;
}

/**
 * @deprecated since 1.0.0: the prototype's eight codes. The v1 codes are the keys of
 * {@link PASSPORT_ERRORS}. Removed in 2.0.0.
 */
export const PASSPORT_ERROR_CODES = Object.freeze([
  'UserCancelled',
  'UnsupportedAuthenticator',
  'AccountNotFound',
  'ArtefactIntegrity',
  'ProverUnavailable',
  'SponsorRejected',
  'NetworkMismatch',
  'InternalError',
] as const satisfies readonly PassportErrorCode[]);

/**
 * @deprecated since 1.0.0: the prototype's error shape, without `retryable` and `step`. Use
 * {@link PassportErrorShapeV1}, whose shape this name takes once the account's errors carry them.
 */
export interface PassportErrorShape extends Error {
  readonly type: typeof PASSPORT_ERROR_TYPE;
  readonly code: PassportErrorCode;
}
