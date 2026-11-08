import type { FlowOptions } from '@input-output-hk/mn-passport-protocol';
import { PassportConnectorError } from './errors.js';
import { startFlow } from './flow.js';
import type { GrantScopePure } from './grant-scope.js';
import { validGrantId } from './grant-publication-state.js';
import type {
  ActiveGrantSource,
  GrantIssueJournal,
  StagedJubjubGrant,
} from './jubjub-grant-issue.js';
import {
  prepareJubjubPublication,
  selectJubjubPublication,
} from './jubjub-grant-publication-plan.js';
import {
  inspectJubjubPublication,
  publishMissingJubjubBookkeeping,
  publishJubjubReadDelivery,
  finishJubjubPublication,
  finishAppendedJubjubPublication,
} from './jubjub-grant-publication-completion.js';
import type {
  AccountHint,
  AccountRecordStore,
  AccountViewingKey,
  Authoriser,
  Chain,
  GrantCommitmentSource,
  JubjubPureCircuits,
} from './ports/index.js';

export interface GrantPublicationJournal extends GrantIssueJournal {
  load(account: string, grantId: string): Promise<StagedJubjubGrant | undefined>;
  /** Called only after both sealed parts are observed in the live ACC inbox. */
  markPublished(account: string, grantId: string): Promise<void>;
  /** Optional until the host offers crash recovery through `recoverPendingGrants`. */
  pending?(account: string): Promise<readonly string[]>;
}

/** Enumeration lets an owner recover submitted issues after losing its in-memory grant ID. */
export interface GrantRecoveryJournal extends GrantPublicationJournal {
  pending(account: string): Promise<readonly string[]>;
}

export interface RecoverPendingJubjubGrantsPorts extends Omit<PublishJubjubGrantPorts, 'journal'> {
  readonly journal: GrantRecoveryJournal;
}

export interface RecoveredJubjubGrants {
  readonly published: readonly PublishedJubjubGrant[];
  /** Staged openings absent from the current active roster; no new issue is submitted. */
  readonly unsettledGrantIds: readonly string[];
}

/** Publish staged grants present on chain; retain absent openings for later reconciliation. */
export async function recoverPendingJubjubGrants(
  input: { readonly hint: AccountHint } & FlowOptions,
  ports: RecoverPendingJubjubGrantsPorts,
): Promise<RecoveredJubjubGrants> {
  const flow = startFlow(input, ports.random ?? random);
  try {
    const ids = await flow.step('grant.stage', () => ports.journal.pending(input.hint.address));
    if (ids.length > 256 || ids.some((id) => !validGrantId(id)) || new Set(ids).size !== ids.length)
      throw new PassportConnectorError('GrantScopeInvalid', 'Invalid pending grant journal.');
    const active = new Set(
      await flow.step('grant.roster', () => ports.grants.readActiveGrantIds(input.hint.address)),
    );
    const published: PublishedJubjubGrant[] = [];
    const unsettledGrantIds: string[] = [];
    for (const grantId of ids) {
      flow.checkpoint();
      if (!active.has(grantId)) {
        unsettledGrantIds.push(grantId);
        continue;
      }
      published.push(
        await publishJubjubGrantBookkeeping(
          {
            hint: input.hint,
            grantId,
            ...(input.signal && { signal: input.signal }),
            ...(input.onEvent && { onEvent: input.onEvent }),
          },
          ports,
        ),
      );
    }
    return { published, unsettledGrantIds };
  } catch (error) {
    throw flow.fail(error);
  }
}

export interface PublishJubjubGrantInput extends FlowOptions {
  readonly hint: AccountHint;
  readonly grantId: string;
}

export interface PublishJubjubGrantPorts {
  readonly bindingId: 'acc-s3r1.1';
  readonly networkId: string;
  readonly pure: GrantScopePure &
    Pick<
      JubjubPureCircuits,
      'derive_device_entry_with_jubjub' | 'challenge_append_inbox_with_jubjub'
    >;
  readonly chain: Chain;
  readonly grants: ActiveGrantSource;
  readonly commitments: GrantCommitmentSource;
  readonly journal: GrantPublicationJournal;
  readonly viewingKey: AccountViewingKey;
  readonly authoriser: Authoriser;
  readonly records: AccountRecordStore;
  readonly random?: (length: number) => Uint8Array;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly attempts?: number;
}

export interface PublishedJubjubGrant {
  readonly grantId: string;
  readonly status: 'active';
  /** Empty when a retry found both parts already published. */
  readonly appendTxHashes: readonly string[];
  readonly nextUseCounter: bigint;
  /** Current-key seal for an issued read grant, also persisted in the ACC inbox. */
  readonly sealedReadGrant?: {
    readonly grantId: string;
    readonly readPublicKey: string;
    readonly seal: Uint8Array;
    readonly sealedEncKey: string;
  };
}

const random = (length: number): Uint8Array =>
  (
    globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(new Uint8Array(length));
const sleep = (milliseconds: number): Promise<void> =>
  new Promise((done) =>
    (globalThis as unknown as { setTimeout(run: () => void, ms: number): unknown }).setTimeout(
      done,
      milliseconds,
    ),
  );
/** Publish missing grant records and a read seal, leaving failures staged for recovery. */
export async function publishJubjubGrantBookkeeping(
  input: PublishJubjubGrantInput,
  ports: PublishJubjubGrantPorts,
): Promise<PublishedJubjubGrant> {
  const flow = startFlow(input, ports.random ?? random);
  const wait = ports.sleep ?? sleep;
  const attempts = ports.attempts ?? 30;
  try {
    const prepared = await prepareJubjubPublication(input, ports, flow, wait, attempts);
    const { operation, approved } = prepared;
    return await operation.ports.authoriser.withKeySession(
      async () => {
        const selected = await selectJubjubPublication(prepared);
        let progress = await inspectJubjubPublication(selected, prepared.view);
        if (
          progress.parts.header &&
          progress.parts.object &&
          (!selected.staged.scope.read || progress.viewRecord)
        )
          return finishJubjubPublication(selected, progress);
        progress = await publishMissingJubjubBookkeeping(selected, progress);
        progress = await publishJubjubReadDelivery(selected, progress);
        return finishAppendedJubjubPublication(selected, progress);
      },
      {
        kind: 'issue-grant',
        account: operation.hint.address,
        grantId: operation.grantId,
        scope: approved.scope,
        slot: approved.slot,
        scopeSalt: approved.scopeSalt,
        scopeDigest: approved.scopeDigest,
      },
    );
  } catch (error) {
    throw flow.fail(error);
  }
}
