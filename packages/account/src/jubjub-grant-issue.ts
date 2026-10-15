import type { FlowOptions, PassportTxResult } from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { startFlow } from './flow.js';
import {
  prepareJubjubGrant,
  type GrantScopeInput,
  type GrantScopePure,
  type PreparedJubjubGrant,
} from './grant-scope.js';
import { JUBJUB_READER_SCAN_LIMIT } from './jubjub-readers.js';
import type {
  AccountHint,
  AccountRecordStore,
  ActiveGrantSnapshotSource,
  Authoriser,
  Chain,
  CurvePoint,
  GrantBookkeeping,
  JubjubPureCircuits,
} from './ports/index.js';

export interface IssueJubjubGrantPure
  extends GrantScopePure, Pick<JubjubPureCircuits, 'derive_device_entry_with_jubjub'> {
  challenge_issue_grant_with_jubjub(
    account: { readonly bytes: Uint8Array },
    sigR: CurvePoint,
    ownerPublicKey: CurvePoint,
    grantId: Uint8Array,
    scopeDigest: Uint8Array,
    authNonce: bigint,
    grindNonce: bigint,
  ): Uint8Array;
}

export type { ActiveGrantSource, ActiveGrantSnapshotSource } from './ports/index.js';

export interface StagedJubjubGrant {
  readonly account: string;
  readonly origin: string;
  readonly scope: GrantScopeInput;
  readonly bookkeeping: GrantBookkeeping;
  readonly scopeDigest: string;
}

/**
 * Durable write-ahead record. A crash after submission must leave enough information to reconcile
 * the grant and publish its sealed bookkeeping. `stage` must resolve only after durable storage.
 */
export interface GrantIssueJournal {
  stage(grant: StagedJubjubGrant): Promise<void>;
}

export interface IssueJubjubGrantCallInput extends FlowOptions {
  readonly hint: AccountHint;
  readonly origin: string;
  readonly scope: GrantScopeInput;
}

export interface IssueJubjubGrantCallPorts {
  readonly bindingId: 'acc-s3r1.1';
  readonly pure: IssueJubjubGrantPure;
  readonly chain: Chain;
  readonly authoriser: Authoriser;
  readonly records: AccountRecordStore;
  readonly grants: ActiveGrantSnapshotSource;
  readonly journal: GrantIssueJournal;
  readonly random?: (length: number) => Uint8Array;
  readonly nowSeconds?: () => number;
}

/** A submitted issue call. The grant remains pending until a chain-backed roster confirms it. */
export interface SubmittedJubjubGrantCall extends PassportTxResult {
  readonly grantId: string;
  readonly slot: number;
  readonly scopeDigest: string;
  readonly nextUseCounter: bigint;
  readonly status: 'submitted';
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
const samePoint = (a: CurvePoint, b: CurvePoint): boolean => a.x === b.x && a.y === b.y;
const random = (length: number): Uint8Array =>
  (
    globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(new Uint8Array(length));

const bookkeeping = (
  account: string,
  origin: string,
  scope: GrantScopeInput,
  prepared: PreparedJubjubGrant,
): StagedJubjubGrant => ({
  account,
  origin,
  scope,
  scopeDigest: toHex(prepared.scopeDigest),
  bookkeeping: {
    grantId: prepared.grantId,
    slot: prepared.slot,
    scopeSalt: toHex(prepared.scopeSalt),
    granteePublicKey: scope.grantee.publicKey,
    ...(scope.readPublicKey !== undefined && { readPublicKey: scope.readPublicKey }),
    object: {
      color: scope.color,
      recipient: scope.recipient,
      maxCoinValue: scope.maxCoinValue,
    },
  },
});

/**
 * Submit the owner-authorised `issue_grant_with_jubjub` call for an unshielded spend scope.
 * The journal stores its opening before chain submission. This lower-level call does not claim
 * settlement or publish sealed bookkeeping; a later owner flow must reconcile and finish those
 * steps before presenting the grant as active. Read grants need viewing-secret rotation and are
 * deliberately rejected until that full flow exists.
 */
export async function issueJubjubGrantCall(
  input: IssueJubjubGrantCallInput,
  ports: IssueJubjubGrantCallPorts,
): Promise<SubmittedJubjubGrantCall> {
  const flow = startFlow(input, ports.random ?? random);
  try {
    if (
      input.scope.read ||
      input.scope.operations.length !== 1 ||
      input.scope.operations[0] !== 'withdraw-unshielded'
    )
      throw new PassportConnectorError(
        'BindingUnsupported',
        'This call supports only an unshielded spend grant without read access.',
      );
    const { hint } = input;
    if (hint.scheme !== 'jubjub-schnorr' || hint.status !== 'active' || !hint.credentialId)
      throw new PassportConnectorError('NotAuthorised', 'The active JubJub account is required.');
    const credentialId = hint.credentialId;
    if (!(await ports.records.exists()))
      throw new PassportConnectorError(
        'AccountNotFound',
        'No account record is stored on this device.',
      );
    if (ports.authoriser.scheme !== 'jubjub-schnorr' || !ports.authoriser.withKeySession)
      throw new PassportConnectorError('BindingUnsupported', 'A JubJub key session is required.');
    const view = await flow.step('chain.read', () =>
      ports.chain.readAccount(hint.address, { includeDevices: true }),
    );
    if (!view || !view.booted)
      throw new PassportConnectorError('AccountNotFound', 'The active ACC is missing.');
    if (view.specVersion !== 3)
      throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
    const roster = await flow.step('grant.roster', () =>
      ports.grants.readActiveGrantSnapshot(hint.address),
    );
    if (roster.authNonce !== view.authNonce)
      throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster is stale.');
    const activeGrantIds = [...roster.ids];
    const prepared = prepareJubjubGrant(
      {
        account: hint.address,
        origin: input.origin,
        scope: input.scope,
        activeGrantIds,
        nowSeconds: (ports.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))(),
      },
      ports.pure,
      ports.random,
    );
    const self = { bytes: fromHex(hint.address) };
    const grantId = fromHex(prepared.grantId);
    return await ports.authoriser.withKeySession(
      async () => {
        const record = await ports.records.read();
        if (
          record?.scheme !== 'jubjub-schnorr' ||
          hint.address !== record.address ||
          record.bindingId !== ports.bindingId ||
          !record.credentialId ||
          !sameBytes(credentialId, record.credentialId)
        )
          throw new PassportConnectorError(
            'NotAuthorised',
            'The stored account does not match this device.',
          );
        const publicKey = await ports.authoriser.devicePublicKey();
        if (!samePoint(publicKey, hint.publicKey))
          throw new PassportConnectorError(
            'NotAuthorised',
            'The selected device does not own this ACC.',
          );
        const counter = await flow.step('counter.scan', async () => {
          for (let value = 0n; value < JUBJUB_READER_SCAN_LIMIT; value++) {
            const own = ports.pure.derive_device_entry_with_jubjub(
              self,
              publicKey,
              view.deviceEpoch,
              value,
            );
            if (view.hasEntry(own)) return value;
          }
          throw new PassportConnectorError(
            'NotAuthorised',
            'The selected device has no live entry.',
          );
        });
        const circuit = 'issue_grant_with_jubjub';
        const signed = await flow.step('passkey.sign', () =>
          ports.authoriser.authorise({
            account: hint.address,
            circuit,
            args: [grantId, ...prepared.scopeArgs, prepared.scopeSalt],
            witnessValues: [],
            authNonce: view.authNonce,
            useCounter: counter,
            challenge: (sigR, grindNonce) =>
              ports.pure.challenge_issue_grant_with_jubjub(
                self,
                sigR,
                publicKey,
                grantId,
                prepared.scopeDigest,
                view.authNonce,
                grindNonce,
              ),
          }),
        );
        if (
          signed.scheme !== 'jubjub-schnorr' ||
          signed.useCounter !== counter ||
          !samePoint(signed.pk, publicKey)
        )
          throw new PassportConnectorError('NotAuthorised', 'The signature names another device.');
        const latest = await flow.step('grant.roster', () =>
          ports.grants.readActiveGrantSnapshot(hint.address),
        );
        const expectedIds = [...activeGrantIds].sort();
        const currentIds = [...latest.ids].sort();
        if (
          latest.authNonce !== view.authNonce ||
          currentIds.length !== expectedIds.length ||
          currentIds.some((id, index) => id !== expectedIds[index])
        )
          throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster changed.');
        await flow.step('grant.stage', () =>
          ports.journal.stage(bookkeeping(hint.address, input.origin, input.scope, prepared)),
        );
        flow.checkpoint();
        const tx = await ports.chain.call({
          address: hint.address,
          circuit,
          args: [
            grantId,
            ...prepared.scopeArgs,
            prepared.scopeSalt,
            publicKey,
            counter,
            signed.sigR,
            signed.sigS,
            signed.grindNonce,
          ],
          ...flow.ports,
        });
        const nextUseCounter = counter + 1n;
        await ports.records.write({ ...record, localUseCounter: nextUseCounter });
        return {
          ...tx,
          grantId: prepared.grantId,
          slot: prepared.slot,
          scopeDigest: toHex(prepared.scopeDigest),
          nextUseCounter,
          status: 'submitted' as const,
        };
      },
      {
        kind: 'issue-grant',
        account: hint.address,
        grantId: prepared.grantId,
        scope: input.scope,
        scopeSalt: toHex(prepared.scopeSalt),
        scopeDigest: toHex(prepared.scopeDigest),
        slot: prepared.slot,
      },
    );
  } catch (error) {
    throw flow.fail(error);
  }
}
