/** Match the WebAuthn login boundary; a credential ID is not a 32-byte digest. */
export const validNightCredentialBytes = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array && value.length >= 1 && value.length <= 1023;

export const validNightCredentialHex = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length >= 2 &&
  value.length <= 2046 &&
  value.length % 2 === 0 &&
  /^[a-f0-9]+$/.test(value);
