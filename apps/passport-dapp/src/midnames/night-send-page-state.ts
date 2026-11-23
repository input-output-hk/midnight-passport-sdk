import type { BrowserNightSendRecord } from './night-send-journal.js';
import type { NightSendRequest } from './night-send.js';

const NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\.)+night$/;

export const localNightNetwork = (networkId: string): networkId is 'undeployed' =>
  networkId === 'undeployed';

/** The opt-in page only speaks to the owned local demo stack. */
export function localNightEndpoint(value: string | undefined, scheme: 'http' | 'ws'): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === `${scheme}:` && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Candidate proof requests may use only an exact local service origin. */
export function localNightService(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
      url.pathname === '/' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function localNightChain(config: {
  readonly indexerUri: string;
  readonly indexerWsUri: string;
  readonly nodeUri: string;
}): boolean {
  return (
    localNightEndpoint(config.indexerUri, 'http') &&
    localNightEndpoint(config.indexerWsUri, 'ws') &&
    localNightEndpoint(config.nodeUri, 'http')
  );
}

/** A local name lookup and the ACC/finality reader must use the same primary indexer. */
export function sameLocalNightIndexer(
  config: { readonly indexerUri: string; readonly indexerWsUri: string; readonly nodeUri: string },
  namingHttp: string | undefined,
  namingWs: string | undefined,
): boolean {
  return (
    localNightChain(config) &&
    namingHttp !== undefined &&
    namingWs !== undefined &&
    localNightEndpoint(namingHttp, 'http') &&
    localNightEndpoint(namingWs, 'ws') &&
    new URL(namingHttp).href === new URL(config.indexerUri).href &&
    new URL(namingWs).href === new URL(config.indexerWsUri).href
  );
}

export function namedNightStatus(record: BrowserNightSendRecord | undefined): string {
  if (!record) return 'No named NIGHT payment is pending for this account.';
  const intent = record.intent;
  const detail = `Original ${intent.requestId}: ${intent.amount} NIGHT smallest units reviewed for ${intent.name}; original ACC ${intent.target} via ${intent.providerId}. The current name status may differ.`;
  if (!record.withdrawal)
    return `${detail} The owner attempt has no saved transaction ID. Inspect Audit and the chain before any new payment; this attempt cannot be retried automatically.`;
  if (!record.deposit)
    return `${detail} Withdrawal ${record.withdrawal.hash} is retained. Resume only its original deposit after finality; do not withdraw again.`;
  return `${detail} Withdrawal ${record.withdrawal.hash} and deposit ${record.deposit.hash} are retained. Reconcile those originals; do not start another payment.`;
}

/** A retained deposit ID needs only finality reads; no new wallet fee is paid. */
export const requiresNewNightLegFee = (record: BrowserNightSendRecord | undefined): boolean =>
  !record?.deposit;

/** Validate a fresh human request before any name lookup, wallet proof or credential call. */
export function newNamedNightRequest(input: {
  readonly requestId: string;
  readonly name: string;
  readonly amount: string;
  readonly networkId: string;
  readonly source: string;
  readonly bridge: string;
}): NightSendRequest {
  const name = input.name.trim();
  const amount = input.amount.trim();
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.requestId) ||
    input.networkId !== 'undeployed' ||
    !/^[a-f0-9]{64}$/.test(input.source) ||
    !/^[a-f0-9]{64}$/.test(input.bridge) ||
    !NAME.test(name) ||
    name.length > 256 ||
    !/^[1-9][0-9]{0,38}$/.test(amount) ||
    BigInt(amount) >= 1n << 128n
  )
    throw new Error('Enter a canonical .night name and a positive NIGHT amount in smallest units.');
  return {
    requestId: input.requestId,
    name,
    networkId: input.networkId,
    source: input.source,
    bridge: input.bridge,
    asset: 'NIGHT',
    amount,
  };
}
