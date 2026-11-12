import {
  mutationDigest,
  recoverIssuedP256Grant,
  type P256GranteeIssuePorts,
} from '@input-output-hk/mn-passport-account';
import {
  authoriseBrowserP256Grant,
  browserP256GrantCallbackUrl,
  type BrowserGrantAuthoriserResult,
} from '@input-output-hk/mn-passport-adapter-browser';
import {
  createMidnightChain,
  createMidnightGrantSource,
} from '@input-output-hk/mn-passport-adapter-midnight-js';
import {
  equalBytes,
  verifyBrowserP256GrantRequest,
  verifyRetainedBrowserP256GrantRequest,
} from '@input-output-hk/mn-passport-adapter-webauthn';
import { pureCircuits } from '#acc';
import { unsettledGrant } from './browser-grant-http.js';
import { openDemoBrowserGrantRelay, type BrowserGrantRelayOptions } from './browser-grant-relay.js';
import { createDemoBrowserGrantStores } from './browser-grant-stores.js';

interface DemoBrowserGrantJourneyOptions extends BrowserGrantRelayOptions {
  readonly chain: Omit<Parameters<typeof createMidnightChain>[0], 'grantIssueSponsor'>;
  readonly owner: P256GranteeIssuePorts['owner'];
  readonly authoriser: P256GranteeIssuePorts['authoriser'];
  readonly review: P256GranteeIssuePorts['review'];
  readonly indexedDB: IDBFactory;
  readonly openingKey: CryptoKey;
}

export type DemoBrowserGrantJourneyResult =
  | { readonly status: 'missing' }
  | { readonly status: 'unresolved'; readonly requestId: string }
  | { readonly status: 'receipt'; readonly requestId: string; readonly txHash: string }
  | {
      readonly status: 'granted';
      readonly requestId: string;
      readonly txHash?: string;
      /** Private grant opening in a fragment. Deliver only to the validated callback. */
      readonly callbackUrl: string;
    };

function view(
  result: BrowserGrantAuthoriserResult,
  check: () => void,
): DemoBrowserGrantJourneyResult {
  check();
  if (result.status === 'unresolved') return result;
  return {
    status: 'granted',
    requestId: result.requestId,
    ...(result.txHash && { txHash: result.txHash }),
    callbackUrl: browserP256GrantCallbackUrl(result),
  };
}

async function recoverOriginal(
  relay: Awaited<ReturnType<typeof openDemoBrowserGrantRelay>>,
  issue: P256GranteeIssuePorts,
  options: DemoBrowserGrantJourneyOptions,
): Promise<DemoBrowserGrantJourneyResult> {
  const { account, issuer, fragment, checkCurrent } = options;
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const networkId = issue.networkId;
  const original = verifyRetainedBrowserP256GrantRequest(fragment, {
    authoriserOrigin: issuer,
    account,
    networkId,
    nowSeconds: nowSeconds(),
  });
  const requestId = await relay.nonces.read({
    issuer,
    account,
    networkId,
    requestDigest: original.requestDigest,
    nonce: original.nonce,
    validUntilSeconds: original.validUntilSeconds,
  });
  checkCurrent();
  if (!requestId) return { status: 'missing' };
  const retained = await issue.journal.read(requestId);
  checkCurrent();
  if (!retained) return { status: 'unresolved', requestId };
  if (
    retained.requestId !== requestId ||
    retained.networkId !== networkId ||
    retained.opening.slot !== original.slot ||
    mutationDigest(retained.opening.scope) !== mutationDigest(original.scope)
  )
    throw unsettledGrant();
  const receipt = await relay.reconcile(requestId, retained.intentSha256).catch(() => undefined);
  const txHash = receipt?.txHash ?? retained.txHash;
  if (receipt) {
    if (retained.txHash && retained.txHash !== receipt.txHash) throw unsettledGrant();
    await issue.journal.recordTransaction(retained, receipt.txHash);
  }
  checkCurrent();
  if (nowSeconds() < (original.scope.expiresAt ?? 0)) {
    const live = await recoverIssuedP256Grant(requestId, issue);
    checkCurrent();
    if (live && nowSeconds() < (original.scope.expiresAt ?? 0))
      return view(
        {
          status: 'granted',
          requestId,
          opening: live.opening,
          networkId,
          issuer,
          redirectUri: original.redirectUri,
          state: original.state,
          ...(txHash && { txHash }),
        },
        checkCurrent,
      );
  }
  return txHash ? { status: 'receipt', requestId, txHash } : { status: 'unresolved', requestId };
}

function checkOwner({ owner, credential, account, chain }: DemoBrowserGrantJourneyOptions) {
  if (
    owner.address !== account ||
    owner.scheme !== 'p256-webauthn' ||
    owner.status !== 'active' ||
    owner.publicKey.x !== credential.publicKey.x ||
    owner.publicKey.y !== credential.publicKey.y ||
    !owner.credentialId ||
    !owner.policy ||
    !equalBytes(owner.credentialId, credential.credentialId) ||
    !equalBytes(owner.policy.origin, credential.policy.origin) ||
    !equalBytes(owner.policy.rp_id_hash, credential.policy.rp_id_hash) ||
    chain.network.networkId !== 'undeployed' ||
    chain.network.bindingId !== 'acc-s3r1.1'
  )
    throw unsettledGrant();
}

/** The issuer page must capture the fragment, consent, selected owner and encrypted opening key. */
export async function runDemoBrowserGrantJourney(
  action: 'issue' | 'recover',
  input: DemoBrowserGrantJourneyOptions,
): Promise<DemoBrowserGrantJourneyResult> {
  const check = input.checkCurrent;
  const signal = input.signal;
  const options = {
    ...input,
    owner: structuredClone(input.owner),
    credential: structuredClone(input.credential),
    chain: { ...input.chain, network: { ...input.chain.network } },
    checkCurrent() {
      check();
      if (signal?.aborted) throw unsettledGrant();
    },
  };
  const { account, owner, fragment, issuer, checkCurrent } = options;
  checkCurrent();
  checkOwner(options);
  if (action === 'issue')
    verifyBrowserP256GrantRequest(fragment, {
      authoriserOrigin: issuer,
      account,
      networkId: options.chain.network.networkId,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
  const relay = await openDemoBrowserGrantRelay(options);
  try {
    const stores = await createDemoBrowserGrantStores({
      account,
      networkId: options.chain.network.networkId,
      indexedDB: options.indexedDB,
      openingKey: options.openingKey,
    });
    try {
      checkCurrent();
      const { network, binding, publicDataProvider } = options.chain;
      const issue: P256GranteeIssuePorts = {
        owner,
        networkId: network.networkId,
        chain: createMidnightChain({ ...options.chain, grantIssueSponsor: relay.sponsor }),
        grants: createMidnightGrantSource({
          network,
          binding,
          openings: { readReadPublicKey: async () => undefined },
          ...(publicDataProvider && { publicDataProvider }),
        }),
        authoriser: options.authoriser,
        pure: pureCircuits,
        journal: stores.journal,
        fence: stores.fence,
        review: async (details) => {
          checkCurrent();
          const approved = await options.review(details);
          checkCurrent();
          return approved;
        },
      };
      if (action === 'recover') return await recoverOriginal(relay, issue, options);
      return view(
        await authoriseBrowserP256Grant(
          fragment,
          { issuer, issue, nonces: relay.nonces },
          signal ? { signal } : {},
        ),
        checkCurrent,
      );
    } finally {
      stores.close();
    }
  } finally {
    relay.close();
  }
}
