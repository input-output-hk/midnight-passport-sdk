import type { CredentialPort, PrfKeySource } from '@input-output-hk/mn-passport-account/ports';
import { jubjub } from '@noble/curves/misc.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { deriveSymmetricSecret, READER_SECRET_DOMAIN } from './lace-recipe.js';
import { recipeJubjubAuthoriser, type JubjubDeviceCircuits } from './jubjub-authoriser.js';
import { JUBJUB_ORDER, littleEndianScalar } from './jubjub-signing.js';

/** A distinct reader avoids registering one X25519 key against two different ACC owners. */
export const COMPANION_READER_DOMAIN = 'lace-passport:companion-reader:v1';
export interface AuthenticatedOwnerContext {
  readonly account: string;
  readonly networkId: string;
  readonly bindingId: string;
  readonly credentialId: Uint8Array;
}

/**
 * The existing Lace PRF-#1 owner recipe, held only for an explicitly authenticated lease.
 * `check` is the host's absolute expiry/revision check. Local expiry does not revoke the
 * durable ACC owner entry. Raw inputs stay caller-owned; this object clears its own copies.
 */
export function createAuthenticatedJubjubOwner(input: {
  context: AuthenticatedOwnerContext;
  authoriser: Uint8Array;
  walletSeed: Uint8Array;
  pure: JubjubDeviceCircuits;
  companionReader: boolean;
  check(): void;
}) {
  if (
    !/^[0-9a-f]{64}$/.test(input.context.account) ||
    !input.context.credentialId.length ||
    !input.context.networkId ||
    !input.context.bindingId ||
    new TextEncoder().encode(JSON.stringify([input.context.networkId, input.context.account]))
      .length > 1024 ||
    input.authoriser.length !== 32 ||
    input.walletSeed.length !== 64
  )
    throw new Error('Invalid authenticated owner material or context.');
  const context = Object.freeze({
    ...input.context,
    credentialId: input.context.credentialId.slice(),
  });
  const scalar = littleEndianScalar(input.authoriser) % JUBJUB_ORDER;
  if (!scalar) throw new Error('The JubJub owner scalar reduced to zero.');
  const pk = input.pure.compute_public_point_with_jubjub(scalar);
  const hex = (bytes: Uint8Array) =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  const publicKey = hex(jubjub.Point.fromAffine(pk).toBytes());
  const secret = new Uint8Array(32);
  for (let i = 0; i < 32; i++) secret[i] = Number((scalar >> BigInt(i * 8)) & 255n);
  const seed = input.walletSeed.slice();
  let disposed = false;
  const check = () => {
    if (disposed) throw new Error('Authenticated owner is locked.');
    input.check();
  };
  const derive = (params: Parameters<PrfKeySource['deriveSecret']>[0], companion: boolean) => {
    if (params.domain === READER_SECRET_DOMAIN) {
      if (params.context !== context.networkId) throw new Error('Owner reader network mismatch.');
      if (companion)
        return deriveSymmetricSecret(seed, {
          ...params,
          domain: COMPANION_READER_DOMAIN,
          context: JSON.stringify([context.networkId, context.account]),
        });
    }
    return deriveSymmetricSecret(seed, params);
  };
  const source = (companion: boolean): PrfKeySource => ({
    async withSession(work) {
      check();
      const result = await work();
      check();
      return result;
    },
    async deviceSecret() {
      check();
      return secret.slice();
    },
    async deriveSecret(params) {
      check();
      return derive(params, companion);
    },
  });
  const prf = source(input.companionReader);
  const readerSecret = derive(
    { domain: READER_SECRET_DOMAIN, context: context.networkId },
    input.companionReader,
  );
  let readerPublicKey: string;
  try {
    readerPublicKey = hex(x25519.getPublicKey(readerSecret));
  } catch (error) {
    secret.fill(0);
    seed.fill(0);
    throw error;
  } finally {
    readerSecret.fill(0);
  }
  const recipe = recipeJubjubAuthoriser(prf, input.pure);
  const authoriser: typeof recipe = {
    ...recipe,
    async withKeySession(work, flow) {
      check();
      const result = await work();
      // Private reads must not disclose results after lock. Mutation acknowledgements
      // survive local expiry; their transports already guard each new dispatch.
      if (!flow || flow.kind === 'read-holdings' || flow.kind === 'sign-in') check();
      return result;
    },
    async authorise(request) {
      check();
      if (request.account !== context.account)
        throw new Error('Authenticated owner account mismatch.');
      const result = await recipe.authorise(request);
      check();
      return result;
    },
    async deviceCommitments(account, epoch, counters) {
      check();
      if (account !== context.account) throw new Error('Authenticated owner account mismatch.');
      return recipe.deviceCommitments(account, epoch, counters);
    },
  };
  const credentials: CredentialPort = {
    async create() {
      throw new Error('An authenticated owner cannot create another account.');
    },
    async identify() {
      check();
      return {
        credentialId: context.credentialId.slice(),
        owns: (key) => {
          check();
          return key.x === pk.x && key.y === pk.y;
        },
      };
    },
  };
  return {
    context: Object.freeze({ ...context, credentialId: context.credentialId.slice() }),
    publicKey,
    readerPublicKey,
    prf,
    originalReaderPrf: source(false),
    authoriser,
    credentials,
    check,
    dispose() {
      disposed = true;
      secret.fill(0);
      seed.fill(0);
    },
  };
}

export type AuthenticatedJubjubOwner = ReturnType<typeof createAuthenticatedJubjubOwner>;
