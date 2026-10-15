import type {
  FlowOptions,
  PassportGrantIssueResult,
  PassportTxResult,
  ViewingKeyRotationResult,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { startFlow } from './flow.js';
import {
  prepareJubjubGrant,
  type GrantScopeInput,
  type GrantScopePure,
  type PreparedJubjubGrant,
} from './grant-scope.js';
import type { GrantIssueJournal, StagedJubjubGrant } from './jubjub-grant-issue.js';
import { SubmittedGrantSettlementError } from './jubjub-grant-settlement.js';
import {
  publishP256GrantBookkeeping,
  type PublishP256GrantPorts,
} from './p256-grant-publication.js';
import type {
  AccountHint,
  AccountRecordStore,
  ActiveGrantSnapshotSource,
  Authoriser,
  Chain,
  P256PublicKey,
  WebAuthnPolicy,
} from './ports/index.js';

export interface IssueP256GrantPure extends GrantScopePure {
  derive_device_entry_with_p256(
    account: { readonly bytes: Uint8Array },
    owner: P256PublicKey,
    policy: WebAuthnPolicy,
    epoch: bigint,
    counter: bigint,
  ): Uint8Array;
  challenge_issue_grant_with_p256(
    account: { readonly bytes: Uint8Array },
    owner: P256PublicKey,
    grantId: Uint8Array,
    scopeDigest: Uint8Array,
    nonce: bigint,
  ): Uint8Array;
}

export interface IssueP256GrantCallInput extends FlowOptions {
  readonly hint: AccountHint;
  readonly origin: string;
  readonly scope: GrantScopeInput;
}

export interface IssueP256GrantCallPorts {
  readonly bindingId: 'acc-s3r1.1';
  readonly pure: IssueP256GrantPure;
  readonly chain: Chain;
  readonly authoriser: Authoriser;
  readonly records: AccountRecordStore;
  readonly grants: ActiveGrantSnapshotSource;
  readonly journal: GrantIssueJournal;
  readonly random?: (length: number) => Uint8Array;
  readonly nowSeconds?: () => number;
  /** Runs in the owner session before a read-capable issue. */
  readonly rotateBeforeIssue?: (
    input: IssueP256GrantCallInput,
  ) => Promise<ViewingKeyRotationResult>;
}

export interface SubmittedP256GrantCall extends PassportTxResult {
  readonly grantId: string;
  readonly slot: number;
  readonly scopeDigest: string;
  readonly nextUseCounter: bigint;
  readonly status: 'submitted';
  readonly rotation?: ViewingKeyRotationResult;
}

const same = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
const p256 = (key: { x: bigint; y: bigint }): P256PublicKey => ({
  x: key.x,
  y: key.y,
  identity: false,
});
const randomDefault = (length: number): Uint8Array =>
  (
    globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(new Uint8Array(length));
const stage = (
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

/** Submit one pinned P-256 issue after durably staging its opening; settlement is separate. */
export async function issueP256GrantCall(
  input: IssueP256GrantCallInput,
  ports: IssueP256GrantCallPorts,
): Promise<SubmittedP256GrantCall> {
  const flow = startFlow(input, ports.random ?? randomDefault);
  try {
    if (
      !input.scope.read &&
      (input.scope.operations.length !== 1 || input.scope.operations[0] !== 'withdraw-unshielded')
    )
      throw new PassportConnectorError(
        'BindingUnsupported',
        'A grant without read access supports only unshielded withdrawal.',
      );
    if (input.scope.read && !ports.rotateBeforeIssue)
      throw new PassportConnectorError('BindingUnsupported', 'Read-grant rotation is unavailable.');
    if (input.scope.read && input.scope.rpId !== input.origin)
      throw new PassportConnectorError(
        'GrantScopeInvalid',
        'The read grant rp id must match the host origin.',
      );
    const { hint } = input;
    if (
      hint.scheme !== 'p256-webauthn' ||
      hint.status !== 'active' ||
      !hint.credentialId ||
      !hint.policy
    )
      throw new PassportConnectorError('NotAuthorised', 'An active P-256 account is required.');
    if (
      ports.authoriser.scheme !== 'p256-webauthn' ||
      !ports.authoriser.withKeySession ||
      !ports.authoriser.deviceBinding
    )
      throw new PassportConnectorError('BindingUnsupported', 'A P-256 key session is required.');
    if (!(await ports.records.exists()))
      throw new PassportConnectorError('AccountNotFound', 'No local account record exists.');
    let view = await flow.step('chain.read', () =>
      ports.chain.readAccount(hint.address, { includeDevices: true, includeInbox: true }),
    );
    if (!view?.booted || view.specVersion !== 3 || !view.encKey || !view.inboxEntries)
      throw new PassportConnectorError('BindingUnsupported', 'A sealed spec-3 ACC is required.');
    const roster = await flow.step('grant.roster', () =>
      ports.grants.readActiveGrantSnapshot(hint.address),
    );
    if (roster.authNonce !== view.authNonce)
      throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster is stale.');
    const activeIds = [...roster.ids];
    const prepared = prepareJubjubGrant(
      {
        account: hint.address,
        origin: input.origin,
        scope: input.scope,
        activeGrantIds: activeIds,
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
        const binding = await ports.authoriser.deviceBinding!();
        const selected = await ports.authoriser.devicePublicKey();
        if (
          record?.scheme !== 'p256-webauthn' ||
          record.address !== hint.address ||
          record.bindingId !== ports.bindingId ||
          !record.credentialId ||
          !same(record.credentialId, hint.credentialId!) ||
          !same(binding.credentialId, hint.credentialId!) ||
          !same(binding.policy.rp_id_hash, hint.policy!.rp_id_hash) ||
          !same(binding.policy.origin, hint.policy!.origin) ||
          selected.x !== hint.publicKey.x ||
          selected.y !== hint.publicKey.y
        )
          throw new PassportConnectorError('NotAuthorised', 'The selected P-256 device differs.');
        let rotation: ViewingKeyRotationResult | undefined;
        if (input.scope.read) {
          rotation = await ports.rotateBeforeIssue!(input);
          if (rotation.unsealedGrantIds.length)
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'A live read grantee was not sealed during rotation.',
            );
          const rotated = await flow.step('chain.read', () =>
            ports.chain.readAccount(hint.address, { includeDevices: true, includeInbox: true }),
          );
          if (!rotated?.booted || rotated.specVersion !== 3 || !rotated.encKey)
            throw new PassportConnectorError('AccountNotFound', 'The rotated ACC is missing.');
          view = rotated;
          const rotatedRoster = await flow.step('grant.roster', () =>
            ports.grants.readActiveGrantSnapshot(hint.address),
          );
          if (
            rotatedRoster.authNonce !== view.authNonce ||
            [...rotatedRoster.ids].sort().join(',') !== [...activeIds].sort().join(',')
          )
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'The grant roster changed during rotation.',
            );
        }
        let counter: bigint | undefined;
        for (let value = 0n; value < 64n; value++) {
          if (
            view!.hasEntry(
              ports.pure.derive_device_entry_with_p256(
                self,
                p256(selected),
                hint.policy!,
                view!.deviceEpoch,
                value,
              ),
            )
          ) {
            counter = value;
            break;
          }
        }
        if (counter === undefined)
          throw new PassportConnectorError('NotAuthorised', 'The owner has no live ACC entry.');
        const nonce = view!.authNonce;
        const signed = await flow.step('passkey.sign', () =>
          ports.authoriser.authorise({
            account: hint.address,
            circuit: 'issue_grant_with_p256',
            args: [grantId, ...prepared.scopeArgs, prepared.scopeSalt],
            witnessValues: [],
            authNonce: nonce,
            useCounter: counter,
            challenge: ports.pure.challenge_issue_grant_with_p256(
              self,
              p256(selected),
              grantId,
              prepared.scopeDigest,
              nonce,
            ),
            credentialId: hint.credentialId!,
          }),
        );
        if (
          signed.scheme !== 'p256-webauthn' ||
          signed.useCounter !== counter ||
          signed.pk.x !== selected.x ||
          signed.pk.y !== selected.y
        )
          throw new PassportConnectorError('NotAuthorised', 'Another device signed the issue.');
        const latest = await flow.step('grant.roster', () =>
          ports.grants.readActiveGrantSnapshot(hint.address),
        );
        if (
          latest.authNonce !== nonce ||
          [...latest.ids].sort().join(',') !== [...activeIds].sort().join(',')
        )
          throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster changed.');
        await flow.step('grant.stage', () =>
          ports.journal.stage(stage(hint.address, input.origin, input.scope, prepared)),
        );
        flow.checkpoint();
        const tx = await ports.chain.call({
          address: hint.address,
          circuit: 'issue_grant_with_p256',
          args: [
            grantId,
            ...prepared.scopeArgs,
            prepared.scopeSalt,
            {
              pk: p256(selected),
              policy: hint.policy!,
              authenticator_data: signed.authenticatorData,
              sig: signed.sig,
              use_counter: counter,
            },
          ],
          ...flow.ports,
        });
        await ports.records.write({ ...record, localUseCounter: counter + 1n });
        return {
          ...tx,
          grantId: prepared.grantId,
          slot: prepared.slot,
          scopeDigest: toHex(prepared.scopeDigest),
          nextUseCounter: counter + 1n,
          status: 'submitted' as const,
          ...(rotation && { rotation }),
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
        ...(input.scope.read && { read: true, devices: view.deviceEntries?.map(toHex) ?? [] }),
      },
    );
  } catch (error) {
    throw flow.fail(error);
  }
}

export type IssueAndPublishP256GrantPorts = IssueP256GrantCallPorts & PublishP256GrantPorts;

/** Return active only after the issue and its sealed bookkeeping have settled. */
export async function issueAndPublishP256Grant(
  input: IssueP256GrantCallInput,
  ports: IssueAndPublishP256GrantPorts,
): Promise<PassportGrantIssueResult> {
  const submitted = await issueP256GrantCall(input, ports);
  let published;
  try {
    published = await publishP256GrantBookkeeping(
      {
        hint: input.hint,
        grantId: submitted.grantId,
        ...(input.signal && { signal: input.signal }),
        ...(input.onEvent && { onEvent: input.onEvent }),
      },
      ports,
    );
  } catch (error) {
    throw new SubmittedGrantSettlementError(error, submitted);
  }
  return {
    txHash: submitted.txHash,
    ...(submitted.blockHeight !== undefined && { blockHeight: submitted.blockHeight }),
    grantId: submitted.grantId,
    slot: submitted.slot,
    scopeDigest: submitted.scopeDigest,
    status: published.status,
    appendTxHashes: published.appendTxHashes,
    nextUseCounter: published.nextUseCounter,
    ...(submitted.rotation && { rotation: submitted.rotation }),
    ...(published.sealedReadGrant && { sealedReadGrant: published.sealedReadGrant }),
  };
}
