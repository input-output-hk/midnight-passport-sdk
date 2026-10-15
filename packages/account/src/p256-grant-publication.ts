import type { FlowOptions } from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { startFlow } from './flow.js';
import {
  grantObjectMatches,
  isPublishableReadGrant,
  isPublishableUnshieldedGrant,
  publishedGrantParts,
  publishedGrantView,
  validGrantId,
} from './grant-publication-state.js';
import type { GrantPublicationJournal, GrantRecoveryJournal } from './jubjub-grant-publication.js';
import type {
  AccLedgerView,
  AccPureCircuits,
  AccountHint,
  AccountRecordStore,
  AccountViewingKey,
  ActiveGrantSource,
  Authoriser,
  Chain,
  P256PublicKey,
} from './ports/index.js';

export interface PublishP256GrantPorts {
  readonly networkId: string;
  readonly bindingId: 'acc-s3r1.1';
  readonly pure: AccPureCircuits & {
    challenge_append_inbox_with_p256: NonNullable<
      AccPureCircuits['challenge_append_inbox_with_p256']
    >;
  };
  readonly chain: Chain;
  readonly grants: ActiveGrantSource;
  readonly journal: GrantPublicationJournal;
  readonly records: AccountRecordStore;
  readonly viewingKey: AccountViewingKey;
  readonly authoriser: Authoriser;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly attempts?: number;
  readonly random?: (length: number) => Uint8Array;
}

export interface PublishedP256Grant {
  readonly grantId: string;
  readonly status: 'active';
  readonly appendTxHashes: readonly string[];
  readonly nextUseCounter: bigint;
  readonly sealedReadGrant?: {
    readonly grantId: string;
    readonly readPublicKey: string;
    readonly seal: Uint8Array;
    readonly sealedEncKey: string;
  };
}

export interface RecoverPendingP256GrantsPorts extends Omit<PublishP256GrantPorts, 'journal'> {
  readonly journal: GrantRecoveryJournal;
}

/** Publish only staged P-256 issues already confirmed in the live ACC grant map. */
export async function recoverPendingP256Grants(
  input: { readonly hint: AccountHint } & FlowOptions,
  ports: RecoverPendingP256GrantsPorts,
): Promise<{
  readonly published: readonly PublishedP256Grant[];
  readonly unsettledGrantIds: readonly string[];
}> {
  const flow = startFlow(input, ports.random ?? randomDefault);
  try {
    const ids = await flow.step('grant.stage', () => ports.journal.pending(input.hint.address));
    if (ids.length > 256 || ids.some((id) => !validGrantId(id)) || new Set(ids).size !== ids.length)
      throw new PassportConnectorError('GrantScopeInvalid', 'Invalid pending grant journal.');
    const active = new Set(
      await flow.step('grant.roster', () => ports.grants.readActiveGrantIds(input.hint.address)),
    );
    const published: PublishedP256Grant[] = [];
    const unsettledGrantIds: string[] = [];
    for (const grantId of ids) {
      flow.checkpoint();
      if (!active.has(grantId)) {
        unsettledGrantIds.push(grantId);
        continue;
      }
      published.push(
        await publishP256GrantBookkeeping(
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

const same = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
const waitDefault = (ms: number): Promise<void> =>
  new Promise((resolve) =>
    (globalThis as unknown as { setTimeout(run: () => void, ms: number): unknown }).setTimeout(
      resolve,
      ms,
    ),
  );
const randomDefault = (length: number): Uint8Array =>
  (
    globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(new Uint8Array(length));
const p256 = (key: { x: bigint; y: bigint }): P256PublicKey => ({
  x: key.x,
  y: key.y,
  identity: false,
});

/** Resume an accepted P-256 issue from its durable opening; do not submit another issue call. */
export async function publishP256GrantBookkeeping(
  input: { readonly hint: AccountHint; readonly grantId: string } & FlowOptions,
  ports: PublishP256GrantPorts,
): Promise<PublishedP256Grant> {
  const flow = startFlow(input, ports.random ?? randomDefault);
  const wait = ports.sleep ?? waitDefault;
  const attempts = ports.attempts ?? 30;
  try {
    const { hint, grantId } = input;
    if (
      !validGrantId(grantId) ||
      hint.scheme !== 'p256-webauthn' ||
      hint.status !== 'active' ||
      !hint.credentialId ||
      !hint.policy
    )
      throw new PassportConnectorError('NotAuthorised', 'An active P-256 account is required.');
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 120)
      throw new PassportConnectorError('InternalError', 'Invalid grant polling bound.');
    if (
      ports.authoriser.scheme !== 'p256-webauthn' ||
      !ports.authoriser.withKeySession ||
      !ports.authoriser.deviceBinding
    )
      throw new PassportConnectorError('BindingUnsupported', 'A P-256 key session is required.');
    const opening = await flow.step('grant.stage', () => ports.journal.load(hint.address, grantId));
    if (
      !isPublishableUnshieldedGrant(opening, hint.address, grantId) &&
      !isPublishableReadGrant(opening, hint.address, grantId)
    )
      throw new PassportConnectorError('GrantScopeInvalid', 'No supported staged opening exists.');
    const approved = canonical(opening);
    for (let attempt = 0; attempt < attempts; attempt++) {
      flow.checkpoint();
      if ((await ports.grants.readActiveGrantIds(hint.address)).includes(grantId)) break;
      if (attempt + 1 === attempts)
        throw new PassportConnectorError(
          'GrantRosterUnsettled',
          'The issue is not active on chain.',
        );
      await wait(1000);
    }
    const read = () =>
      ports.chain.readAccount(hint.address, { includeInbox: true, includeDevices: true });
    const snapshot = async () => {
      const value = await flow.step('chain.read', read);
      if (
        !value?.booted ||
        value.specVersion !== 3 ||
        !value.encKey ||
        !value.inboxEntries ||
        !value.deviceEntries
      )
        throw new PassportConnectorError(
          'BindingUnsupported',
          'The sealed ACC view is incomplete.',
        );
      return value as AccLedgerView & { encKey: Uint8Array; inboxEntries: readonly Uint8Array[] };
    };
    let view = await snapshot();
    const oldKey = view.encKey.slice();
    const self = { bytes: fromHex(hint.address) };
    const appendTxHashes: string[] = [];
    const active = async () => {
      if (!(await ports.grants.readActiveGrantIds(hint.address)).includes(grantId))
        throw new PassportConnectorError('GrantRevoked', 'The grant is no longer active.');
    };
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
        const staged = await flow.step('grant.stage', () =>
          ports.journal.load(hint.address, grantId),
        );
        if (
          (!isPublishableUnshieldedGrant(staged, hint.address, grantId) &&
            !isPublishableReadGrant(staged, hint.address, grantId)) ||
          canonical(staged) !== approved
        )
          throw new PassportConnectorError('GrantScopeInvalid', 'The staged opening changed.');
        const keyring = () => ({
          account: hint.address,
          encKey: view.encKey,
          envelopes: [...view.inboxEntries].reverse(),
        });
        const open = () =>
          ports.viewingKey.openInbox(ports.networkId, keyring(), view.inboxEntries);
        let opened = await open();
        let parts = publishedGrantParts(opened, staged.bookkeeping);
        let viewRecord = staged.scope.read
          ? publishedGrantView(opened, grantId, toHex(view.encKey))
          : undefined;
        const findCounter = () => {
          for (let counter = 0n; counter < 64n; counter++)
            if (
              view.hasEntry(
                ports.pure.derive_device_entry_with_p256(
                  self,
                  p256(selected),
                  hint.policy!,
                  view.deviceEpoch,
                  counter,
                ),
              )
            )
              return counter;
          throw new PassportConnectorError('NotAuthorised', 'The owner has no live ACC entry.');
        };
        const append = async (entry: Uint8Array) => {
          await active();
          const counter = findCounter();
          const nonce = view.authNonce;
          const signed = await flow.step('passkey.sign', () =>
            ports.authoriser.authorise({
              account: hint.address,
              circuit: 'append_inbox_with_p256',
              args: [entry],
              witnessValues: [],
              authNonce: nonce,
              useCounter: counter,
              challenge: ports.pure.challenge_append_inbox_with_p256(
                self,
                p256(selected),
                entry,
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
            throw new PassportConnectorError('NotAuthorised', 'Another device signed the append.');
          flow.checkpoint();
          const tx = await ports.chain.call({
            address: hint.address,
            circuit: 'append_inbox_with_p256',
            args: [
              entry,
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
          appendTxHashes.push(tx.txHash);
          await ports.records.write({ ...record!, localUseCounter: counter + 1n });
          for (let attempt = 0; attempt < attempts; attempt++) {
            flow.checkpoint();
            const next = await snapshot();
            if (!same(next.encKey, oldKey) || next.deviceEpoch !== view.deviceEpoch)
              throw new PassportConnectorError(
                'EncryptionKeyMismatch',
                'The ACC key or device epoch changed during publication.',
              );
            if (next.authNonce > nonce && next.inboxEntries.some((held) => same(held, entry))) {
              view = next;
              return;
            }
            if (attempt + 1 < attempts) await wait(1000);
          }
          throw new PassportConnectorError(
            'GrantBookkeepingUnsettled',
            'The accepted inbox entry did not settle.',
          );
        };
        if (!parts.header || !parts.object) {
          const sealed = await ports.viewingKey.sealGrant(
            ports.networkId,
            hint.address,
            staged.bookkeeping,
          );
          if (sealed.length !== 2 || sealed.some((entry) => entry.length !== 192))
            throw new PassportConnectorError('InternalError', 'Invalid grant bookkeeping seals.');
          const decoded = await ports.viewingKey.openInbox(ports.networkId, keyring(), sealed);
          if (
            decoded[0]?.kind !== 'grant' ||
            decoded[0].record.part !== 'grant' ||
            decoded[0].record.grantId !== grantId ||
            decoded[0].record.scopeSalt !== staged.bookkeeping.scopeSalt ||
            decoded[1]?.kind !== 'grant' ||
            decoded[1].record.part !== 'object' ||
            decoded[1].record.grantId !== grantId ||
            !grantObjectMatches(decoded[1].record.object, staged.bookkeeping.object)
          )
            throw new PassportConnectorError('InternalError', 'Unrelated grant bookkeeping seals.');
          for (const [index, part] of ['header', 'object'].entries() as IterableIterator<
            [number, 'header' | 'object']
          >) {
            if (parts[part]) continue;
            await append(sealed[index]!);
            opened = await open();
            parts = publishedGrantParts(opened, staged.bookkeeping);
            if (!parts[part])
              throw new PassportConnectorError(
                'GrantBookkeepingUnsettled',
                'The appended grant bookkeeping did not open.',
              );
          }
        }
        if (staged.scope.read && !viewRecord) {
          if (!ports.viewingKey.sealView)
            throw new PassportConnectorError('BindingUnsupported', 'Read sealing is unavailable.');
          const delivery = await ports.viewingKey.sealView(ports.networkId, keyring(), {
            grantId,
            account: hint.address,
            readPublicKey: staged.bookkeeping.readPublicKey!,
          });
          if (delivery.seal.length !== 94 || delivery.entry.length !== 192)
            throw new PassportConnectorError('InternalError', 'Invalid read-grant seal.');
          const decoded = await ports.viewingKey.openInbox(ports.networkId, keyring(), [
            delivery.entry,
          ]);
          if (
            decoded[0]?.kind !== 'grant' ||
            decoded[0].record.part !== 'view' ||
            decoded[0].record.grantId !== grantId ||
            decoded[0].record.encKeyPrefix !== toHex(view.encKey).slice(0, 6) ||
            decoded[0].record.seal !== toHex(delivery.seal)
          )
            throw new PassportConnectorError('InternalError', 'Unrelated read-grant seal.');
          await append(delivery.entry);
          viewRecord = publishedGrantView(await open(), grantId, toHex(view.encKey));
          if (!viewRecord || viewRecord.seal !== toHex(delivery.seal))
            throw new PassportConnectorError(
              'GrantBookkeepingUnsettled',
              'The appended read seal did not open.',
            );
        }
        await active();
        await ports.journal.markPublished(hint.address, grantId);
        return {
          grantId,
          status: 'active',
          appendTxHashes,
          nextUseCounter: findCounter(),
          ...(viewRecord && {
            sealedReadGrant: {
              grantId,
              readPublicKey: staged.bookkeeping.readPublicKey!,
              seal: fromHex(viewRecord.seal),
              sealedEncKey: toHex(view.encKey),
            },
          }),
        };
      },
      {
        kind: 'issue-grant',
        account: hint.address,
        grantId,
        scope: opening.scope,
        slot: opening.bookkeeping.slot,
        scopeSalt: opening.bookkeeping.scopeSalt,
        scopeDigest: opening.scopeDigest,
      },
    );
  } catch (error) {
    throw flow.fail(error);
  }
}
