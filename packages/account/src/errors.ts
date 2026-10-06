import { PASSPORT_ERROR_TYPE, type PassportErrorCode, type PassportErrorShape } from '@midnight-ntwrk/mn-passport-protocol';

export class PassportConnectorError extends Error implements PassportErrorShape {
  override readonly name = 'PassportConnectorError';
  readonly type = PASSPORT_ERROR_TYPE;
  constructor(readonly code: PassportErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

export function isPassportError(e: unknown): e is PassportConnectorError {
  return e instanceof PassportConnectorError;
}

/** Maps any thrown value to the connector taxonomy (spec §6). */
export function toPassportError(e: unknown): PassportConnectorError {
  if (isPassportError(e)) return e;
  const name = e instanceof Error ? e.name : '';
  const message = e instanceof Error ? e.message : String(e);
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return new PassportConnectorError('UserCancelled', 'The passkey prompt was cancelled.', { cause: e });
  }
  if (name === 'ZkArtifactIntegrityError') {
    return new PassportConnectorError('ArtefactIntegrity', message, { cause: e });
  }
  return new PassportConnectorError('InternalError', message, { cause: e });
}
