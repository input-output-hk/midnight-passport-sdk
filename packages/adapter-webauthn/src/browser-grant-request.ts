import type { P256UnshieldedGrantScope } from '@input-output-hk/mn-passport-account/ports';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';
import {
  chainReference,
  decodeGrantBytes,
  decodeGrantJson,
  grantFragmentParameters,
  grantProof,
  grantRequest,
  grantWireHex32,
  invalidBrowserGrant,
  maxGrantParameterLength,
  timestamp,
} from './browser-grant-wire.js';
import { assertionMaterial, webauthnPolicy } from './webauthn.js';

const encoder = new TextEncoder();
const domain = new Uint8Array(64);
domain.set(encoder.encode('midnight:account:grant:request:v1'));

export interface BrowserGrantRequestContext {
  /** Exact, configured authoriser origin. */
  readonly authoriserOrigin: string;
  /** Network pinned by the authoriser, in bare or midnight-prefixed form. */
  readonly networkId: string;
  /** Account selected by the user. A signed account, when present, must match it. */
  readonly account: string;
  readonly nowSeconds: number;
}

export interface VerifiedBrowserP256GrantRequest {
  readonly requestDigest: string;
  readonly nonce: string;
  readonly validUntilSeconds: number;
  readonly slot: number;
  readonly redirectUri: string;
  readonly state: string;
  readonly scope: P256UnshieldedGrantScope;
}

export function browserGrantRequestDigest(request: string): Uint8Array {
  if (
    typeof request !== 'string' ||
    request.length > maxGrantParameterLength ||
    !request.length ||
    /[^A-Za-z0-9_-]/.test(request)
  )
    return invalidBrowserGrant();
  return sha256(concatBytes(domain, encoder.encode(request)));
}

function secureOrigin(origin: string): URL {
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== 'https:') return invalidBrowserGrant();
  return url;
}

function checkRedirect(uri: string, origin: string): void {
  const target = new URL(uri);
  if (
    target.origin !== origin ||
    target.href !== uri ||
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    /[#\\\s\u0000-\u001f\u007f]/u.test(uri) ||
    !uri.startsWith('https://')
  )
    return invalidBrowserGrant();
}

function readP256WireKey(value: string) {
  const bytes = hexToBytes(value);
  // The draft encodes each affine coordinate in little endian.
  return p256.Point.fromBytes(
    concatBytes(Uint8Array.of(4), bytes.slice(0, 32).reverse(), bytes.slice(32).reverse()),
  );
}

/**
 * Verify the fragment and the direct grantee's exact WebAuthn assertion for the
 * pinned fixed-recipient P-256 route. The caller owns top-level navigation,
 * durable nonce admission, separate owner consent, issuance, and the return leg.
 */
export function verifyBrowserP256GrantRequest(
  fragment: string,
  context: BrowserGrantRequestContext,
): VerifiedBrowserP256GrantRequest {
  return verifyRequest(fragment, context, 'fresh');
}

/** Verify an original signature for read-only recovery. The host must require
 * an existing exact admission and may never dispatch from this result. */
export function verifyOriginalBrowserP256GrantRequest(
  fragment: string,
  context: BrowserGrantRequestContext,
): VerifiedBrowserP256GrantRequest {
  return verifyRequest(fragment, context, 'original');
}

/** Verify an expired grant only to look up an exact, previously admitted receipt.
 * Do not use the returned scope to issue a grant, approve a spend or deliver an opening.
 */
export function verifyRetainedBrowserP256GrantRequest(
  fragment: string,
  context: BrowserGrantRequestContext,
): VerifiedBrowserP256GrantRequest {
  return verifyRequest(fragment, context, 'retained');
}

function verifyRequest(
  fragment: string,
  context: BrowserGrantRequestContext,
  mode: 'fresh' | 'original' | 'retained',
): VerifiedBrowserP256GrantRequest {
  try {
    const { request, proof } = grantFragmentParameters(fragment);
    const digest = browserGrantRequestDigest(request);
    if (proof.length > maxGrantParameterLength) return invalidBrowserGrant();
    const signed = grantRequest.parse(decodeGrantJson(request));
    const assertion = grantProof.parse(decodeGrantJson(proof));
    const authoriser = secureOrigin(context.authoriserOrigin);
    const client = secureOrigin(signed.client_id);
    const account = grantWireHex32.parse(context.account);
    const now = timestamp.parse(context.nowSeconds);
    const network = chainReference.parse(context.networkId).replace(/^midnight:/, '');
    const [requested] = signed.grants;
    const bounds = requested.bounds;
    checkRedirect(signed.redirect_uri, client.origin);
    if (
      signed.aud !== authoriser.origin ||
      signed.chain.replace(/^midnight:/, '') !== network ||
      (signed.account !== undefined && signed.account !== account) ||
      signed.iat > now ||
      (mode === 'fresh' && signed.exp < now) ||
      signed.exp < signed.iat ||
      signed.exp - signed.iat > 600 ||
      decodeGrantBytes(signed.state).length < 16
    )
      return invalidBrowserGrant();
    const { expires_at, per_call_cap, cap, max_coin_value, recipient } = bounds;
    const perCall = BigInt(per_call_cap);
    if (
      expires_at <= signed.iat ||
      (mode !== 'retained' && expires_at <= now) ||
      perCall === 0n ||
      perCall > BigInt(cap) ||
      perCall > BigInt(max_coin_value) ||
      /^0+$/.test(recipient.value)
    )
      return invalidBrowserGrant();
    const point = readP256WireKey(signed.grantee.pk);
    const policy = webauthnPolicy(client.hostname, client.origin);
    assertionMaterial(
      digest,
      policy,
      { ...point.toAffine(), identity: false },
      {
        clientDataJSON: decodeGrantBytes(assertion.client_data_json),
        authenticatorData: decodeGrantBytes(assertion.authenticator_data),
        signature: decodeGrantBytes(assertion.signature),
      },
    );
    return Object.freeze({
      requestDigest: bytesToHex(digest),
      nonce: signed.nonce,
      validUntilSeconds: signed.exp,
      slot: requested.slot,
      redirectUri: signed.redirect_uri,
      state: signed.state,
      scope: Object.freeze({
        account,
        grantee: Object.freeze({
          scheme: 'p256-webauthn' as const,
          publicKey: bytesToHex(point.toBytes(true)),
          origin: client.origin,
          rpIdHash: bytesToHex(policy.rp_id_hash),
        }),
        color: bounds.color,
        recipient: recipient.value,
        maxCoinValue: max_coin_value,
        perCallCap: per_call_cap,
        cap,
        expiresAt: expires_at,
      }),
    });
  } catch {
    return invalidBrowserGrant();
  }
}
