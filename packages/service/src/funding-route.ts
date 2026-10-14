import type { IncomingMessage } from 'node:http';
import type { ServiceWire } from '@input-output-hk/mn-passport-protocol';
import { HttpError, json, readJson, type Route } from './http.js';

const ADDRESS = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DECIMAL = /^[1-9][0-9]*$/;
const MAX_AMOUNT = (1n << 128n) - 1n;

export interface FundingAssetPolicy {
  readonly color: string;
  readonly maxPerRequest: bigint;
  readonly maxPerUtcDay: bigint;
}

export type FundingReservation =
  | { readonly state: 'reserved' }
  | { readonly state: 'complete'; readonly result: ServiceWire.FundAccResponse }
  | { readonly state: 'pending' | 'conflict' | 'daily-limit' };

/** Reserve the request ID and daily spend atomically, durably, before any wallet call. */
export interface FundingStore {
  reserve(
    request: ServiceWire.FundAccRequest,
    policy: FundingAssetPolicy,
    utcDay: string,
  ): Promise<FundingReservation>;
  /** A failed completion must leave the reservation pending for operator reconciliation. */
  complete(requestId: string, result: ServiceWire.FundAccResponse): Promise<void>;
}

/** Must submit through a dedicated wallet, wait for inclusion, and read the credited ACC balance. */
export interface FundingBackend {
  fund(request: ServiceWire.FundAccRequest): Promise<ServiceWire.FundAccResponse>;
}

export interface FundingRouteOptions {
  readonly networkId: string;
  readonly bindingId: string;
  readonly manifestSha256: string;
  readonly assets: readonly FundingAssetPolicy[];
  readonly authorize: (request: IncomingMessage) => Promise<boolean>;
  /** Check the deployed ACC and binding against the chain, not an untrusted directory hint. */
  readonly eligible: (accountAddress: string) => Promise<boolean>;
  readonly store: FundingStore;
  readonly backend: FundingBackend;
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
}

function requestOf(value: unknown): ServiceWire.FundAccRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new HttpError(400, 'funding request must be an object');
  const body = value as Record<string, unknown>;
  if (
    typeof body.requestId !== 'string' ||
    !UUID.test(body.requestId) ||
    typeof body.networkId !== 'string' ||
    typeof body.bindingId !== 'string' ||
    typeof body.manifestSha256 !== 'string' ||
    !ADDRESS.test(body.manifestSha256) ||
    typeof body.accountAddress !== 'string' ||
    !ADDRESS.test(body.accountAddress) ||
    typeof body.color !== 'string' ||
    !ADDRESS.test(body.color) ||
    typeof body.amount !== 'string' ||
    !DECIMAL.test(body.amount) ||
    BigInt(body.amount) > MAX_AMOUNT
  )
    throw new HttpError(400, 'invalid funding request');
  return {
    requestId: body.requestId,
    networkId: body.networkId,
    bindingId: body.bindingId,
    manifestSha256: body.manifestSha256,
    accountAddress: body.accountAddress,
    color: body.color,
    amount: body.amount,
  };
}

/** The funding route never calls the fee-only sponsor path or trusts a directory address. */
export function fundingRoute(options: FundingRouteOptions): Route {
  if (!ADDRESS.test(options.manifestSha256)) throw new Error('funding manifest pin is invalid');
  for (const asset of options.assets) {
    if (
      !ADDRESS.test(asset.color) ||
      asset.maxPerRequest < 1n ||
      asset.maxPerUtcDay < asset.maxPerRequest
    )
      throw new Error('funding asset policy is invalid');
  }
  const assets = new Map(options.assets.map((asset) => [asset.color, asset]));
  if (assets.size !== options.assets.length) throw new Error('duplicate funding asset policy');
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string) => console.error(message));
  return async (req, res, url) => {
    if (req.method !== 'POST' || url.pathname !== '/v1/faucet/fund') return false;
    let authorized = false;
    try {
      authorized = await options.authorize(req);
    } catch {
      throw new HttpError(403, 'funding caller refused');
    }
    if (!authorized) throw new HttpError(403, 'funding caller refused');
    const request = requestOf(await readJson(req, 4096));
    if (
      request.networkId !== options.networkId ||
      request.bindingId !== options.bindingId ||
      request.manifestSha256 !== options.manifestSha256
    )
      throw new HttpError(409, 'funding network or binding differs from the service pin');
    const policy = assets.get(request.color);
    if (!policy) throw new HttpError(400, 'funding asset is unsupported');
    if (BigInt(request.amount) > policy.maxPerRequest)
      throw new HttpError(400, 'funding amount exceeds the request limit');
    let eligible = false;
    try {
      eligible = await options.eligible(request.accountAddress);
    } catch {
      throw new HttpError(503, 'funding account check unavailable');
    }
    if (!eligible) throw new HttpError(403, 'funding account is not eligible');
    let reservation: FundingReservation;
    try {
      reservation = await options.store.reserve(request, policy, now().toISOString().slice(0, 10));
    } catch {
      throw new HttpError(503, 'funding reservation unavailable');
    }
    if (reservation.state === 'complete') {
      json(res, 200, reservation.result);
      return true;
    }
    if (reservation.state === 'pending') throw new HttpError(409, 'funding request is pending');
    if (reservation.state === 'conflict') throw new HttpError(409, 'funding request ID was reused');
    if (reservation.state === 'daily-limit')
      throw new HttpError(429, 'daily funding limit reached');
    try {
      const result = await options.backend.fund(request);
      if (
        result.requestId !== request.requestId ||
        !result.txId ||
        !DECIMAL.test(result.creditedBalance) ||
        BigInt(result.creditedBalance) > MAX_AMOUNT
      )
        throw new Error('funding backend returned an invalid confirmation');
      await options.store.complete(request.requestId, result);
      json(res, 200, result);
    } catch {
      log(`funding request ${request.requestId} needs reconciliation`);
      throw new HttpError(502, 'funding outcome requires reconciliation');
    }
    return true;
  };
}
