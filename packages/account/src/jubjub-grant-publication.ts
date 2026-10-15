import type { FlowOptions } from '@input-output-hk/mn-passport-protocol';
import { fromHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { startFlow } from './flow.js';
import {
  grantObjectMatches,
  isPublishableUnshieldedGrant,
  publishedGrantParts,
  validGrantId,
} from './grant-publication-state.js';
import type {
  ActiveGrantSource,
  GrantIssueJournal,
  StagedJubjubGrant,
} from './jubjub-grant-issue.js';
import { JUBJUB_READER_SCAN_LIMIT } from './jubjub-readers.js';
import type {
  AccLedgerView,
  AccountHint,
  AccountRecord,
  AccountRecordStore,
  AccountViewingKey,
  Authoriser,
  Chain,
  CurvePoint,
  JubjubPureCircuits,
} from './ports/index.js';

export interface GrantPublicationJournal extends GrantIssueJournal {
  load(account: string, grantId: string): Promise<StagedJubjubGrant | undefined>;
  /** Called only after both sealed parts are observed in the live ACC inbox. */
  markPublished(account: string, grantId: string): Promise<void>;
}

export interface PublishJubjubGrantInput extends FlowOptions {
  readonly hint: AccountHint;
  readonly grantId: string;
}

export interface PublishJubjubGrantPorts {
  readonly bindingId: 'acc-s3r1.1';
  readonly networkId: string;
  readonly pure: Pick<
    JubjubPureCircuits,
    'derive_device_entry_with_jubjub' | 'challenge_append_inbox_with_jubjub'
  >;
  readonly chain: Chain;
  readonly grants: ActiveGrantSource;
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
}

type InboxSnapshot = AccLedgerView & {
  readonly encKey: Uint8Array;
  readonly inboxEntries: readonly Uint8Array[];
};

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
const samePoint = (a: CurvePoint, b: CurvePoint): boolean => a.x === b.x && a.y === b.y;
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
function requireSnapshot(view: AccLedgerView | undefined): InboxSnapshot {
  if (!view?.booted)
    throw new PassportConnectorError('AccountNotFound', 'The active ACC is missing.');
  if (view.specVersion !== 3)
    throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
  if (view.encKey?.length !== 32 || !view.inboxEntries)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'The ACC inbox and encryption key are required.',
    );
  return view as InboxSnapshot;
}

/** Publish the missing sealed parts of a staged unshielded grant; leave failures staged for recovery. */
export async function publishJubjubGrantBookkeeping(
  input: PublishJubjubGrantInput,
  ports: PublishJubjubGrantPorts,
): Promise<PublishedJubjubGrant> {
  const flow = startFlow(input, ports.random ?? random);
  const wait = ports.sleep ?? sleep;
  const attempts = ports.attempts ?? 30;
  try {
    const { hint, grantId } = input;
    if (
      !validGrantId(grantId) ||
      hint.scheme !== 'jubjub-schnorr' ||
      hint.status !== 'active' ||
      !hint.credentialId
    )
      throw new PassportConnectorError(
        'NotAuthorised',
        'An active JubJub grant and device are required.',
      );
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 120)
      throw new PassportConnectorError('InternalError', 'Invalid grant settlement polling bound.');
    const credentialId = hint.credentialId;
    if (!(await ports.records.exists()))
      throw new PassportConnectorError('AccountNotFound', 'No local account record exists.');
    if (ports.authoriser.scheme !== 'jubjub-schnorr' || !ports.authoriser.withKeySession)
      throw new PassportConnectorError('BindingUnsupported', 'A JubJub key session is required.');
    await flow.step('grant.roster', async () => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        flow.checkpoint();
        if ((await ports.grants.readActiveGrantIds(hint.address)).includes(grantId)) return;
        if (attempt + 1 < attempts) await wait(1000);
      }
      throw new PassportConnectorError(
        'GrantRosterUnsettled',
        'The submitted grant did not appear active on chain.',
      );
    });
    const read = () =>
      ports.chain.readAccount(hint.address, { includeInbox: true, includeDevices: true });
    let view = requireSnapshot(await flow.step('chain.read', read));
    const self = { bytes: fromHex(hint.address) };
    const appendTxHashes: string[] = [];
    const requireActiveGrant = async () => {
      if (!(await ports.grants.readActiveGrantIds(hint.address)).includes(grantId))
        throw new PassportConnectorError('GrantRevoked', 'The grant is no longer active.');
    };
    return await ports.authoriser.withKeySession(
      async () => {
        const record = await ports.records.read();
        if (
          record?.scheme !== 'jubjub-schnorr' ||
          record.address !== hint.address ||
          record.bindingId !== ports.bindingId ||
          !record.credentialId ||
          !sameBytes(credentialId, record.credentialId)
        )
          throw new PassportConnectorError(
            'NotAuthorised',
            'The stored account does not match this device.',
          );
        const staged = await ports.journal.load(hint.address, grantId);
        if (!isPublishableUnshieldedGrant(staged, hint.address, grantId))
          throw new PassportConnectorError(
            'GrantScopeInvalid',
            'No supported staged grant opening exists.',
          );
        const publicKey = await ports.authoriser.devicePublicKey();
        if (!samePoint(publicKey, hint.publicKey))
          throw new PassportConnectorError(
            'NotAuthorised',
            'The selected device does not own this ACC.',
          );
        const open = () =>
          ports.viewingKey.openInbox(
            ports.networkId,
            {
              account: hint.address,
              encKey: view.encKey,
              envelopes: [...view.inboxEntries].reverse(),
            },
            view.inboxEntries,
          );
        let parts = publishedGrantParts(await open(), staged.bookkeeping);
        if (parts.header && parts.object) {
          await requireActiveGrant();
          await ports.journal.markPublished(hint.address, grantId);
          return {
            grantId,
            status: 'active' as const,
            appendTxHashes,
            nextUseCounter: record.localUseCounter,
          };
        }
        const sealed = await ports.viewingKey.sealGrant(
          ports.networkId,
          hint.address,
          staged.bookkeeping,
        );
        if (sealed.length !== 2 || sealed.some((entry) => entry.length !== 192))
          throw new PassportConnectorError(
            'InternalError',
            'Viewing key returned invalid grant seals.',
          );
        const sealedOpened = await ports.viewingKey.openInbox(
          ports.networkId,
          {
            account: hint.address,
            encKey: view.encKey,
            envelopes: [...view.inboxEntries].reverse(),
          },
          sealed,
        );
        if (
          sealedOpened[0]?.kind !== 'grant' ||
          sealedOpened[0].record.part !== 'grant' ||
          sealedOpened[0].record.grantId !== grantId ||
          sealedOpened[0].record.scopeSalt !== staged.bookkeeping.scopeSalt ||
          sealedOpened[1]?.kind !== 'grant' ||
          sealedOpened[1].record.part !== 'object' ||
          sealedOpened[1].record.grantId !== grantId ||
          !grantObjectMatches(sealedOpened[1].record.object, staged.bookkeeping.object)
        )
          throw new PassportConnectorError(
            'InternalError',
            'Viewing key returned unrelated grant seals.',
          );
        for (const [index, part] of ['header', 'object'].entries() as IterableIterator<
          [number, 'header' | 'object']
        >) {
          if (parts[part]) continue;
          flow.checkpoint();
          await requireActiveGrant();
          const entry = sealed[index]!;
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
              'The owner device has no live entry.',
            );
          });
          const signed = await flow.step('passkey.sign', () =>
            ports.authoriser.authorise({
              account: hint.address,
              circuit: 'append_inbox_with_jubjub',
              args: [entry],
              witnessValues: [],
              authNonce: view.authNonce,
              useCounter: counter,
              challenge: (sigR, grindNonce) =>
                ports.pure.challenge_append_inbox_with_jubjub(
                  self,
                  sigR,
                  publicKey,
                  entry,
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
            throw new PassportConnectorError(
              'NotAuthorised',
              'The signature names another device.',
            );
          const nonce = view.authNonce;
          flow.checkpoint();
          const tx = await ports.chain.call({
            address: hint.address,
            circuit: 'append_inbox_with_jubjub',
            args: [entry, publicKey, counter, signed.sigR, signed.sigS, signed.grindNonce],
            ...flow.ports,
          });
          appendTxHashes.push(tx.txHash);
          await ports.records.write({ ...record, localUseCounter: counter + 1n });
          view = await flow.step('chain.read', async () => {
            for (let attempt = 0; attempt < attempts; attempt++) {
              flow.checkpoint();
              const next = requireSnapshot(await read());
              if (
                next.authNonce > nonce &&
                next.inboxEntries.some((item) => sameBytes(item, entry))
              )
                return next;
              if (attempt + 1 < attempts) await wait(1000);
            }
            throw new PassportConnectorError(
              'GrantBookkeepingUnsettled',
              'The accepted grant bookkeeping append did not appear on chain.',
            );
          });
          parts = publishedGrantParts(await open(), staged.bookkeeping);
          if (!parts[part])
            throw new PassportConnectorError(
              'GrantBookkeepingUnsettled',
              'The ACC inbox does not open the appended grant bookkeeping.',
            );
        }
        if (!parts.header || !parts.object)
          throw new PassportConnectorError(
            'GrantBookkeepingUnsettled',
            'The ACC inbox lacks part of the staged grant opening.',
          );
        await requireActiveGrant();
        await ports.journal.markPublished(hint.address, grantId);
        const current: AccountRecord = (await ports.records.read()) ?? record;
        return {
          grantId,
          status: 'active' as const,
          appendTxHashes,
          nextUseCounter: current.localUseCounter,
        };
      },
      { kind: 'issue-grant', grantId },
    );
  } catch (error) {
    throw flow.fail(error);
  }
}
