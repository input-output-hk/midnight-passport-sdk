import type { Authoriser, PrfKeySource } from '@input-output-hk/mn-passport-account/ports';
import { recipeJubjubAuthoriser, type JubjubDeviceCircuits } from './jubjub-authoriser.js';

/** A fresh public session ID prevents a copied old key from signing a renewed grant. */
export interface SessionKeyContext {
  readonly account: string;
  readonly networkId: string;
  readonly bindingId: string;
  readonly origin: string;
  readonly sessionId: string;
  /** Absolute deadline in epoch milliseconds, not the grant’s epoch seconds. */
  readonly expiresAt: number;
}

export const SESSION_KEY_DOMAIN = 'midnight-passport:session-grantee:v1';

/**
 * Derive a distinct grant-holder key, never the PRF owner key or wallet seed. This does NOT
 * grant authority: an owner must issue a separately scoped, expiring on-chain grant.
 * No key bytes are returned. Disposal clears the retained byte array; JavaScript cannot
 * guarantee erasure of engine temporaries. The host must also dispose on lock/teardown.
 */
export async function createSessionJubjubAuthoriser(
  source: PrfKeySource,
  pure: JubjubDeviceCircuits,
  context: SessionKeyContext,
  now: () => number = Date.now,
): Promise<{ readonly publicKey: string; readonly authoriser: Authoriser; dispose(): void }> {
  const bound = Object.freeze({ ...context });
  if (
    !/^[0-9a-f]{64}$/.test(bound.account) ||
    !/^[0-9a-f]{64}$/.test(bound.sessionId) ||
    !bound.networkId ||
    !bound.bindingId ||
    !bound.origin ||
    !Number.isSafeInteger(bound.expiresAt)
  )
    throw new Error('Invalid session key context.');
  const started = now();
  if (
    !Number.isFinite(started) ||
    bound.expiresAt <= started ||
    bound.expiresAt - started > 30 * 60_000
  )
    throw new Error('Session key lifetime must be positive and at most 30 minutes.');
  const encoded = JSON.stringify([
    bound.networkId,
    bound.bindingId,
    bound.account,
    bound.origin,
    bound.sessionId,
  ]);
  if (new TextEncoder().encode(encoded).length > 1024)
    throw new Error('Session context is too long.');
  let disposed = false;
  let lastTime = started;
  let secret: Uint8Array | undefined;
  const dispose = () => {
    disposed = true;
    secret?.fill(0);
    secret = undefined;
  };
  const check = () => {
    const time = now();
    if (disposed || !Number.isFinite(time) || time < lastTime || time >= bound.expiresAt) {
      dispose();
      throw new Error(
        'Session key is locked or expired; authorize a new session with your passkey.',
      );
    }
    lastTime = time;
  };
  try {
    secret = await source.withSession(() =>
      source.deriveSecret({ domain: SESSION_KEY_DOMAIN, context: encoded }),
    );
    check();
    if (secret.length !== 32) throw new Error('Session derivation must return 32 bytes.');
    const local: PrfKeySource = {
      async withSession(work) {
        check();
        const result = await work();
        check();
        return result;
      },
      async deviceSecret() {
        check();
        return secret!.slice();
      },
      async deriveSecret() {
        throw new Error('Session keys cannot derive wallet or reader secrets.');
      },
    };
    const signer = recipeJubjubAuthoriser(local, pure);
    const publicKey = await signer.devicePublicKeyHex();
    const authoriser: Authoriser = {
      scheme: 'jubjub-schnorr',
      devicePublicKey: signer.devicePublicKey,
      devicePublicKeyHex: signer.devicePublicKeyHex,
      withKeySession: signer.withKeySession,
      async authorise(request) {
        check();
        if (
          request.account !== bound.account ||
          request.circuit !== 'withdraw_unshielded_with_grant_jubjub'
        )
          throw new Error('Session key cannot authorize this account or owner operation.');
        const result = await signer.authorise(request);
        check();
        return result;
      },
    };
    return { publicKey, authoriser, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
