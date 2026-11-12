import type { FlowOptions } from '@input-output-hk/mn-passport-protocol';
import { z } from 'zod';
import {
  verifyAgentJubjubGrantRequest,
  type AgentJubjubGrantRequestContext,
} from './agent-grant-request.js';
import {
  agentGrantScopeFields,
  matchesAgentGrantScope,
  prepareAgentGrantOpening,
  type AgentGrantSettlementPure,
} from './agent-grant-settlement.js';
import { PassportConnectorError } from './errors.js';
import {
  checkUnshieldedGrant,
  spendUnshieldedWithGrant,
  type CheckedUnshieldedGrant,
  type UnshieldedGrantIntent,
  type UnshieldedGrantSpendPorts,
} from './grant-holder.js';
import {
  chainReference,
  decodeGrantJson,
  grantWireHex32,
  grantWireUint128,
  maxGrantParameterLength,
  timestamp,
} from './grant-request-wire.js';
import { mutationDigest } from './mutation-codec.js';
import type {
  CallRequest,
  TxResult,
  LiveP256GrantSpendContext,
  P256GrantSpendSource,
  PinnedChain,
} from './ports/index.js';

const scopeSchema = z.strictObject({
  op_withdraw_unshielded: z.literal(true),
  op_withdraw_shielded: z.literal(false),
  op_withdraw_shielded_to_contract: z.literal(false),
  read: z.literal(false),
  color: grantWireHex32,
  recipient_kind: z.literal(1),
  recipient: grantWireHex32,
  max_coin_value: grantWireUint128,
  per_call_cap: grantWireUint128,
  cap: grantWireUint128,
  expires_at: timestamp,
});

const responseSchema = z.strictObject({
  result: z.literal('granted'),
  chain: chainReference,
  account: grantWireHex32,
  grant_id: grantWireHex32,
  scope_salt: grantWireHex32,
  scope: z.string().min(1).max(maxGrantParameterLength),
  tx: z.string().min(1).max(256).optional(),
});

const uint64 = z
  .bigint()
  .positive()
  .max((1n << 64n) - 1n);
const uint32 = z
  .bigint()
  .min(0n)
  .max((1n << 32n) - 1n);
const issuanceSchema = z
  .strictObject({
    requestDigest: grantWireHex32,
    account: grantWireHex32,
    grantId: grantWireHex32,
    scopeSalt: grantWireHex32,
    issuedAt: uint64,
    epoch: uint32,
    generation: uint32,
  })
  .readonly();

export type AgentJubjubGrantIssuance = z.infer<typeof issuanceSchema>;
export interface AgentJubjubGrantResponseInput {
  readonly originalRequest: unknown;
  readonly response: unknown;
}

export interface AgentJubjubGrantHolderPorts {
  /** Trusted host pins captured from the agent's request session. */
  readonly request: Omit<AgentJubjubGrantRequestContext, 'nowSeconds'> & {
    /** Local time at which the original signed request was sent, in POSIX seconds. */
    readonly requestedAt: number;
  };
  readonly grants: P256GrantSpendSource;
  readonly pure: AgentGrantSettlementPure;
  readonly nowSeconds?: () => number;
}

export interface AgentJubjubGrantSpendPorts
  extends
    AgentJubjubGrantHolderPorts,
    Pick<UnshieldedGrantSpendPorts, 'grantee' | 'review' | 'attempts' | 'sleep'> {
  readonly pure: AgentGrantSettlementPure & UnshieldedGrantSpendPorts['pure'];
  readonly chain: PinnedChain;
}

function invalid(message: string): never {
  throw new PassportConnectorError('GrantScopeInvalid', message);
}

function parseResponse(input: unknown) {
  try {
    const response = responseSchema.parse(input);
    return { response, approved: scopeSchema.parse(decodeGrantJson(response.scope)) };
  } catch {
    return invalid('Invalid direct agent grant response.');
  }
}

function opening(
  input: AgentJubjubGrantResponseInput,
  ports: AgentJubjubGrantHolderPorts,
  chain?: PinnedChain,
) {
  const { authoriserOrigin, networkId, account, requestedAt } = ports.request;
  const { grants, pure } = ports;
  const request = verifyAgentJubjubGrantRequest(input.originalRequest, {
    authoriserOrigin,
    networkId,
    account,
    nowSeconds: requestedAt,
  });
  const { response, approved } = parseResponse(input.response);
  if (
    response.account !== account ||
    response.chain !== 'midnight:' + request.networkId ||
    mutationDigest(approved) !== mutationDigest(agentGrantScopeFields(request.scope))
  )
    return invalid('The returned scope or account differs from the signed request.');
  const prepared = prepareAgentGrantOpening(request, response.scope_salt, requestedAt, pure);
  if (response.grant_id !== prepared.grantId)
    return invalid('The returned grant ID differs from the signed key and slot.');
  const checkPins = () => {
    if (grants.networkId !== request.networkId || (chain && chain.networkId !== request.networkId))
      throw new PassportConnectorError(
        'NetworkMismatch',
        'Agent grant requires one pinned network.',
      );
    if (grants.bindingId !== 'acc-s3r1.1' || (chain && chain.bindingId !== 'acc-s3r1.1'))
      throw new PassportConnectorError('BindingUnsupported', 'Agent grant requires acc-s3r1.1.');
  };
  const now = ports.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const checkTime = () => {
    const seconds = timestamp.safeParse(now());
    if (!seconds.success || seconds.data < requestedAt || seconds.data >= request.scope.expiresAt)
      return invalid('The agent grant expired or the local clock is invalid.');
    return seconds.data;
  };
  checkPins();
  checkTime();
  async function read(mode: 'authorise' | 'settle' = 'authorise') {
    checkPins();
    const live = await grants.readP256GrantSpendContext(account, prepared.grantId);
    checkPins();
    if (mode === 'authorise') checkTime();
    if (!live) throw new PassportConnectorError('GrantNotFound', 'The grant is absent on chain.');
    if (
      mode === 'authorise' &&
      (!live.active ||
        live.grantEpoch !== live.deviceEpoch ||
        live.grantGeneration !== live.generation)
    )
      throw new PassportConnectorError(
        'GrantRevoked',
        'The grant is inactive in this ACC generation.',
      );
    if (!matchesAgentGrantScope(live, request.scope, prepared, pure))
      return invalid('The returned scope does not open the live grant.');
    return live;
  }
  function issuance(live: LiveP256GrantSpendContext) {
    const value = issuanceSchema.safeParse({
      requestDigest: request.requestDigest,
      account: request.account,
      grantId: prepared.grantId,
      scopeSalt: response.scope_salt,
      issuedAt: live.issuedAt,
      epoch: live.grantEpoch,
      generation: live.grantGeneration,
    });
    if (!value.success) return invalid('Invalid live agent grant issuance.');
    return value.data;
  }
  return { request, response, read, issuance, checkTime, checkPins };
}

/** Validate the original request and returned opening against a single pinned ledger read. */
export async function verifyAgentJubjubGrantResponse(
  input: AgentJubjubGrantResponseInput,
  ports: AgentJubjubGrantHolderPorts,
) {
  const grant = opening(input, ports);
  const live = await grant.read();
  return Object.freeze({
    account: grant.request.account,
    networkId: grant.request.networkId,
    grantId: grant.response.grant_id,
    scope: grant.request.scope,
    issuance: grant.issuance(live),
  });
}

export interface AgentJubjubGrantSpendInput extends AgentJubjubGrantResponseInput {
  /** Retain the first verified issuance in the holder's protected store. */
  readonly issuance: AgentJubjubGrantIssuance;
  readonly amount: string;
  readonly spentPrev: string;
}

export class AgentGrantSpendUnsettled extends PassportConnectorError {
  constructor(
    readonly grantId: string,
    readonly previousGrantNonce: string,
    readonly txHash: string | undefined,
    cause: unknown,
  ) {
    super('MutationUnsettled', 'Reconcile the original agent grant spend.', {
      cause,
      retryable: false,
    });
  }
}

/** Check the original issuance before the key session and on every pre-submission read. */
export function spendWithAgentJubjubGrant(
  input: AgentJubjubGrantSpendInput,
  ports: AgentJubjubGrantSpendPorts,
  options: FlowOptions = {},
) {
  return runAgentGrantSpend(input, ports, options);
}

export interface AgentGrantDispatch {
  readonly call: CallRequest;
  readonly networkId: string;
  readonly expiresAt: number;
  readonly intent: UnshieldedGrantIntent;
  readonly checked: CheckedUnshieldedGrant;
  readonly issuance: AgentJubjubGrantIssuance;
  verify(): Promise<void>;
}

export async function runAgentGrantSpend(
  input: AgentJubjubGrantSpendInput,
  ports: AgentJubjubGrantSpendPorts,
  options: FlowOptions,
  durable?: {
    beforeReview(): Promise<void>;
    submit(dispatch: AgentGrantDispatch): Promise<TxResult>;
  },
) {
  const { chain, pure, grantee, review, attempts, sleep } = ports;
  const grant = opening(input, ports, chain);
  const expected = issuanceSchema.safeParse(input.issuance);
  if (!expected.success) return invalid('Invalid retained agent grant issuance.');
  const digest = mutationDigest(expected.data);
  const { request, response } = grant;
  const intent: UnshieldedGrantIntent = {
    account: request.account,
    grantId: response.grant_id,
    granteePublicKey: request.scope.grantee.publicKey,
    origin: request.clientId,
    slot: request.slot,
    scopeSalt: response.scope_salt,
    color: request.scope.color,
    recipient: request.scope.recipient.value,
    maxCoinValue: request.scope.maxCoinValue,
    amount: input.amount,
    spentPrev: input.spentPrev,
  };
  let dispatchStarted = false;
  const read = async () => {
    // Settlement verifies the original issuance even when its authorization has ended.
    const live = await grant.read(dispatchStarted ? 'settle' : 'authorise');
    if (mutationDigest(grant.issuance(live)) !== digest)
      return invalid('The live grant differs from the retained original issuance.');
    return live;
  };
  if (durable) await durable.beforeReview();
  const preflight = await read();
  const checked = checkUnshieldedGrant(intent, preflight, pure, grant.checkTime());
  if (options.signal?.aborted)
    throw new PassportConnectorError('Aborted', 'Agent grant spend cancelled.');
  const previousNonce = preflight.nonce;
  let txHash: string | undefined;
  const verify = async () => {
    const live = await read();
    if (live.nonce !== previousNonce)
      throw new PassportConnectorError('GrantRosterUnsettled', 'The agent grant nonce changed.');
    checkUnshieldedGrant(intent, live, pure, grant.checkTime());
    if (options.signal?.aborted)
      throw new PassportConnectorError('Aborted', 'Agent grant spend cancelled.');
  };
  try {
    return await spendUnshieldedWithGrant(
      intent,
      {
        grantee,
        pure,
        review,
        ...(attempts !== undefined && { attempts }),
        ...(sleep && { sleep }),
        nowSeconds: grant.checkTime,
        source: {
          async readGrantSpendContext() {
            const live = await read();
            if (!dispatchStarted && live.nonce !== previousNonce)
              throw new PassportConnectorError(
                'GrantRosterUnsettled',
                'The agent grant nonce changed.',
              );
            return live;
          },
        },
        chain: {
          readAccount: (account, flags) => chain.readAccount(account, flags),
          async call(call) {
            grant.checkPins();
            grant.checkTime();
            if (call.signal?.aborted)
              throw new PassportConnectorError('Aborted', 'Agent grant spend cancelled.');
            if (!durable) dispatchStarted = true;
            const transaction = durable
              ? await durable.submit({
                  call,
                  networkId: request.networkId,
                  expiresAt: request.scope.expiresAt,
                  intent,
                  checked,
                  issuance: expected.data,
                  verify,
                })
              : await chain.call(call);
            dispatchStarted = true;
            txHash = transaction.txHash;
            return transaction;
          },
        },
      },
      options,
    );
  } catch (cause) {
    if (!dispatchStarted) throw cause;
    throw new AgentGrantSpendUnsettled(intent.grantId, previousNonce.toString(), txHash, cause);
  }
}
