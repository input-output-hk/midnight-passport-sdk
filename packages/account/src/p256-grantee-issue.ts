import type { FlowOptions, PassportTxResult } from '@input-output-hk/mn-passport-protocol';
import { z } from 'zod';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { grantOriginHash } from './grant-scope.js';
import { mutationDigest } from './mutation-codec.js';
import {
  p256GranteePoint,
  p256GranteeScopeSchema,
  p256GrantOpeningSchema,
  prepareP256UnshieldedGrant,
  type P256GrantOpeningPure,
  type P256UnshieldedGrantOpening,
  type P256UnshieldedGrantScope,
} from './p256-grant-opening.js';
import { matchesP256Scope } from './p256-grant-spend-check.js';
import { signP256GranteeIssue, type P256GranteeOwnerPure } from './p256-grantee-owner.js';
import type {
  AccountHint,
  Authoriser,
  GrantRosterSource,
  P256GrantSpendSource,
  PinnedChain,
} from './ports/index.js';
import { NetworkIdSchema } from './validation.js';

export interface P256GranteeIssueRecord {
  readonly requestId: string;
  readonly networkId: string;
  readonly opening: P256UnshieldedGrantOpening;
  readonly intentSha256: string;
  readonly expectedIssuedAt: bigint;
  readonly deviceEpoch: bigint;
  readonly grantGeneration: bigint;
  readonly txHash?: string;
}

/** Confidential, authenticated, crash-durable storage. Keep the opening out of audit events. */
export interface P256GranteeIssueJournal {
  read(requestId: string): Promise<P256GranteeIssueRecord | undefined>;
  /** Atomically reserve once. The record is retained even when submission is uncertain. */
  reserve(record: P256GranteeIssueRecord): Promise<boolean>;
  recordTransaction(record: P256GranteeIssueRecord, txHash: string): Promise<void>;
}

/** Retain these request IDs independently of the protected opening journal. */
export interface P256GranteeIssueFence {
  has(requestId: string): Promise<boolean>;
  /** Atomically claim one original request ID, even when its opening is later unavailable. */
  reserve(requestId: string): Promise<boolean>;
}

export interface P256GranteeIssuePorts {
  readonly networkId: string;
  readonly chain: PinnedChain;
  readonly grants: GrantRosterSource & P256GrantSpendSource;
  readonly owner: AccountHint;
  readonly authoriser: Authoriser;
  readonly pure: P256GrantOpeningPure & P256GranteeOwnerPure;
  readonly journal: P256GranteeIssueJournal;
  readonly fence: P256GranteeIssueFence;
  readonly review: (request: {
    readonly networkId: string;
    readonly scope: P256UnshieldedGrantScope;
    readonly grantId: string;
  }) => Promise<boolean>;
  readonly random?: (length: number) => Uint8Array;
  readonly nowSeconds?: () => number;
}

export class P256GranteeIssueUnsettled extends PassportConnectorError {
  constructor(
    readonly requestId: string,
    readonly txHash?: string,
    cause?: unknown,
  ) {
    super(
      'MutationUnsettled',
      `Reconcile original grant issue ${requestId} before issuing again.`,
      { cause, retryable: false },
    );
  }
}

const issueInput = z.strictObject({ requestId: z.uuid(), scope: p256GranteeScopeSchema });

function pins(networkId: string, grants: P256GrantSpendSource, chain?: PinnedChain): void {
  if (
    !NetworkIdSchema.safeParse(networkId).success ||
    grants.networkId !== networkId ||
    (chain && chain.networkId !== networkId)
  )
    throw new PassportConnectorError('NetworkMismatch', 'Grant issue requires one pinned network.');
  if (grants.bindingId !== 'acc-s3r1.1' || (chain && chain.bindingId !== grants.bindingId))
    throw new PassportConnectorError('BindingUnsupported', 'Grant issue requires acc-s3r1.1.');
}

function checkpoint(options: FlowOptions): void {
  if (options.signal?.aborted)
    throw new PassportConnectorError('Aborted', 'Grant issue cancelled.');
}

async function ownerSnapshot(
  account: string,
  ports: Pick<P256GranteeIssuePorts, 'networkId' | 'chain' | 'grants'>,
) {
  const { chain, grants, networkId } = ports;
  const view = await chain.readAccount(account, { includeDevices: true });
  const roster = await grants.readGrantRoster(account);
  pins(networkId, grants, chain);
  if (!view?.booted || view.specVersion !== 3 || roster.authNonce !== view.authNonce)
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'The live owner and grant roster disagree.',
    );
  const ids = roster.entries
    .filter(({ active }) => active)
    .map(({ id }) => id)
    .sort();
  return {
    view,
    ids,
    generation: roster.generation,
    epoch: view.deviceEpoch,
    nonce: view.authNonce,
  };
}

/** Issue a direct unshielded grant to a distinct P-256 passkey using the active owner arm. */
export async function issueP256GranteeGrant(
  input: { readonly requestId: string; readonly scope: P256UnshieldedGrantScope },
  ports: P256GranteeIssuePorts,
  options: FlowOptions = {},
): Promise<
  PassportTxResult & {
    readonly opening: P256UnshieldedGrantOpening;
    readonly nextUseCounter: bigint;
  }
> {
  const admitted = issueInput.safeParse(input);
  if (!admitted.success)
    throw new PassportConnectorError('GrantScopeInvalid', 'Malformed grant issue.');
  const { requestId, scope } = admitted.data;
  const { networkId, grants, chain, authoriser, pure, journal, fence } = ports;
  const owner = structuredCloneOwner(ports.owner);
  pins(networkId, grants, chain);
  if (
    owner.status !== 'active' ||
    owner.address !== scope.account ||
    !authoriser.withKeySession ||
    authoriser.scheme !== owner.scheme ||
    (owner.scheme !== 'p256-webauthn' && owner.scheme !== 'jubjub-schnorr')
  )
    throw new PassportConnectorError('NotAuthorised', 'An active owner key session is required.');
  if (owner.scheme === 'p256-webauthn') {
    const grantee = p256GranteePoint(scope.grantee.publicKey);
    if (grantee.x === owner.publicKey.x && grantee.y === owner.publicKey.y)
      throw new PassportConnectorError('GrantScopeInvalid', 'Choose a distinct grantee passkey.');
  }
  checkpoint(options);
  const previous = await journal.read(requestId);
  if (previous || (await fence.has(requestId)))
    throw new P256GranteeIssueUnsettled(requestId, previous?.txHash);
  const first = await ownerSnapshot(scope.account, { networkId, chain, grants });
  const now = ports.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const prepared = prepareP256UnshieldedGrant(
    { scope, activeGrantIds: first.ids, nowSeconds: now() },
    pure,
    ports.random,
  );
  const opening = Object.freeze(prepared.opening);
  const scopeDigest = toHex(prepared.scopeDigest);
  checkpoint(options);
  if (!(await ports.review(Object.freeze({ networkId, scope, grantId: opening.grantId }))))
    throw new PassportConnectorError('UserCancelled', 'Grant issue was declined.');
  const recheck = async () => {
    const live = await ownerSnapshot(scope.account, { networkId, chain, grants });
    if (
      live.epoch !== first.epoch ||
      live.nonce !== first.nonce ||
      live.generation !== first.generation ||
      live.ids.join(',') !== first.ids.join(',') ||
      (scope.expiresAt !== null && now() >= scope.expiresAt)
    )
      throw new PassportConnectorError(
        'GrantRosterUnsettled',
        'The owner or grant roster changed.',
      );
    checkpoint(options);
    return live.view;
  };
  return authoriser.withKeySession(
    async () => {
      const view = await recheck();
      const signed = await signP256GranteeIssue(owner, authoriser, pure, view, prepared);
      await recheck();
      const record = Object.freeze({
        requestId,
        networkId,
        opening,
        expectedIssuedAt: first.nonce + 1n,
        deviceEpoch: first.epoch,
        grantGeneration: first.generation,
        intentSha256: mutationDigest({
          kind: 'p256-grantee-issue',
          networkId,
          scopeDigest,
          id: opening.grantId,
          nonce: first.nonce,
          epoch: first.epoch,
          generation: first.generation,
          signedArguments: mutationDigest(signed.args),
        }),
      });
      let txHash: string | undefined;
      try {
        if (!(await fence.reserve(requestId)) || !(await journal.reserve(record)))
          throw new P256GranteeIssueUnsettled(requestId);
        await recheck();
        const tx = await chain.call({
          ...(options.signal && { signal: options.signal }),
          ...(options.onEvent && { onEvent: options.onEvent }),
          address: scope.account,
          circuit: signed.circuit,
          args: signed.args,
          mutation: { requestId, intentSha256: record.intentSha256 },
        });
        txHash = tx.txHash;
        await journal.recordTransaction(record, txHash);
        const live = await recoverIssuedP256Grant(requestId, { networkId, grants, journal, pure });
        if (!live) throw new P256GranteeIssueUnsettled(requestId, txHash);
        return { ...tx, opening, nextUseCounter: signed.nextUseCounter };
      } catch (error) {
        if (error instanceof P256GranteeIssueUnsettled) throw error;
        throw new P256GranteeIssueUnsettled(requestId, txHash, error);
      }
    },
    { kind: 'issue-grant', account: scope.account, grantId: opening.grantId, scopeDigest },
  );
}

/** Read the original live grant. Absence or a changed opening never authorizes reissue. */
export async function recoverIssuedP256Grant(
  requestId: string,
  ports: Pick<P256GranteeIssuePorts, 'networkId' | 'grants' | 'journal' | 'pure'>,
): Promise<P256GranteeIssueRecord | undefined> {
  if (!z.uuid().safeParse(requestId).success) throw new P256GranteeIssueUnsettled(requestId);
  const { networkId, grants, journal, pure } = ports;
  pins(networkId, grants);
  const stored = await journal.read(requestId);
  if (!stored) return undefined;
  const record = Object.freeze({ ...stored });
  if (record.requestId !== requestId || record.networkId !== networkId)
    throw new P256GranteeIssueUnsettled(requestId);
  const parsed = p256GrantOpeningSchema.safeParse(record.opening);
  if (!parsed.success) throw new P256GranteeIssueUnsettled(requestId);
  const { scope, grantId, scopeSalt, slot } = parsed.data;
  const salt = fromHex(scopeSalt);
  const id = pure.derive_grant_id_with_p256(
    { bytes: fromHex(scope.account) },
    p256GranteePoint(scope.grantee.publicKey),
    grantOriginHash(scope.grantee.origin),
    BigInt(slot),
  );
  if (toHex(id) !== grantId) throw new P256GranteeIssueUnsettled(requestId);
  const live = await grants.readP256GrantSpendContext(scope.account, grantId);
  pins(networkId, grants);
  if (
    !live?.active ||
    live.deviceEpoch !== record.deviceEpoch ||
    live.grantEpoch !== record.deviceEpoch ||
    live.generation !== record.grantGeneration ||
    live.grantGeneration !== record.grantGeneration ||
    live.issuedAt !== record.expectedIssuedAt ||
    !matchesP256Scope(live, {
      perCallCap: BigInt(scope.perCallCap),
      cap: BigInt(scope.cap),
      expiresAt: BigInt(scope.expiresAt ?? 0),
      rpCommit: toHex(pure.derive_grant_rp_commit(salt, fromHex(scope.grantee.rpIdHash))),
      objectCommit: toHex(
        pure.derive_grant_object_commit(
          salt,
          fromHex(scope.color),
          1n,
          fromHex(scope.recipient),
          BigInt(scope.maxCoinValue),
        ),
      ),
    })
  )
    return undefined;
  return { ...record, opening: parsed.data };
}

function structuredCloneOwner(owner: AccountHint): AccountHint {
  return {
    address: owner.address,
    scheme: owner.scheme,
    status: owner.status,
    publicKey: { ...owner.publicKey },
    ...(owner.credentialId && { credentialId: Uint8Array.from(owner.credentialId) }),
    ...(owner.policy && {
      policy: {
        origin: Uint8Array.from(owner.policy.origin),
        rp_id_hash: Uint8Array.from(owner.policy.rp_id_hash),
      },
    }),
  };
}
