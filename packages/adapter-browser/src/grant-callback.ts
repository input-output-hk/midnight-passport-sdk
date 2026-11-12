import {
  mutationDigest,
  verifyLiveP256GrantOpening,
  type P256UnshieldedGrantOpening,
} from '@input-output-hk/mn-passport-account';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import {
  browserP256CallbackScope,
  decodeBrowserP256CallbackFragment,
  encodeBrowserP256CallbackFragment,
  verifyOriginalBrowserP256GrantRequest,
} from '@input-output-hk/mn-passport-adapter-webauthn';
import type { BrowserGrantAuthoriserResult } from './grant-authoriser.js';

type Granted = Extract<BrowserGrantAuthoriserResult, { readonly status: 'granted' }>;

function invalidCallback(): never {
  throw new PassportConnectorError(
    'GrantScopeInvalid',
    'The browser grant callback does not match the pending request.',
  );
}

/** Build the grant return URL from the original authoriser result. Deliver it only
 * to the original redirect. The fragment carries a private grant opening. */
export function browserP256GrantCallbackUrl(granted: Granted): string {
  const target = new URL(granted.redirectUri);
  if (
    target.href !== granted.redirectUri ||
    target.protocol !== 'https:' ||
    target.origin !== granted.opening.scope.grantee.origin ||
    target.username ||
    target.password ||
    granted.redirectUri.includes('#')
  )
    return invalidCallback();
  return (
    granted.redirectUri +
    encodeBrowserP256CallbackFragment({
      state: granted.state,
      issuer: granted.issuer,
      networkId: granted.networkId,
      scope: granted.opening.scope,
      scopeSalt: granted.opening.scopeSalt,
      grantId: granted.opening.grantId,
    })
  );
}

export interface PendingBrowserP256Grant {
  /** The original signed fragment retained by the holder in this browser session. */
  readonly originalFragment: string;
  readonly issuer: string;
  /** The selected ACC if known when the request was initiated. */
  readonly account?: string;
}

/** Confirm a grant callback with the original holder session and current ACC state.
 * The host must supply its own same-session pending record and strip the callback
 * fragment from history before calling. Only promote the holder credential on success. */
export async function verifyBrowserP256GrantCallback(
  callbackUrl: string,
  pending: PendingBrowserP256Grant,
  ports: Parameters<typeof verifyLiveP256GrantOpening>[1],
): Promise<P256UnshieldedGrantOpening> {
  const separator = callbackUrl.indexOf('#');
  if (separator < 0) return invalidCallback();
  const callback = decodeBrowserP256CallbackFragment(callbackUrl.slice(separator));
  const { issuer, originalFragment, account } = pending;
  const { networkId, nowSeconds } = ports;
  const original = verifyOriginalBrowserP256GrantRequest(originalFragment, {
    authoriserOrigin: issuer,
    networkId,
    account: account ?? callback.account,
    nowSeconds: nowSeconds?.() ?? Math.floor(Date.now() / 1000),
  });
  if (
    callbackUrl.slice(0, separator) !== original.redirectUri ||
    callback.state !== original.state ||
    callback.iss !== issuer ||
    callback.chain !== 'midnight:' + networkId.replace(/^midnight:/, '') ||
    callback.account !== original.scope.account ||
    mutationDigest(callback.scope) !== mutationDigest(browserP256CallbackScope(original.scope))
  )
    return invalidCallback();

  return verifyLiveP256GrantOpening(
    {
      scope: original.scope,
      slot: original.slot,
      grantId: callback.grant_id,
      scopeSalt: callback.scope_salt,
    },
    ports,
  );
}
