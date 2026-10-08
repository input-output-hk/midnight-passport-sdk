import {
  PASSPORT_ERROR_TYPE,
  asPassportErrorCode,
  fromLaceCode,
  isRetryable,
  type PassportErrorCode,
  type PassportErrorShapeV1,
  type PassportStep,
} from '@midnight-ntwrk/mn-passport-protocol';

export interface PassportErrorOptions {
  readonly cause?: unknown;
  /** Overrides the code's default, for a throw site that knows better (a `'maybe'` code, say). */
  readonly retryable?: boolean;
  /** The progress step that failed. */
  readonly step?: PassportStep;
}

export class PassportConnectorError extends Error implements PassportErrorShapeV1 {
  override readonly name = 'PassportConnectorError';
  readonly type = PASSPORT_ERROR_TYPE;
  readonly retryable: boolean;
  readonly step?: PassportStep;
  constructor(
    readonly code: PassportErrorCode,
    message: string,
    options: PassportErrorOptions = {},
  ) {
    super(message, 'cause' in options ? { cause: options.cause } : undefined);
    this.retryable = options.retryable ?? isRetryable(code);
    if (options.step !== undefined) this.step = options.step;
  }
}

export function isPassportError(e: unknown): e is PassportConnectorError {
  return (
    e instanceof Error &&
    (e as { type?: unknown }).type === PASSPORT_ERROR_TYPE &&
    typeof (e as { code?: unknown }).code === 'string'
  );
}

/** `e`, naming `step` unless it names one; one from another copy or release is re-made here. */
function atStep(e: PassportConnectorError, step: PassportStep | undefined): PassportConnectorError {
  if (e instanceof PassportConnectorError && (e.step !== undefined || step === undefined)) return e;
  const { retryable } = e as { retryable?: unknown };
  const at = e.step ?? step;
  return new PassportConnectorError(asPassportErrorCode(e.code), e.message, {
    cause: e.cause,
    ...(typeof retryable === 'boolean' && { retryable }),
    ...(at !== undefined && { step: at }),
  });
}

/**
 * Maps any thrown value to the error codes (design §3.3). A lace-platform error is recognised by its
 * `code` property (`PasskeyCredentialMismatchError` by its name) through `fromLaceCode`; anything
 * else is `InternalError`. `step` names where it failed, unless the error already does.
 */
export function toPassportError(e: unknown, step?: PassportStep): PassportConnectorError {
  if (isPassportError(e)) return atStep(e, step);
  const { name, message, code } = (typeof e === 'object' && e !== null ? e : {}) as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
  };
  const text = typeof message === 'string' ? message : String(e);
  const at = { cause: e, ...(step !== undefined && { step }) };
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return new PassportConnectorError('UserCancelled', 'The passkey prompt was cancelled.', at);
  }
  if (name === 'ZkArtifactIntegrityError') {
    return new PassportConnectorError('ArtefactIntegrity', text, at);
  }
  const lace = fromLaceCode(code);
  return new PassportConnectorError(lace === 'InternalError' ? fromLaceCode(name) : lace, text, at);
}
