import {
  issueP256GranteeGrant,
  mutationDigest,
  P256GranteeIssueUnsettled,
  recoverIssuedP256Grant,
  type BrowserGrantNonceIntent,
  type BrowserGrantNonceStore,
  type P256GranteeIssuePorts,
  type P256UnshieldedGrantOpening,
} from '@input-output-hk/mn-passport-account';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import { verifyOriginalBrowserP256GrantRequest } from '@input-output-hk/mn-passport-adapter-webauthn';
import type { FlowOptions } from '@input-output-hk/mn-passport-protocol';

export interface BrowserGrantAuthoriserPorts {
  readonly issuer: string;
  readonly issue: P256GranteeIssuePorts;
  readonly nonces: BrowserGrantNonceStore;
}

export type BrowserGrantAuthoriserResult =
  | { readonly status: 'unresolved'; readonly requestId: string }
  | {
      readonly status: 'granted';
      readonly requestId: string;
      readonly opening: P256UnshieldedGrantOpening;
      readonly networkId: string;
      readonly txHash?: string;
      /** Exact validated return URI and holder state. Do not add them to audit events. */
      readonly redirectUri: string;
      readonly state: string;
      readonly issuer: string;
    };

/**
 * Accept an original top-level fragment after host sign-in. The host owns the
 * signed-in owner session, fragment removal, consent UI and response delivery.
 * The nonce store elects one issuer. Other attempts can only inspect the
 * original opening against live account state.
 */
export async function authoriseBrowserP256Grant(
  fragment: string,
  ports: BrowserGrantAuthoriserPorts,
  options: FlowOptions = {},
): Promise<BrowserGrantAuthoriserResult> {
  const { issuer, nonces } = ports;
  const issue = { ...ports.issue, owner: { ...ports.issue.owner } };
  const { networkId, owner } = issue;
  if (owner.status !== 'active')
    throw new PassportConnectorError('NotAuthorised', 'An active owner is required.');
  const now = issue.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const verified = verifyOriginalBrowserP256GrantRequest(fragment, {
    authoriserOrigin: issuer,
    networkId,
    account: owner.address,
    nowSeconds: now(),
  });
  if (options.signal?.aborted)
    throw new PassportConnectorError('Aborted', 'Grant connection cancelled.');
  const intent: BrowserGrantNonceIntent = {
    issuer,
    networkId: networkId.replace(/^midnight:/, ''),
    account: verified.scope.account,
    requestDigest: verified.requestDigest,
    nonce: verified.nonce,
    validUntilSeconds: verified.validUntilSeconds,
  };
  const { requestId, first } =
    now() <= verified.validUntilSeconds
      ? await nonces.claim(intent)
      : { requestId: await nonces.read(intent), first: false };
  if (!requestId)
    throw new PassportConnectorError('GrantScopeInvalid', 'The signed grant request expired.');
  if (options.signal?.aborted)
    throw new PassportConnectorError('Aborted', 'Grant connection cancelled.');
  const result = first
    ? await issueP256GranteeGrant(
        {
          requestId,
          scope: verified.scope,
          requestedSlot: verified.slot,
          requestValidUntilSeconds: verified.validUntilSeconds,
        },
        issue,
        options,
      ).catch((error: unknown) => {
        if (error instanceof P256GranteeIssueUnsettled && error.requestId === requestId)
          return undefined;
        throw error;
      })
    : await recoverIssuedP256Grant(requestId, issue);
  const grantExpiry = verified.scope.expiresAt;
  if (!result || (grantExpiry !== null && now() >= grantExpiry))
    return { status: 'unresolved', requestId };
  const { opening, txHash } = result;
  if (
    opening.slot !== verified.slot ||
    mutationDigest(opening.scope) !== mutationDigest(verified.scope)
  )
    throw new PassportConnectorError(
      'MutationUnsettled',
      'The original grant opening does not match.',
    );
  if (options.signal?.aborted)
    throw new PassportConnectorError('Aborted', 'Grant connection cancelled.');
  return {
    status: 'granted',
    requestId,
    opening,
    networkId,
    ...(txHash && { txHash }),
    redirectUri: verified.redirectUri,
    state: verified.state,
    issuer,
  };
}
