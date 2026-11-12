import { toHex } from '@input-output-hk/mn-passport-account';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { PasskeyCredential } from '@input-output-hk/mn-passport-account/ports';
import { verifyBrowserP256GrantCallback } from '@input-output-hk/mn-passport-adapter-browser';
import {
  base64url,
  browserGrantRequestDigest,
  browserPasskey,
  verifyBrowserP256GrantRequest,
} from '@input-output-hk/mn-passport-adapter-webauthn';

export const pendingBrowserGrantKey = 'passport.demo.browser-grant.pending.v1';
const hex32 = /^[0-9a-f]{64}$/u;
const opening = new WeakSet<Storage>();

interface HolderGrantRequest {
  readonly issuer: string;
  readonly redirectUri: string;
  readonly account: string;
  readonly credential: PasskeyCredential;
  readonly slot: number;
  readonly color: string;
  readonly recipient: string;
  readonly perCallCap: string;
  readonly cap: string;
  readonly maxCoinValue: string;
  readonly expiresAt: number;
  readonly beforeCeremony: NonNullable<Parameters<typeof browserPasskey>[0]['beforeCeremony']>;
  readonly checkCurrent: () => void;
}

function invalid(): never {
  throw new PassportConnectorError('GrantScopeInvalid', 'Review the Passport withdrawal request.');
}

function holderPage(): Location {
  if (window.top !== window || location.protocol !== 'https:') return invalid();
  return location;
}

function isUint128(value: string): boolean {
  return (
    /^(0|[1-9][0-9]{0,38})$/u.test(value) && !/[^0-9]/u.test(value) && BigInt(value) < 1n << 128n
  );
}

function encode(value: object): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

function littleEndian(coordinate: bigint): string {
  if (coordinate < 0n || coordinate >= 1n << 256n) return invalid();
  const hex = coordinate.toString(16).padStart(64, '0');
  return Array.from({ length: 32 }, (_, index) => hex.slice(62 - 2 * index, 64 - 2 * index)).join(
    '',
  );
}

function holderRequest(input: HolderGrantRequest, origin: string, now: number): string {
  const issuer = URL.parse(input.issuer);
  const redirect = URL.parse(input.redirectUri);
  const { account, color, recipient, perCallCap, cap, maxCoinValue, expiresAt, slot } = input;
  if (
    issuer?.protocol !== 'https:' ||
    issuer.origin !== input.issuer ||
    issuer.origin === origin ||
    redirect?.origin !== origin ||
    redirect.href !== input.redirectUri ||
    redirect.username ||
    redirect.password ||
    input.redirectUri.length > 2048 ||
    /[#\\\s\u0000-\u001f\u007f]/u.test(input.redirectUri) ||
    ![account, color, recipient].every((value) => hex32.test(value) && value.length === 64) ||
    /^0+$/u.test(recipient) ||
    ![perCallCap, cap, maxCoinValue].every(isUint128) ||
    BigInt(perCallCap) <= 0n ||
    BigInt(perCallCap) > BigInt(cap) ||
    BigInt(perCallCap) > BigInt(maxCoinValue) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    !Number.isInteger(slot) ||
    slot < 0 ||
    slot > 255
  )
    return invalid();

  const { x, y } = input.credential.publicKey;
  return encode({
    v: 1,
    chain: 'undeployed',
    aud: issuer.origin,
    iat: now,
    exp: Math.min(now + 180, expiresAt),
    client_id: origin,
    redirect_uri: redirect.href,
    account,
    grantee: { scheme: 'ecdsa_secp256r1_webauthn', pk: littleEndian(x) + littleEndian(y) },
    grants: [
      {
        slot,
        scope: ['midnight:account:withdraw_unshielded'],
        bounds: {
          color,
          per_call_cap: perCallCap,
          cap,
          max_coin_value: maxCoinValue,
          expires_at: expiresAt,
          recipient: { kind: 'user', value: recipient },
        },
      },
    ],
    state: base64url(crypto.getRandomValues(new Uint8Array(16))),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  });
}

/** Retain the exact signed request in this holder tab before navigating to the issuer. */
export async function prepareDemoBrowserGrantRequest(input: HolderGrantRequest): Promise<string> {
  const { origin, hostname } = holderPage();
  const storage = window.sessionStorage;
  if (opening.has(storage) || storage.getItem(pendingBrowserGrantKey) !== null) return invalid();
  opening.add(storage);
  try {
    const selection = { ...input, credential: structuredClone(input.credential) };
    const now = () => Math.floor(Date.now() / 1000);
    const request = holderRequest(selection, origin, now());
    const passkey = browserPasskey({
      origin,
      rpId: hostname,
      async beforeCeremony(event) {
        selection.checkCurrent();
        await selection.beforeCeremony(event);
        selection.checkCurrent();
      },
    });
    selection.checkCurrent();
    const proof = await passkey.assertGrantRequest(
      selection.credential,
      browserGrantRequestDigest(request),
    );
    const originalFragment =
      '#request=' +
      request +
      '&proof=' +
      encode({
        type: 'webauthn',
        client_data_json: base64url(proof.clientDataJSON),
        authenticator_data: base64url(proof.authenticatorData),
        signature: base64url(proof.signature),
      });
    const { issuer, account } = selection;
    verifyBrowserP256GrantRequest(originalFragment, {
      account,
      authoriserOrigin: issuer,
      networkId: 'undeployed',
      nowSeconds: now(),
    });
    selection.checkCurrent();
    if (storage.getItem(pendingBrowserGrantKey) !== null) return invalid();
    storage.setItem(pendingBrowserGrantKey, JSON.stringify({ issuer, account, originalFragment }));
    return issuer + '/' + originalFragment;
  } finally {
    opening.delete(storage);
  }
}

/** Scrub the callback URL and keep its private fragment in memory for live verification. */
export function captureDemoBrowserGrantCallback() {
  const { href, hash, pathname, search } = holderPage();
  if (!hash) return invalid();
  history.replaceState(history.state, '', pathname + search);
  const storage = window.sessionStorage;
  const retained = storage.getItem(pendingBrowserGrantKey);
  if (!retained || retained.length > 17000) return invalid();
  let pending: Parameters<typeof verifyBrowserP256GrantCallback>[1];
  try {
    pending = JSON.parse(retained);
    if (
      typeof pending?.issuer !== 'string' ||
      typeof pending.originalFragment !== 'string' ||
      typeof pending.account !== 'string' ||
      pending.account.length !== 64 ||
      !hex32.test(pending.account)
    )
      return invalid();
  } catch {
    return invalid();
  }
  return async (ports: Parameters<typeof verifyBrowserP256GrantCallback>[2]) => {
    if (ports.networkId !== 'undeployed' || storage.getItem(pendingBrowserGrantKey) !== retained)
      return invalid();
    const verified = await verifyBrowserP256GrantCallback(href, pending, ports);
    if (storage.getItem(pendingBrowserGrantKey) !== retained) return invalid();
    storage.removeItem(pendingBrowserGrantKey);
    return verified;
  };
}
