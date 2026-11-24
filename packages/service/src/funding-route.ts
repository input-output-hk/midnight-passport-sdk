import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ServiceWire } from '@input-output-hk/mn-passport-protocol';
import type { FundingCreditEvidence } from './funding-reconciliation.js';
import { HttpError, json, readJson, type Route } from './http.js';
import { FundingPreflightError } from './funding-inventory.js';

const ADDRESS = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DECIMAL = /^[1-9][0-9]*$/;
const MAX_AMOUNT = (1n << 128n) - 1n;
const PREFLIGHT_STATUS = { FundingAssetUnavailable: 409, FundingWalletUnavailable: 503 } as const;

function checkedPreflight(error: unknown, noSubmit: boolean): FundingPreflightError | undefined {
  return noSubmit &&
    error instanceof FundingPreflightError &&
    ['FundingAssetUnavailable', 'FundingWalletUnavailable'].includes(error.code)
    ? new FundingPreflightError(error.code)
    : undefined;
}

export interface FundingAssetPolicy {
  readonly color: string;
  readonly maxPerRequest: bigint;
  readonly maxPerUtcDay: bigint;
}

export type FundingReservation =
  | { readonly state: 'reserved' }
  | { readonly state: 'complete'; readonly result: ServiceWire.FundAccResponse }
  | {
      readonly state: 'released';
      readonly reason: 'preflight-failed' | 'acc-not-submitted' | 'node-rejected';
    }
  | { readonly state: 'pending' | 'conflict' | 'daily-limit' };

export interface FundingObservation {
  readonly request: ServiceWire.FundAccRequest;
  readonly state: 'pending' | 'complete' | 'released';
  readonly progress?: {
    readonly balanceBefore: string;
    readonly preparationTxId?: string;
    readonly depositTxId?: string;
    /** Last durable work phase; this is progress information, not a no-submit proof. */
    readonly phase?: FundingPhase;
    readonly phaseStartedAt?: string;
  };
  readonly result?: ServiceWire.FundAccResponse;
}

export type FundingPhase =
  | 'wallet-preparation'
  | 'wallet-prepared'
  | 'acc-proof'
  | 'wallet-balancing'
  | 'acc-submitted'
  | 'credit-confirmation';

/** Durable milestones for diagnosing an uncertain wallet outcome. */
export type FundingProgress =
  | { readonly stage: 'balance-observed'; readonly balanceBefore: string }
  | { readonly stage: 'prepared'; readonly preparationTxId: string }
  | { readonly stage: 'proof-started' }
  | { readonly stage: 'balancing-started' }
  | { readonly stage: 'submitted'; readonly txId: string }
  | { readonly stage: 'credit-confirmation-started' }
  /** Backend guarantees it has not entered a wallet operation capable of submitting value. */
  | { readonly stage: 'no-submit' }
  /** Measured NIGHT proof/balance failed after wallet preparation but before the ACC send fence. */
  | { readonly stage: 'acc-not-submitted' };

/** Reserve the request ID and daily spend atomically, durably, before any wallet call. */
export interface FundingStore {
  reserve(
    request: ServiceWire.FundAccRequest,
    policy: FundingAssetPolicy,
    utcDay: string,
  ): Promise<FundingReservation>;
  /** Read the original without reserving, dispatching, or changing its outcome. */
  observe?(requestId: string): Promise<FundingObservation | undefined>;
  /** A failed completion must leave the reservation pending for operator reconciliation. */
  complete(requestId: string, result: ServiceWire.FundAccResponse): Promise<void>;
  /** Persist each wallet milestone before the next spending step. */
  recordProgress(requestId: string, progress: FundingProgress): Promise<void>;
  /** Atomically tombstone a request proved to have stopped before any wallet submission. */
  releaseNoSubmit(requestId: string, actor: string): Promise<void>;
  /** Release only a durable measured-NIGHT marker proving the ACC submitter was not entered. */
  releaseAccNotSubmitted?(requestId: string, actor: string): Promise<void>;
  /** Atomically persist independently verified deposit evidence and the original result. */
  completeReconciled(
    requestId: string,
    actor: string,
    result: ServiceWire.FundAccResponse,
    evidence: FundingCreditEvidence,
  ): Promise<void>;
}

/** Must submit through a dedicated wallet, wait for inclusion, and read the credited ACC balance. */
export interface FundingBackend {
  fund(
    request: ServiceWire.FundAccRequest,
    recordProgress?: (progress: FundingProgress) => Promise<void>,
  ): Promise<ServiceWire.FundAccResponse>;
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

async function fundingFailureResult(
  options: FundingRouteOptions,
  requestId: string,
  stage: FundingProgress['stage'] | 'admitted',
  noSubmit: boolean,
  accNotSubmitted: boolean,
  error: unknown,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const log = options.log ?? ((message: string) => console.error(message));
  if (accNotSubmitted && options.store.releaseAccNotSubmitted) {
    try {
      await options.store.releaseAccNotSubmitted(requestId, 'funding-pre-submit');
      log(
        JSON.stringify({
          requestId,
          stage,
          code: 'FundingRequestReleased',
          submission: 'reconciled-no-credit',
        }),
      );
      return {
        status: 409,
        body: {
          requestId,
          code: 'FundingRequestReleased',
          submission: 'reconciled-no-credit',
        },
      };
    } catch {
      // A failed durable release is uncertain. Keep the original ID pending.
    }
  }
  const refusal = checkedPreflight(error, noSubmit);
  if (refusal) {
    try {
      await options.store.releaseNoSubmit(requestId, 'funding-preflight');
      log(JSON.stringify({ requestId, stage, code: refusal.code, submission: 'not-started' }));
      return {
        status: PREFLIGHT_STATUS[refusal.code],
        body: {
          requestId,
          code: refusal.code,
          error: refusal.message,
          submission: 'not-started',
        },
      };
    } catch {
      // A failed durable release is uncertain. Never invite a replacement request.
    }
  }
  log(JSON.stringify({ requestId, stage, code: 'FundingOutcomeUnknown' }));
  return { status: 502, body: { error: 'funding outcome requires reconciliation' } };
}

async function authorizeFunding(options: FundingRouteOptions, req: IncomingMessage): Promise<void> {
  let authorized = false;
  try {
    authorized = await options.authorize(req);
  } catch {
    throw new HttpError(403, 'funding caller refused');
  }
  if (!authorized) throw new HttpError(403, 'funding caller refused');
}

async function readFundingStatus(
  options: FundingRouteOptions,
  res: ServerResponse,
  url: URL,
): Promise<true> {
  const requestId = url.pathname.slice('/v1/faucet/fund/'.length);
  const accountAddress = url.searchParams.get('accountAddress');
  if (!UUID.test(requestId) || !accountAddress || !ADDRESS.test(accountAddress))
    throw new HttpError(400, 'invalid funding status request');
  if (!options.store.observe) throw new HttpError(501, 'funding status is unavailable');
  const observation = await options.store.observe(requestId);
  if (
    !observation ||
    observation.request.accountAddress !== accountAddress ||
    observation.request.networkId !== options.networkId ||
    observation.request.bindingId !== options.bindingId ||
    observation.request.manifestSha256 !== options.manifestSha256
  )
    throw new HttpError(404, 'funding original was not found');
  res.setHeader('cache-control', 'no-store');
  json(res, 200, {
    requestId,
    accountAddress,
    color: observation.request.color,
    amount: observation.request.amount,
    state: observation.state,
    ...(observation.progress && { progress: observation.progress }),
    ...(observation.result && { result: observation.result }),
  });
  return true;
}

async function executeFunding(
  options: FundingRouteOptions,
  request: ServiceWire.FundAccRequest,
): Promise<{ readonly status: number; readonly body: unknown }> {
  const startedAt = Date.now();
  const logPhase = (stage: string) => {
    try {
      (options.log ?? console.error)(
        JSON.stringify({
          requestId: request.requestId,
          stage,
          elapsedMs: Math.max(0, Date.now() - startedAt),
        }),
      );
    } catch {
      // Logging is observational and must not change the durable funding outcome.
    }
  };
  let stage: FundingProgress['stage'] | 'admitted' = 'admitted';
  let noSubmit = false;
  let accNotSubmitted = false;
  try {
    const result = await options.backend.fund(request, async (progress) => {
      await options.store.recordProgress(request.requestId, progress);
      stage = progress.stage;
      noSubmit = progress.stage === 'no-submit';
      accNotSubmitted = progress.stage === 'acc-not-submitted';
      logPhase(progress.stage);
    });
    if (
      result.requestId !== request.requestId ||
      !result.txId ||
      !DECIMAL.test(result.creditedBalance) ||
      BigInt(result.creditedBalance) > MAX_AMOUNT
    )
      throw new Error('funding backend returned an invalid confirmation');
    await options.store.complete(request.requestId, result);
    logPhase('credited');
    return { status: 200, body: result };
  } catch (error) {
    return fundingFailureResult(
      options,
      request.requestId,
      stage,
      noSubmit,
      accNotSubmitted,
      error,
    );
  }
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
  return async (req, res, url) => {
    if (req.method === 'GET' && url.pathname.startsWith('/v1/faucet/fund/')) {
      await authorizeFunding(options, req);
      return readFundingStatus(options, res, url);
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/faucet/fund') return false;
    await authorizeFunding(options, req);
    const asyncRequested = req.headers.prefer === 'respond-async';
    if (asyncRequested && !options.store.observe)
      throw new HttpError(501, 'asynchronous funding requires durable status');
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
    if (reservation.state === 'released') {
      json(res, 409, {
        requestId: request.requestId,
        code: 'FundingRequestReleased',
        submission: 'reconciled-no-credit',
      });
      return true;
    }
    if (reservation.state === 'conflict') throw new HttpError(409, 'funding request ID was reused');
    if (reservation.state === 'daily-limit')
      throw new HttpError(429, 'daily funding limit reached');
    if (asyncRequested) {
      // The reservation is durable before acknowledgement. A disconnected browser
      // can only observe this original; it cannot start another wallet operation.
      void executeFunding(options, request).catch(() => {
        (options.log ?? console.error)(
          JSON.stringify({
            requestId: request.requestId,
            code: 'FundingOutcomeUnknown',
            stage: 'status-write',
          }),
        );
      });
      json(res, 202, { requestId: request.requestId, state: 'pending' });
      return true;
    }
    const outcome = await executeFunding(options, request);
    if (outcome.status === 502) throw new HttpError(502, 'funding outcome requires reconciliation');
    json(res, outcome.status, outcome.body);
    return true;
  };
}
