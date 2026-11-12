import type { FlowOptions } from '@input-output-hk/mn-passport-protocol';
import { z } from 'zod';
import {
  AgentGrantIssueUnsettled,
  parseAgentIssueRecord,
  type AgentGrantIssueJournal,
  type AgentGrantIssueRecord,
} from './agent-grant-issue-journal.js';
import { verifyAgentJubjubGrantRequest } from './agent-grant-request.js';
import {
  settledAgentGrant,
  type AgentGrantSettlementPure,
  type GrantedAgentJubjubScope,
  type VerifiedAgentGrant,
} from './agent-grant-settlement.js';
import type { AgentGrantNonceStore } from './browser-grant-nonce.js';
import { PassportConnectorError } from './errors.js';
import { timestamp } from './grant-request-wire.js';
import {
  issueJubjubGrantCall,
  type IssueJubjubGrantCallInput,
  type IssueJubjubGrantCallPorts,
  type IssueJubjubGrantPure,
  type StagedJubjubGrant,
} from './jubjub-grant-issue.js';
import { mutationDigest } from './mutation-codec.js';
import { issueP256GrantCall, type IssueP256GrantPure } from './p256-grant-issue.js';
import type {
  AccountHint,
  ActiveGrantSnapshotSource,
  DeadlineFencedGrantIssuePort,
  GrantRosterSource,
  P256GrantSpendSource,
  PinnedChain,
} from './ports/index.js';

export interface AgentJubjubGrantIssuePorts extends Pick<
  IssueJubjubGrantCallPorts,
  'authoriser' | 'records' | 'journal' | 'random'
> {
  readonly owner: AccountHint;
  readonly authoriserOrigin: string;
  readonly networkId: string;
  readonly chain: PinnedChain & DeadlineFencedGrantIssuePort;
  readonly grants: ActiveGrantSnapshotSource & GrantRosterSource & P256GrantSpendSource;
  readonly pure: AgentGrantSettlementPure & (IssueJubjubGrantPure | IssueP256GrantPure);
  readonly nonces: AgentGrantNonceStore;
  readonly originalIssues: AgentGrantIssueJournal;
  readonly nowSeconds?: () => number;
  /** Check that the selected account, credential route and agent channel are still current. */
  readonly isCurrent: () => boolean;
  /**
   * Review the exact scope and client label. Recovery also requires fresh credential-pinned
   * approval before disclosing any opening. For issue, the injected authoriser performs the
   * fresh owner ceremony for the same reviewed operation.
   */
  readonly approve: (review: {
    readonly operation: 'issue' | 'recover';
    readonly request: VerifiedAgentGrant;
  }) => Promise<boolean>;
}

function captureOwner(owner: AccountHint): AccountHint {
  const policy = owner.scheme === 'p256-webauthn' ? owner.policy : undefined;
  if (
    (owner.scheme !== 'jubjub-schnorr' && owner.scheme !== 'p256-webauthn') ||
    owner.status !== 'active' ||
    !owner.credentialId?.length ||
    (owner.scheme === 'p256-webauthn' &&
      (!(policy?.rp_id_hash instanceof Uint8Array) ||
        policy.rp_id_hash.length !== 32 ||
        !(policy.origin instanceof Uint8Array) ||
        policy.origin.length !== 21))
  )
    throw new PassportConnectorError(
      'NotAuthorised',
      'An active credential-pinned owner route is required.',
    );
  return {
    address: owner.address,
    scheme: owner.scheme,
    status: owner.status,
    credentialId: Uint8Array.from(owner.credentialId),
    publicKey: { ...owner.publicKey },
    ...(policy && {
      policy: {
        rp_id_hash: Uint8Array.from(policy.rp_id_hash),
        origin: Uint8Array.from(policy.origin),
      },
    }),
  };
}

function checkPins(ports: AgentJubjubGrantIssuePorts) {
  if (ports.chain.networkId !== ports.networkId || ports.grants.networkId !== ports.networkId)
    throw new PassportConnectorError('NetworkMismatch', 'Agent grant requires one pinned network.');
  if (ports.chain.bindingId !== 'acc-s3r1.1' || ports.grants.bindingId !== 'acc-s3r1.1')
    throw new PassportConnectorError('BindingUnsupported', 'Agent grant requires acc-s3r1.1.');
}

function route(ports: AgentJubjubGrantIssuePorts, options: FlowOptions) {
  const owner = captureOwner(ports.owner);
  const ownerRoute = mutationDigest(owner);
  const { authoriserOrigin, networkId, authoriser, chain, grants } = ports;
  if (authoriser.scheme !== owner.scheme)
    throw new PassportConnectorError('NotAuthorised', 'The owner credential route differs.');
  const now = ports.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const check = () => {
    checkPins(ports);
    if (options.signal?.aborted)
      throw new PassportConnectorError('Aborted', 'Agent grant request cancelled.');
    if (
      ports.authoriserOrigin !== authoriserOrigin ||
      ports.networkId !== networkId ||
      ports.authoriser !== authoriser ||
      authoriser.scheme !== owner.scheme ||
      ports.chain !== chain ||
      ports.grants !== grants ||
      !ports.isCurrent() ||
      mutationDigest(captureOwner(ports.owner)) !== ownerRoute
    )
      throw new PassportConnectorError(
        'NotAuthorised',
        'The selected agent or owner route changed.',
      );
  };
  check();
  return {
    owner,
    now,
    check,
    verify(input: unknown, at: number) {
      return verifyAgentJubjubGrantRequest(input, {
        account: owner.address,
        authoriserOrigin,
        networkId,
        nowSeconds: at,
      });
    },
    admission(request: VerifiedAgentGrant) {
      return {
        account: request.account,
        networkId: request.networkId,
        issuer: request.issuer,
        nonce: request.nonce,
        requestDigest: request.requestDigest,
        validUntilSeconds: request.validUntilSeconds,
        ownerRoute,
      };
    },
  };
}

async function approve(
  ports: AgentJubjubGrantIssuePorts,
  operation: 'issue' | 'recover',
  request: VerifiedAgentGrant,
) {
  if (!(await ports.approve(Object.freeze({ operation, request }))))
    throw new PassportConnectorError('UserCancelled', 'Agent grant approval was declined.');
}

type Route = ReturnType<typeof route>;

type OwnerIssuePorts = Omit<IssueJubjubGrantCallPorts, 'pure' | 'rotateBeforeIssue'>;

function selectOwnerIssue(ports: AgentJubjubGrantIssuePorts, owner: AccountHint) {
  const { authoriser, pure } = ports;
  if (
    authoriser.withKeySession &&
    owner.scheme === 'p256-webauthn' &&
    authoriser.deviceBinding &&
    'challenge_issue_grant_with_p256' in pure &&
    'derive_device_entry_with_p256' in pure
  ) {
    return {
      circuit: 'issue_grant_with_p256' as const,
      issue: (input: IssueJubjubGrantCallInput, shared: OwnerIssuePorts) =>
        issueP256GrantCall(input, { ...shared, pure }),
    };
  }
  if (
    authoriser.withKeySession &&
    owner.scheme === 'jubjub-schnorr' &&
    'challenge_issue_grant_with_jubjub' in pure &&
    'derive_device_entry_with_jubjub' in pure
  ) {
    return {
      circuit: 'issue_grant_with_jubjub' as const,
      issue: (input: IssueJubjubGrantCallInput, shared: OwnerIssuePorts) =>
        issueJubjubGrantCall(input, { ...shared, pure }),
    };
  }
  throw new PassportConnectorError(
    'BindingUnsupported',
    'The owner issue signer or binding is unavailable.',
  );
}

async function issueOriginal(
  request: VerifiedAgentGrant,
  requestId: string,
  admittedAt: number,
  current: Route,
  ownerIssue: ReturnType<typeof selectOwnerIssue>,
  ports: AgentJubjubGrantIssuePorts,
  options: FlowOptions,
) {
  const validUntilSeconds = Math.min(request.validUntilSeconds, request.scope.expiresAt - 1);
  const checkDeadline = () => {
    current.check();
    const now = timestamp.parse(current.now());
    if (now < admittedAt || now > validUntilSeconds)
      throw new PassportConnectorError('GrantScopeInvalid', 'The signed agent request expired.');
  };
  const { circuit } = ownerIssue;
  const view = await ports.chain.readAccount(request.account, {
    includeDevices: true,
    ...(circuit === 'issue_grant_with_p256' && { includeInbox: true }),
  });
  const roster = await ports.grants.readGrantRoster(request.account);
  if (!view?.booted || view.authNonce !== roster.authNonce || view.specVersion !== 3)
    throw new PassportConnectorError('GrantRosterUnsettled', 'The live owner and roster disagree.');
  const checkSnapshot = async () => {
    const live = await ports.chain.readAccount(request.account);
    const latest = await ports.grants.readGrantRoster(request.account);
    checkDeadline();
    if (
      !live?.booted ||
      live.specVersion !== 3 ||
      live.authNonce !== view.authNonce ||
      live.deviceEpoch !== view.deviceEpoch ||
      latest.authNonce !== roster.authNonce ||
      latest.generation !== roster.generation
    )
      throw new PassportConnectorError(
        'GrantRosterUnsettled',
        'The owner or grant roster changed.',
      );
  };
  const admissionDigest = mutationDigest(current.admission(request));
  let record: AgentGrantIssueRecord | undefined;
  let scopeDigest: string | undefined;
  const stage = async (grant: StagedJubjubGrant) => {
    await checkSnapshot();
    const signedScopeDigest = grant.scopeDigest;
    const original = parseAgentIssueRecord(
      {
        requestId,
        admissionDigest,
        admittedAt,
        salt: grant.bookkeeping.scopeSalt,
        expectedIssuedAt: view.authNonce + 1n,
        epoch: view.deviceEpoch,
        generation: roster.generation,
      },
      requestId,
    );
    await ports.journal.stage(grant);
    if (!(await ports.originalIssues.reserve(original)))
      throw new AgentGrantIssueUnsettled(requestId);
    record = original;
    scopeDigest = signedScopeDigest;
  };
  checkDeadline();
  await ownerIssue.issue(
    {
      ...options,
      hint: current.owner,
      origin: request.clientId,
      scope: request.scope,
      requestedSlot: request.slot,
    },
    {
      bindingId: 'acc-s3r1.1',
      authoriser: ports.authoriser,
      records: ports.records,
      ...(ports.random && { random: ports.random }),
      nowSeconds: current.now,
      grants: ports.grants,
      journal: { stage },
      chain: {
        readAccount: async () => view,
        async call(call) {
          if (
            !record ||
            !scopeDigest ||
            call.circuit !== circuit ||
            call.address !== request.account
          )
            throw new AgentGrantIssueUnsettled(requestId);
          await checkSnapshot();
          checkDeadline();
          return ports.chain.submitDeadlineFencedGrantIssue({
            ...call,
            circuit,
            mutation: {
              requestId,
              validUntilSeconds,
              intentSha256: mutationDigest({
                kind: 'agent-jubjub-grant-issue',
                circuit,
                record,
                scopeDigest,
                signedArguments: mutationDigest(call.args),
              }),
            },
          });
        },
      },
    },
  );
  if (!record) throw new AgentGrantIssueUnsettled(requestId);
  return record;
}

async function confirmed(
  current: Route,
  ports: AgentJubjubGrantIssuePorts,
  request: VerifiedAgentGrant,
  record: AgentGrantIssueRecord,
) {
  const result = await settledAgentGrant(request, record, ports.grants, ports.pure, current.now);
  current.check();
  if (!result) throw new AgentGrantIssueUnsettled(record.requestId);
  return result;
}

/** Issue one reviewed direct-channel request. A consumed nonce can only be reconciled. */
export async function issueAgentJubjubGrant(
  input: unknown,
  ports: AgentJubjubGrantIssuePorts,
  options: FlowOptions = {},
): Promise<GrantedAgentJubjubScope> {
  if (typeof ports.chain.submitDeadlineFencedGrantIssue !== 'function')
    throw new PassportConnectorError(
      'BindingUnsupported',
      'Agent grant requires a deadline-fenced issue dispatcher.',
    );
  const current = route(ports, options);
  const ownerIssue = selectOwnerIssue(ports, current.owner);
  const admittedAt = timestamp.parse(current.now());
  const request = current.verify(input, admittedAt);
  const admission = current.admission(request);
  const previous = await ports.nonces.read(admission);
  if (previous) throw new AgentGrantIssueUnsettled(previous);
  current.check();
  await approve(ports, 'issue', request);
  current.check();
  const reviewedAt = timestamp.parse(current.now());
  if (
    reviewedAt < admittedAt ||
    reviewedAt > request.validUntilSeconds ||
    reviewedAt >= request.scope.expiresAt
  )
    throw new PassportConnectorError('GrantScopeInvalid', 'The signed agent request expired.');
  const { requestId, first } = await ports.nonces.claim(admission);
  if (!first) throw new AgentGrantIssueUnsettled(requestId);
  try {
    const record = await issueOriginal(
      request,
      requestId,
      admittedAt,
      current,
      ownerIssue,
      ports,
      options,
    );
    return await confirmed(current, ports, request, record);
  } catch (cause) {
    throw new AgentGrantIssueUnsettled(requestId, cause);
  }
}

/** Recover only the original request, even after its admission deadline. Never submit again. */
export async function recoverAgentJubjubGrant(
  requestId: string,
  input: unknown,
  ports: AgentJubjubGrantIssuePorts,
  options: FlowOptions = {},
): Promise<GrantedAgentJubjubScope> {
  if (!z.uuid().safeParse(requestId).success)
    throw new PassportConnectorError('GrantScopeInvalid', 'Invalid grant request ID.');
  const current = route(ports, options);
  const record = parseAgentIssueRecord(await ports.originalIssues.read(requestId), requestId);
  const request = current.verify(input, record.admittedAt);
  const admission = current.admission(request);
  if (
    mutationDigest(admission) !== record.admissionDigest ||
    (await ports.nonces.read(admission)) !== requestId
  )
    throw new AgentGrantIssueUnsettled(requestId);
  current.check();
  await approve(ports, 'recover', request);
  current.check();
  return confirmed(current, ports, request, record);
}
