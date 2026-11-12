import type { PasskeyCredential } from '@input-output-hk/mn-passport-account/ports';
import {
  browserPasskey,
  verifyBrowserP256GrantRequest,
} from '@input-output-hk/mn-passport-adapter-webauthn';
import {
  captureDemoBrowserGrantCallback,
  pendingBrowserGrantKey,
  prepareDemoBrowserGrantRequest,
} from '../../src/browser-grant-holder-journey.js';
import { openDemoBrowserGrantRelay } from '../../src/browser-grant-relay.js';

let credential: PasskeyCredential;
const consent: string[] = [];
const passkey = () =>
  browserPasskey({
    origin: location.origin,
    rpId: location.hostname,
    beforeCeremony({ purpose }) {
      consent.push(purpose);
    },
  });

export async function register() {
  credential = await passkey().create('Browser grant fixture');
  return credential;
}

export async function requestGrant(issuer: string, account: string) {
  const input = {
    issuer,
    account,
    redirectUri: location.origin + '/__grant-return',
    credential,
    slot: 7,
    color: '00'.repeat(32),
    recipient: '72'.repeat(32),
    perCallCap: '1',
    cap: '10',
    maxCoinValue: '10',
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    beforeCeremony({ purpose, attempt }: { purpose: string; attempt: number }) {
      if (attempt === 1) consent.push(purpose);
    },
    checkCurrent() {},
  };
  const url = await prepareDemoBrowserGrantRequest(input);
  const fragment = new URL(url).hash;
  const retained = JSON.parse(sessionStorage.getItem(pendingBrowserGrantKey) ?? 'null');
  if (retained?.originalFragment !== fragment) throw new Error('Holder lost the exact request.');
  try {
    await prepareDemoBrowserGrantRequest(input);
    throw new Error('Duplicate holder request was permitted.');
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'Review the Passport withdrawal request.')
      throw error;
  }
  if (consent.filter((purpose) => purpose === 'request-browser-grant').length !== 1)
    throw new Error('Holder did not approve exactly one grant request.');
  return fragment;
}

export async function exercise(fragment: string, account: string) {
  const issuer = location.origin;
  const now = Math.floor(Date.now() / 1000);
  const verified = verifyBrowserP256GrantRequest(fragment, {
    account,
    authoriserOrigin: issuer,
    networkId: 'undeployed',
    nowSeconds: now,
  });
  const relay = await openDemoBrowserGrantRelay({
    account,
    issuer,
    fragment,
    credential,
    beforeCeremony({ purpose }) {
      consent.push(purpose);
    },
    checkCurrent() {},
  });
  try {
    const intent = {
      account,
      issuer,
      networkId: 'undeployed',
      requestDigest: verified.requestDigest,
      nonce: verified.nonce,
      validUntilSeconds: verified.validUntilSeconds,
    };
    const claimed = await relay.nonces.claim(intent);
    if (!claimed.first) throw new Error('The fresh fixture was not admitted.');
    const request = {
      requestId: claimed.requestId,
      address: account,
      circuit: 'issue_grant_with_p256',
      intentSha256: '13'.repeat(32),
      validUntilSeconds: verified.validUntilSeconds,
    };
    let rejected = 0;
    for (const byte of [0xab, 0xcd]) {
      try {
        await relay.sponsor.execute(Uint8Array.of(byte), request);
      } catch {
        rejected++;
      }
    }
    const original = await relay.nonces.read(intent);
    if (original !== claimed.requestId) throw new Error('Original request changed.');
    const receipt = await relay.reconcile(original, request.intentSha256);
    return {
      rejected,
      receipt,
      auth: consent.filter((purpose) => purpose === 'authenticate-grant-relay').length,
    };
  } finally {
    relay.close();
  }
}

export async function rejectInvalidCallback() {
  const retained = sessionStorage.getItem(pendingBrowserGrantKey);
  history.replaceState(null, '', '/__grant-return#invalid');
  const verify = captureDemoBrowserGrantCallback();
  if (location.hash) throw new Error('Private callback remained in history.');
  const unexpectedRead = () => {
    throw new Error('Invalid callback reached live verification.');
  };
  try {
    await verify({
      networkId: 'undeployed',
      pure: {
        derive_grant_id_with_p256: unexpectedRead,
        derive_grant_rp_commit: unexpectedRead,
        derive_grant_object_commit: unexpectedRead,
      },
      source: {
        networkId: 'undeployed',
        bindingId: 'acc-s3r1.1',
        readP256GrantSpendContext: unexpectedRead,
      },
    });
    throw new Error('Invalid callback was accepted.');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'GrantScopeInvalid')
      throw error;
  }
  if (!retained || sessionStorage.getItem(pendingBrowserGrantKey) !== retained)
    throw new Error('Invalid callback consumed the pending request.');
}
