import type {
  BrowserGrantNonceIntent,
  BrowserGrantNonceStore,
} from '@input-output-hk/mn-passport-account';
import type {
  GrantIssueSponsorPort,
  PasskeyCredential,
} from '@input-output-hk/mn-passport-account/ports';
import { toHex } from '@input-output-hk/mn-passport-account';
import {
  browserPasskey,
  fromBase64url,
  verifyRetainedBrowserP256GrantRequest,
  type BeforePasskeyCeremony,
} from '@input-output-hk/mn-passport-adapter-webauthn';
import {
  MAX_HOST_GRANT_ISSUE_BYTES,
  type AbortSignalLike,
  type PassportTxResult,
} from '@input-output-hk/mn-passport-protocol';
import { browserGrantHttp, unsettledGrant } from './browser-grant-http.js';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const hex32 = /^[0-9a-f]{64}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function exactToken(value: unknown): string {
  if (typeof value !== 'string' || !tokenPattern.test(value)) throw unsettledGrant();
  return value;
}

function expiry(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw unsettledGrant();
  return value;
}

function originalId(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw unsettledGrant();
  return value;
}

function receipt(body: Record<string, unknown>): PassportTxResult | undefined {
  if (Object.keys(body).length === 0) return undefined;
  const { txHash, blockHeight } = body;
  if (typeof txHash !== 'string' || !hex32.test(txHash)) throw unsettledGrant();
  return { txHash, ...(blockHeight !== undefined && { blockHeight: expiry(blockHeight) }) };
}

export interface BrowserGrantRelayOptions {
  readonly issuer: string;
  readonly account: string;
  readonly fragment: string;
  readonly credential: PasskeyCredential;
  readonly beforeCeremony: BeforePasskeyCeremony;
  /** Throws when the captured account, credential or page context is no longer current. */
  readonly checkCurrent: () => void;
  readonly credentials?: CredentialsContainer;
  readonly fetch?: typeof fetch;
  readonly signal?: AbortSignalLike;
}

function copyCredential(credential: PasskeyCredential): PasskeyCredential {
  return {
    credentialId: Uint8Array.from(credential.credentialId),
    publicKey: { ...credential.publicKey },
    policy: {
      origin: Uint8Array.from(credential.policy.origin),
      rp_id_hash: Uint8Array.from(credential.policy.rp_id_hash),
    },
  };
}

export async function openDemoBrowserGrantRelay(options: BrowserGrantRelayOptions) {
  const { issuer, account, fragment, checkCurrent, signal, beforeCeremony } = options;
  const url = new URL(issuer);
  if (
    url.protocol !== 'https:' ||
    url.origin !== issuer ||
    issuer !== globalThis.location?.origin ||
    !hex32.test(account)
  )
    throw unsettledGrant();
  const now = () => Math.floor(Date.now() / 1000);
  const signed = verifyRetainedBrowserP256GrantRequest(fragment, {
    authoriserOrigin: issuer,
    account,
    networkId: 'undeployed',
    nowSeconds: now(),
  });
  const request = browserGrantHttp(
    issuer,
    options.fetch ?? ((input, init) => globalThis.fetch(input, init)),
  );
  const credential = copyCredential(options.credential);
  const identity = { account, credentialId: toHex(credential.credentialId) };
  const check = () => {
    checkCurrent();
    if (signal?.aborted || issuer !== globalThis.location?.origin) throw unsettledGrant();
  };
  const passkey = browserPasskey({
    rpId: url.hostname,
    origin: issuer,
    ...(options.credentials && { credentials: options.credentials }),
    beforeCeremony: async (event) => {
      check();
      await beforeCeremony(event);
      check();
    },
  });
  check();
  const challengeReply = await request('session/challenge', identity, undefined, signal);
  check();
  const challenge = exactToken(challengeReply.challenge);
  const ticket = exactToken(challengeReply.ticket);
  const challengeExpiresAt = expiry(challengeReply.expiresAt);
  if (challengeExpiresAt <= now()) throw unsettledGrant();
  const assertion = await passkey.assertGrantRelay(credential, fromBase64url(challenge));
  check();
  if (challengeExpiresAt <= now()) throw unsettledGrant();
  const session = await request(
    'session/verify',
    {
      ...identity,
      challenge,
      challengeExpiresAt,
      challengeTicket: ticket,
      authenticatorData: toHex(assertion.authenticatorData),
      clientDataJSON: toHex(assertion.clientDataJSON),
      signature: toHex(assertion.signature),
    },
    undefined,
    signal,
  );
  check();
  return authenticatedRelay(
    {
      check,
      request,
      input: { account, fragment },
      signed,
      issuer,
      expiresAt: expiry(session.expiresAt),
      now,
      ...(signal && { signal }),
    },
    exactToken(session.session),
  );
}

interface RelaySession {
  readonly check: () => void;
  readonly request: ReturnType<typeof browserGrantHttp>;
  readonly input: { readonly account: string; readonly fragment: string };
  readonly signed: ReturnType<typeof verifyRetainedBrowserP256GrantRequest>;
  readonly issuer: string;
  readonly expiresAt: number;
  readonly now: () => number;
  readonly signal?: AbortSignalLike;
}

function authenticatedRelay(session: RelaySession, bearer: string) {
  let retained: string | undefined;
  let mayExecute = false;
  let attemptedClaim = false;
  const { signed, input } = session;
  const check = () => {
    session.check();
    if (!bearer || session.now() >= session.expiresAt) throw unsettledGrant();
  };
  const exact = (intent: BrowserGrantNonceIntent) => {
    check();
    if (
      intent.account !== input.account ||
      intent.networkId !== 'undeployed' ||
      intent.issuer !== session.issuer ||
      intent.requestDigest !== signed.requestDigest ||
      intent.nonce !== signed.nonce ||
      intent.validUntilSeconds !== signed.validUntilSeconds
    )
      throw unsettledGrant();
  };
  const keep = (value: unknown) => {
    const next = originalId(value);
    if (retained && retained !== next) throw unsettledGrant();
    retained = next;
    return next;
  };
  const nonces: BrowserGrantNonceStore = {
    async read(intent) {
      exact(intent);
      const body = await session.request('read', input, bearer, session.signal);
      check();
      if (body.requestId === undefined) {
        if (retained) throw unsettledGrant();
        return undefined;
      }
      return keep(body.requestId);
    },
    async claim(intent) {
      exact(intent);
      if (attemptedClaim || retained) {
        const requestId = await nonces.read(intent);
        if (!requestId) throw unsettledGrant();
        return { requestId, first: false };
      }
      attemptedClaim = true;
      const body = await session.request('claim', input, bearer, session.signal);
      check();
      if (typeof body.first !== 'boolean') throw unsettledGrant();
      const requestId = keep(body.requestId);
      mayExecute = body.first;
      return { requestId, first: body.first };
    },
  };
  const sponsor: GrantIssueSponsorPort = {
    async execute(proved, request, signal) {
      check();
      if (
        !mayExecute ||
        request.requestId !== retained ||
        request.address !== input.account ||
        request.circuit !== 'issue_grant_with_p256' ||
        request.validUntilSeconds !== signed.validUntilSeconds ||
        session.now() > signed.validUntilSeconds ||
        session.now() >= (signed.scope.expiresAt ?? 0) ||
        !hex32.test(request.intentSha256) ||
        !(proved instanceof Uint8Array) ||
        !proved.length ||
        proved.length > MAX_HOST_GRANT_ISSUE_BYTES
      )
        throw unsettledGrant();
      mayExecute = false;
      const result = receipt(
        await session.request(
          'execute',
          {
            ...input,
            requestId: request.requestId,
            intentSha256: request.intentSha256,
            proved: toHex(proved),
          },
          bearer,
          signal,
          session.signal,
        ),
      );
      if (!result) throw unsettledGrant();
      return result;
    },
  };
  return {
    nonces,
    sponsor,
    async reconcile(requestId: string, intentSha256: string) {
      check();
      if (requestId !== retained || !hex32.test(intentSha256)) throw unsettledGrant();
      mayExecute = false;
      return receipt(
        await session.request(
          'reconcile',
          {
            ...input,
            requestId,
            intentSha256,
          },
          bearer,
          session.signal,
        ),
      );
    },
    close() {
      bearer = '';
      mayExecute = false;
    },
  };
}
