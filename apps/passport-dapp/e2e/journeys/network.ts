import type { Route } from 'playwright-core';
import type { JourneyHarness } from './types.js';
import { fundingRoute } from './funding-network.js';
import { origin, target, grantId, manifest } from './constants.js';

function effect(h: JourneyHarness, action: string, request: Record<string, unknown>) {
  const { state, calls } = h;
  calls.push(action);
  if (
    action === 'spend' &&
    (!state.grant?.active ||
      state.grant.spent + Number(request.amount) > Number(state.grant.scope.cap))
  )
    return false;
  if (
    ['rotate', 'enroll', 'enroll-owner', 'remove', 'issue', 'revoke', 'withdraw', 'spend'].includes(
      action,
    )
  )
    state.nonce++;
  state.txHash = state.nonce.toString(16).padStart(64, '0');
  if (action === 'enroll-owner') {
    state.ownerPublicKey = String(request.publicKey);
    state.entries.push(state.ownerPublicKey);
  }
  if (action === 'rotate') state.epoch++;
  if (action === 'enroll') state.entries.push(target);
  if (action === 'remove') state.entries = state.entries.filter((e) => e !== request.target);
  if (action === 'issue')
    state.grant = {
      id: typeof request.grantId === 'string' ? request.grantId : grantId,
      active: true,
      scope: request.scope as Record<string, unknown>,
      spent: 0,
    };
  if (action === 'revoke') {
    if (!state.grant) throw Error('Missing fixture grant');
    state.grant.active = false;
  }
  if (action === 'withdraw') {
    state.night -= Number(request.amount);
    state.wallet += Number(request.amount);
  }
  if (action === 'spend') {
    if (!state.grant) throw Error('Missing fixture grant');
    state.grant.spent += Number(request.amount);
    state.night -= Number(request.amount);
    state.wallet += Number(request.amount);
  }
  return true;
}
async function accountRoute(h: JourneyHarness, route: Route) {
  const data = route.request().postDataJSON() as Record<string, unknown>,
    action = String(data.action);
  const { flags, state, calls } = h;
  if (action === 'state' && flags.receiptReadUnavailable)
    await route.fulfill({ status: 503, json: { code: 'IndexerUnavailable' } });
  else if (action === 'spend' && flags.holdSessionSpend) {
    effect(h, action, data);
    await flags.holdSessionSpend();
    await route.fulfill({ json: state });
  } else if (
    (action === 'spend' && flags.unknownSession) ||
    (action === 'revoke' && flags.unknownRevocation)
  ) {
    effect(h, action, data);
    await route.fulfill({ status: 503, json: { code: 'SubmissionUnknown' } });
  } else if (action === 'withdraw' && flags.unknownWithdrawal) {
    calls.push('withdraw-unknown');
    await route.fulfill({ status: 503, json: { code: 'SubmissionUnknown' } });
  } else {
    const accepted = effect(h, action, data);
    if (action === flags.heldOwnerAction && flags.holdOwnerReceipt) await flags.holdOwnerReceipt();
    await route.fulfill({
      status: accepted ? 200 : 409,
      json: accepted
        ? action === 'state' && flags.staleOwnerReads
          ? { ...state, nonce: state.nonce + (flags.staleReadCount++ % 2) }
          : {
              ...state,
              ...(action === 'spend' && flags.unsettledGrantSpend && { grantUnsettled: true }),
            }
        : { code: 'GrantRevoked' },
    });
  }
}
async function serviceRoute(h: JourneyHarness, route: Route, url: URL) {
  if (url.pathname === '/v1/demo/funding') return fundingRoute(h, route, url);
  if (url.pathname === '/v1/demo/value-call') {
    const body = route.request().postDataJSON() as {
      circuit: string;
      args: [unknown, { $bigint: string }];
    };
    if (body.circuit !== 'withdraw_unshielded_with_grant_jubjub')
      throw Error('Unexpected value circuit');
    const accepted = effect(h, 'spend', { amount: body.args[1].$bigint });
    if (h.flags.holdSessionSpend) await h.flags.holdSessionSpend();
    await route.fulfill({
      status: !accepted || h.flags.unknownSession ? 503 : 200,
      json:
        !accepted || h.flags.unknownSession
          ? { error: 'Synthetic session outcome unknown' }
          : { txHash: h.state.txHash },
    });
    return;
  }
  if (url.pathname === '/v1/config' || url.pathname === '/config') {
    await route.fulfill({
      json: {
        networkId: 'undeployed',
        bindingId: 'acc-s3r1.1',
        manifestSha256: manifest,
        serviceApiVersion: '1.0.0',
        artefactUrl: 'http://localhost:8787/v1/zk/acc-s3r1.1',
        indexerUri: 'http://localhost:18088',
        indexerWsUri: 'ws://localhost:18088',
        nodeUri: 'ws://localhost:19944',
        proofServerUri: 'http://localhost:16300',
        zkBaseUrl: 'http://localhost:8787/v1/zk/acc-s3r1.1',
        coinPublicKey: '80'.repeat(32),
        encryptionPublicKey: '90'.repeat(32),
      },
    });
    return;
  }
  h.failures.push(`unhandled-service:${url.pathname}`);
  await route.abort();
}
/** Every source request goes only to this harness's Vite server. */
export async function interceptJourney(h: JourneyHarness, route: Route, base: string) {
  const request = route.request(),
    url = new URL(request.url());
  if (url.origin === origin && url.pathname === '/__demo-fixture') return accountRoute(h, route);
  if (url.origin === 'http://localhost:8787') return serviceRoute(h, route, url);
  if (url.origin === origin) {
    const response = await route.fetch({
      url: `${base}${url.pathname}${url.search}`,
      maxRetries: request.method() === 'GET' ? 2 : 0,
    });
    await route.fulfill({ response });
    return;
  }
  if (!['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname))
    h.failures.push(`unhandled-network:${url.hostname}`);
  await route.abort();
}
