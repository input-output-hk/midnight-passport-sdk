// PRF outputs a provider answered at passkey CREATION, held for the one consumer that needs them.
//
// Some providers (Google Password Manager) evaluate the PRF salts during `create()` already. Using
// those outputs for the account's encryption key saves the separate PRF ceremony, so create asks
// for the passkey twice (create, enrolment probe) instead of three times. The outputs are secrets,
// so they are never put on the returned `PasskeyCredential`, where a spread, a log or a registry
// write could carry them. Instead this module-private WeakMap, keyed by that credential object,
// holds a copy:
//
// - `passkeyPrf({ created })` takes it once (the entry is removed, the caller zeroes the bytes);
// - an entry nobody takes is zeroed and dropped after CREATE_PRF_TTL_MS;
// - nothing here is exported from the package index, and nothing is stored, logged or serialised.
//
// Providers that return only `prf.enabled` at creation hold nothing here, and the encryption-key
// seam falls back to its own PRF ceremony (prf.ts).
import type { PasskeyCredential } from '@midnight-ntwrk/mn-passport-account';
import type { PasskeyPrfOutputs } from './prf.js';

/** How long create-time PRF outputs wait for the encryption-key seam before they are zeroed. */
export const CREATE_PRF_TTL_MS = 60_000;

/** A copy of a PRF result, so zeroing it never touches the browser's own buffer. */
export const copyPrfOutput = (source: BufferSource): Uint8Array =>
  source instanceof ArrayBuffer
    ? new Uint8Array(source.slice(0))
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice();

interface Held {
  readonly outputs: PasskeyPrfOutputs;
  readonly timer: unknown;
}
const held = new WeakMap<PasskeyCredential, Held>();

const zero = ({ authoriser, root }: PasskeyPrfOutputs): void => {
  authoriser.fill(0);
  root.fill(0);
};

/**
 * Holds a copy of both create-time PRF outputs for `credential`, when the provider returned both.
 * Answers whether it did; without them the encryption key needs its own PRF ceremony.
 */
export function holdCreatePrf(
  credential: PasskeyCredential,
  results: AuthenticationExtensionsPRFValues | undefined,
): boolean {
  if (!results?.first || !results.second) return false;
  // Outputs this credential still holds are replaced, so they are zeroed now: their own expiry
  // would find a different entry and leave them untouched.
  const previous = held.get(credential);
  if (previous) {
    clearTimeout(previous.timer as Parameters<typeof clearTimeout>[0]);
    zero(previous.outputs);
  }
  const outputs = { authoriser: copyPrfOutput(results.first), root: copyPrfOutput(results.second) };
  const timer = setTimeout(() => {
    if (held.get(credential)?.outputs !== outputs) return;
    held.delete(credential);
    zero(outputs);
  }, CREATE_PRF_TTL_MS);
  // In Node (the tests), a pending timer must not keep the process alive.
  (timer as { unref?: () => void }).unref?.();
  held.set(credential, { outputs, timer });
  return true;
}

/** The create-time PRF outputs of `credential`, at most once. The caller zeroes them. */
export function takeCreatePrf(credential: PasskeyCredential): PasskeyPrfOutputs | undefined {
  const entry = held.get(credential);
  if (!entry) return undefined;
  held.delete(credential);
  clearTimeout(entry.timer as Parameters<typeof clearTimeout>[0]);
  return entry.outputs;
}
