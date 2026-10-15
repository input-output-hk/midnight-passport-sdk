import {
  PASSPORT_API_VERSION,
  type DeviceEnrollmentResult,
  type FlowOptions,
  type DeviceRemovalResult,
  type JubjubDeviceReader,
  type PassportAccount,
  type PassportConnectorAPI,
  type ViewingKeyRotationResult,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { startFlow, type Flow } from './flow.js';
import { readVerifiedHoldings } from './holdings.js';
import { issueAndPublishJubjubGrant } from './jubjub-grant-settlement.js';
import type { IssueJubjubGrantPure } from './jubjub-grant-issue.js';
import { revokeAndConfirmJubjubGrant } from './jubjub-grant-revoke.js';
import type { RevokeJubjubGrantPure } from './jubjub-grant-revoke.js';
import { JUBJUB_READER_SCAN_LIMIT, resolveJubjubReaders } from './jubjub-readers.js';
import { sealActiveReadGrants } from './read-grant-deliveries.js';
import type {
  AccLedgerView,
  AccountHint,
  ActiveReadGrantTarget,
  Authoriser,
  CurvePoint,
  JubjubPureCircuits,
  PassportPorts,
} from './ports/index.js';

const RETRIES = 30;
const equal = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);
const samePoint = (a: CurvePoint, b: CurvePoint): boolean => a.x === b.x && a.y === b.y;
const conflictsWithReader = (registered: JubjubDeviceReader, joining: JubjubDeviceReader) =>
  (registered.readerPublicKey === joining.readerPublicKey ||
    registered.devicePublicKey === joining.devicePublicKey) &&
  (registered.readerPublicKey !== joining.readerPublicKey ||
    registered.devicePublicKey !== joining.devicePublicKey);
const random = (length: number) =>
  (
    globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(new Uint8Array(length));
const sleep = (ms: number) =>
  new Promise<void>((done) =>
    (globalThis as unknown as { setTimeout(run: () => void, ms: number): unknown }).setTimeout(
      done,
      ms,
    ),
  );

type JubjubHint = AccountHint & {
  readonly scheme: 'jubjub-schnorr';
  readonly credentialId: Uint8Array;
  readonly salt: Uint8Array;
  readonly keyEntries: readonly Uint8Array[];
};

type EnrollmentContext = {
  readonly reader: JubjubDeviceReader;
  readonly entry: Uint8Array;
  readonly initial: AccLedgerView;
  readonly grants: readonly ActiveReadGrantTarget[];
};

function isJubjubHint(hint: AccountHint): hint is JubjubHint {
  return (
    hint.scheme === 'jubjub-schnorr' &&
    hint.credentialId instanceof Uint8Array &&
    hint.salt?.length === 32 &&
    Array.isArray(hint.keyEntries) &&
    hint.keyEntries.length === 2 &&
    hint.keyEntries[0]?.length === 192 &&
    hint.keyEntries[0][0] === 0xd1 &&
    hint.keyEntries[0][1] === 1 &&
    hint.keyEntries[1]?.length === 192 &&
    hint.keyEntries[1][0] === 0xd2 &&
    hint.keyEntries[1][1] === 1
  );
}

function requirePure(value: unknown): JubjubPureCircuits {
  const pure = value as Partial<JubjubPureCircuits>;
  for (const name of [
    'derive_boot_commitment_with_jubjub',
    'derive_device_entry_with_jubjub',
    'challenge_append_inbox_with_jubjub',
    'challenge_rotate_enc_key_with_jubjub',
    'challenge_remove_device_with_jubjub',
    'challenge_add_device_with_jubjub',
  ] as const) {
    if (typeof pure[name] !== 'function')
      throw new PassportConnectorError('BindingUnsupported', `ACC binding lacks ${name}.`);
  }
  return pure as JubjubPureCircuits;
}

function requireGrantPure(value: unknown): IssueJubjubGrantPure & JubjubPureCircuits {
  const pure = requirePure(value) as Partial<IssueJubjubGrantPure>;
  for (const name of [
    'derive_grant_id_with_jubjub',
    'derive_grant_object_commit',
    'derive_grant_scope_digest',
    'challenge_issue_grant_with_jubjub',
  ] as const) {
    if (typeof pure[name] !== 'function')
      throw new PassportConnectorError('BindingUnsupported', `ACC binding lacks ${name}.`);
  }
  return pure as IssueJubjubGrantPure & JubjubPureCircuits;
}

function requireRevokePure(value: unknown): RevokeJubjubGrantPure {
  const pure = requirePure(value) as Partial<RevokeJubjubGrantPure>;
  if (typeof pure.challenge_revoke_grant_with_jubjub !== 'function')
    throw new PassportConnectorError(
      'BindingUnsupported',
      'ACC binding lacks challenge_revoke_grant_with_jubjub.',
    );
  return pure as RevokeJubjubGrantPure;
}

/** The JubJub owner path over the same account API. All key material stays behind viewingKey. */
export function createJubjubAccounts(ports: PassportPorts): PassportConnectorAPI {
  const { authoriser, credentials, directory, viewingKey, network } = ports;
  if (!directory || !viewingKey || !authoriser.withKeySession || !authoriser.devicePublicKeyHex)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'JubJub accounts need a directory, viewing key, and session-capable authoriser.',
    );
  const { networkId } = network;
  const readBinding = async () =>
    typeof ports.binding === 'function' ? ports.binding() : ports.binding;
  const readChain = async () => (typeof ports.chain === 'function' ? ports.chain() : ports.chain);
  const fresh = ports.random ?? random;
  const run = async <T>(
    options: FlowOptions,
    body: (flow: Flow) => Promise<T>,
    onProgress?: Parameters<typeof startFlow>[2],
  ): Promise<T> => {
    const flow = startFlow(options, fresh, onProgress);
    try {
      return await body(flow);
    } catch (error) {
      throw flow.fail(error);
    }
  };
  const read = async (record: JubjubHint, includeDevices = false): Promise<AccLedgerView> => {
    const view = await (
      await readChain()
    ).readAccount(record.address, {
      includeInbox: true,
      ...(includeDevices && { includeDevices: true }),
    });
    if (!view) throw new PassportConnectorError('AccountNotFound', `No ACC at ${record.address}.`);
    if (!view.encKey || !view.inboxEntries)
      throw new PassportConnectorError('BindingUnsupported', 'The chain port omits the ACC inbox.');
    if (includeDevices && !view.deviceEntries)
      throw new PassportConnectorError('BindingUnsupported', 'The chain port omits live devices.');
    return view;
  };
  const awaitDeployed = async (record: JubjubHint): Promise<AccLedgerView> => {
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const view = await (await readChain()).readAccount(record.address, { includeInbox: true });
      if (view?.encKey && view.inboxEntries) return view;
      await sleep(1000);
    }
    throw new PassportConnectorError(
      'AccountNotFound',
      'The deployed ACC did not appear on chain.',
    );
  };
  const findCounter = (record: JubjubHint, view: AccLedgerView): bigint | undefined => {
    const pure = recordPure.get(record);
    if (!pure) throw new PassportConnectorError('InternalError', 'No pinned binding for account.');
    const self = { bytes: fromHex(record.address) };
    for (let counter = 0n; counter < JUBJUB_READER_SCAN_LIMIT; counter++) {
      if (
        view.hasEntry(
          pure.derive_device_entry_with_jubjub(self, record.publicKey, view.deviceEpoch, counter),
        )
      )
        return counter;
    }
    return undefined;
  };
  const recordPure = new WeakMap<JubjubHint, JubjubPureCircuits>();
  const keyring = async (record: JubjubHint, view: AccLedgerView, pending: boolean) => {
    const reader = await viewingKey.readerPublicKey(networkId);
    if (reader.length !== 32)
      throw new PassportConnectorError('InternalError', 'Invalid reader key.');
    const entries = pending
      ? [...view.inboxEntries!, ...record.keyEntries]
      : [...view.inboxEntries!];
    try {
      const opened = await viewingKey.openInbox(
        networkId,
        { account: record.address, encKey: view.encKey!, envelopes: entries.reverse() },
        pending ? record.keyEntries : [],
      );
      if (pending) {
        const device = opened[1];
        if (
          device?.kind !== 'device' ||
          device.device.readerPublicKey !== toHex(reader) ||
          device.device.devicePublicKey !== (await authoriser.devicePublicKeyHex!())
        )
          throw new Error('the sealed registration does not name this device');
      }
    } catch (error) {
      throw new PassportConnectorError(
        'EncryptionKeyMismatch',
        'No sealed envelope for this passkey opens the ACC encryption key.',
        { cause: error },
      );
    }
  };
  const advanced = async (record: JubjubHint, nonce: bigint): Promise<AccLedgerView> => {
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const view = await read(record);
      if (view.authNonce > nonce) return view;
      await sleep(1000);
    }
    throw new PassportConnectorError('InternalError', 'The ACC call did not appear in the ledger.');
  };
  const awaitBooted = async (record: JubjubHint): Promise<AccLedgerView> => {
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const view = await read(record);
      if (view.booted) return view;
      await sleep(1000);
    }
    throw new PassportConnectorError(
      'InternalError',
      'ACC activation did not appear in the ledger.',
    );
  };
  const append = async (flow: Flow, record: JubjubHint, entry: Uint8Array, view: AccLedgerView) => {
    const pure = recordPure.get(record)!;
    const counter = findCounter(record, view);
    if (counter === undefined)
      throw new PassportConnectorError('AccountNotFound', 'This device has no live ACC entry.');
    const self = { bytes: fromHex(record.address) };
    const circuit = 'append_inbox_with_jubjub';
    const signed = await flow.step('passkey.sign', () =>
      authoriser.authorise({
        account: record.address,
        circuit,
        args: [entry],
        witnessValues: [],
        authNonce: view.authNonce,
        useCounter: counter,
        challenge: (sigR, grindNonce) =>
          pure.challenge_append_inbox_with_jubjub(
            self,
            sigR,
            record.publicKey,
            entry,
            view.authNonce,
            grindNonce,
          ),
      }),
    );
    if (
      signed.scheme !== 'jubjub-schnorr' ||
      signed.useCounter !== counter ||
      !samePoint(signed.pk, record.publicKey)
    )
      throw new PassportConnectorError('NotAuthorised', 'The signature names another device.');
    flow.checkpoint();
    await (
      await readChain()
    ).call({
      address: record.address,
      circuit,
      args: [entry, record.publicKey, counter, signed.sigR, signed.sigS, signed.grindNonce],
      ...flow.ports,
    });
    return advanced(record, view.authNonce);
  };
  const finish = async (flow: Flow, record: JubjubHint, view: AccLedgerView) => {
    const pure = requirePure((await readBinding()).pureCircuits);
    recordPure.set(record, pure);
    const pending = record.status === 'deployed';
    await keyring(record, view, pending);
    if (!view.booted) {
      if (!pending)
        throw new PassportConnectorError('AccountNotFound', 'The active ACC is not booted.');
      await flow.step('activate', async () =>
        (await readChain()).call({
          address: record.address,
          circuit: 'activate_initial_device_with_jubjub',
          args: [record.publicKey, record.salt],
          ...flow.ports,
        }),
      );
      view = await awaitBooted(record);
    }
    if (findCounter(record, view) === undefined)
      throw new PassportConnectorError('AccountNotFound', 'This passkey has no live ACC entry.');
    if (pending) {
      for (const entry of record.keyEntries) {
        if (view.inboxEntries!.some((held) => equal(held, entry))) continue;
        view = await append(flow, record, entry, view);
      }
    }
    await keyring(record, view, false);
    const active: JubjubHint = { ...record, status: 'active' };
    recordPure.set(active, pure);
    if (pending)
      await flow.step('directory.write', () => directory.put(networkId, active), 'always');
    return account(active);
  };
  /** Deliver from the live keyring, then enroll the reader through a separate gated call. */
  const completeEnrollment = async (
    flow: Flow,
    record: JubjubHint,
    pure: JubjubPureCircuits,
    view: AccLedgerView,
    reader: JubjubDeviceReader,
    entry: Uint8Array,
    expectedGrants: readonly ActiveReadGrantTarget[],
  ): Promise<DeviceEnrollmentResult> => {
    const ownerKey = await authoriser.devicePublicKey();
    if (!samePoint(ownerKey, record.publicKey) || findCounter(record, view) === undefined)
      throw new PassportConnectorError('NotAuthorised', 'This device no longer owns the ACC.');
    if (reader.readerPublicKey === toHex(await viewingKey.readerPublicKey(networkId)))
      throw new PassportConnectorError('DeviceRosterInvalid', 'The joining reader is the owner.');
    await keyring(record, view, false);
    const currentKeyring = {
      account: record.address,
      encKey: view.encKey!,
      envelopes: [...view.inboxEntries!].reverse(),
    };
    const opened = await viewingKey.openInbox(networkId, currentKeyring, view.inboxEntries!);
    if (opened.some((item) => item?.kind === 'device' && conflictsWithReader(item.device, reader)))
      throw new PassportConnectorError(
        'DeviceRosterInvalid',
        'The joining reader or signing key already has a roster registration.',
      );
    if (
      opened.some(
        (item) =>
          item?.kind === 'device' &&
          item.device.readerPublicKey === reader.readerPublicKey &&
          item.device.devicePublicKey === reader.devicePublicKey,
      )
    ) {
      const point = viewingKey.decodeDevicePublicKey?.(reader.devicePublicKey);
      if (!point)
        throw new PassportConnectorError(
          'DeviceRosterInvalid',
          'The joining device key is invalid.',
        );
      const self = { bytes: fromHex(record.address) };
      for (let counter = 0n; counter < JUBJUB_READER_SCAN_LIMIT; counter++) {
        if (
          view.hasEntry(
            pure.derive_device_entry_with_jubjub(self, point, view.deviceEpoch, counter),
          )
        )
          throw new PassportConnectorError(
            'DeviceRosterInvalid',
            'The joining device already has a live entry.',
          );
      }
    }
    const epoch = view.deviceEpoch;
    const delivery = await viewingKey.sealToDevice(networkId, currentKeyring, {
      ...reader,
      epoch,
      counter: 0n,
    });
    view = await append(flow, record, delivery.envelope, view);
    view = await append(flow, record, delivery.registration, view);
    view = await read(record, true);
    if (
      !equal(view.encKey!, currentKeyring.encKey) ||
      view.deviceEpoch !== epoch ||
      ![delivery.envelope, delivery.registration].every((sealed) =>
        view.inboxEntries!.some((held) => equal(held, sealed)),
      )
    )
      throw new PassportConnectorError('EncryptionKeyMismatch', 'The key delivery did not settle.');
    if (view.deviceEntries!.some((held) => equal(held, entry)))
      throw new PassportConnectorError('DeviceRosterInvalid', 'The joining device became live.');
    const latestGrants = await flow.step('grant.roster', () =>
      ports.readGrants!.readActiveReadGrantTargets(record.address),
    );
    const grantIds = (items: readonly ActiveReadGrantTarget[]) =>
      items.map(({ grantId, readPublicKey }) => `${grantId}:${readPublicKey ?? ''}`).sort();
    if (
      latestGrants.authNonce !== view.authNonce ||
      JSON.stringify(grantIds(latestGrants.targets)) !== JSON.stringify(grantIds(expectedGrants))
    )
      throw new PassportConnectorError('GrantRosterUnsettled', 'The read-grant roster changed.');
    const counter = findCounter(record, view);
    if (counter === undefined)
      throw new PassportConnectorError('NotAuthorised', 'This device is no longer live.');
    const self = { bytes: fromHex(record.address) };
    const signed = await flow.step('passkey.sign', () =>
      authoriser.authorise({
        account: record.address,
        circuit: 'add_device_with_jubjub',
        args: [entry],
        witnessValues: [],
        authNonce: view.authNonce,
        useCounter: counter,
        challenge: (sigR, grindNonce) =>
          pure.challenge_add_device_with_jubjub(
            self,
            sigR,
            record.publicKey,
            entry,
            view.authNonce,
            grindNonce,
          ),
      }),
    );
    if (
      signed.scheme !== 'jubjub-schnorr' ||
      signed.useCounter !== counter ||
      !samePoint(signed.pk, record.publicKey)
    )
      throw new PassportConnectorError('NotAuthorised', 'The signature names another device.');
    flow.checkpoint();
    const tx = await (
      await readChain()
    ).call({
      address: record.address,
      circuit: 'add_device_with_jubjub',
      args: [entry, record.publicKey, counter, signed.sigR, signed.sigS, signed.grindNonce],
      ...flow.ports,
    });
    await advanced(record, view.authNonce);
    const settled = await read(record, true);
    if (!settled.deviceEntries!.some((held) => equal(held, entry)))
      throw new PassportConnectorError('DeviceRosterInvalid', 'The enrollment did not land.');
    return { ...tx, commitmentHex: toHex(entry), nextUseCounter: counter + 1n };
  };
  const addDevice = (record: JubjubHint, input: JubjubDeviceReader, options: FlowOptions = {}) =>
    run(options, async (flow): Promise<DeviceEnrollmentResult> => {
      const decode = viewingKey.decodeDevicePublicKey;
      if (!decode || !ports.readGrants)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'JubJub enrollment needs a reader decoder and a complete chain-backed read-grant source.',
        );
      const reader = { ...input };
      if (
        !/^[0-9a-f]{64}$/.test(reader.readerPublicKey) ||
        !/^[0-9a-f]{64}$/.test(reader.devicePublicKey)
      )
        throw new PassportConnectorError('DeviceRosterInvalid', 'The joining keys are malformed.');
      const joiningKey = decode(reader.devicePublicKey);
      if (!joiningKey || samePoint(joiningKey, record.publicKey))
        throw new PassportConnectorError(
          'DeviceRosterInvalid',
          'The joining key must identify another valid device.',
        );
      const pure = requirePure((await readBinding()).pureCircuits);
      recordPure.set(record, pure);
      const initial = await flow.step('chain.read', () => read(record, true));
      if (!initial.booted || record.status !== 'active')
        throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
      if (initial.specVersion !== 3)
        throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
      if (findCounter(record, initial) === undefined)
        throw new PassportConnectorError('NotAuthorised', 'This device has no live ACC entry.');
      const self = { bytes: fromHex(record.address) };
      const entry = pure.derive_device_entry_with_jubjub(self, joiningKey, initial.deviceEpoch, 0n);
      if (entry.length !== 32)
        throw new PassportConnectorError('InternalError', 'The binding returned an invalid entry.');
      if (initial.deviceEntries!.some((held) => equal(held, entry)))
        throw new PassportConnectorError(
          'DeviceRosterInvalid',
          'The joining device is already live.',
        );
      const grants = await flow.step('grant.roster', () =>
        ports.readGrants!.readActiveReadGrantTargets(record.address),
      );
      if (grants.authNonce !== initial.authNonce)
        throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster is stale.');
      if (grants.targets.length)
        return rotateViewingKey(
          record,
          options,
          undefined,
          { reader, entry, initial, grants: grants.targets },
          flow,
        ) as Promise<DeviceEnrollmentResult>;
      return authoriser.withKeySession!(
        async () => {
          let view = await flow.step('chain.read', () => read(record, true));
          if (view.authNonce !== initial.authNonce || view.deviceEpoch !== initial.deviceEpoch)
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The ACC changed before enrollment.',
            );
          if (!equal(view.encKey!, initial.encKey!))
            throw new PassportConnectorError('EncryptionKeyMismatch', 'The ACC key changed.');
          if (view.deviceEntries!.some((held) => equal(held, entry)))
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The joining device is already live.',
            );
          return completeEnrollment(flow, record, pure, view, reader, entry, []);
        },
        { kind: 'add-device', account: record.address, commitmentHex: toHex(entry), reader },
      );
    });
  const rotateViewingKey = (
    record: JubjubHint,
    options: FlowOptions = {},
    removal?: string,
    enrollment?: EnrollmentContext,
    existingFlow?: Flow,
  ) => {
    const body = async (flow: Flow) => {
      const holdings = ports.holdings;
      const reencrypt = viewingKey.reencryptInbox;
      const decode = viewingKey.decodeDevicePublicKey;
      if (!holdings || !reencrypt || !decode || !ports.readGrants)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'JubJub rotation needs verified holdings, an active read-grant source and the full viewing-key port.',
        );
      const pure = requirePure((await readBinding()).pureCircuits);
      recordPure.set(record, pure);
      if (removal !== undefined && !/^[0-9a-f]{64}$/i.test(removal))
        throw new PassportConnectorError(
          'RemovalTargetNotFound',
          'The target must be a 32-byte device commitment.',
        );
      const target = removal === undefined ? undefined : fromHex(removal.toLowerCase());
      const initial =
        enrollment?.initial ??
        (target ? await flow.step('chain.read', () => read(record, true)) : undefined);
      if (initial) {
        if (!initial.booted || record.status !== 'active')
          throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
        if (initial.specVersion !== 3)
          throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
        const ownCounter = findCounter(record, initial);
        if (ownCounter === undefined)
          throw new PassportConnectorError('NotAuthorised', 'This device has no live ACC entry.');
        const ownEntry = pure.derive_device_entry_with_jubjub(
          { bytes: fromHex(record.address) },
          record.publicKey,
          initial.deviceEpoch,
          ownCounter,
        );
        if (target) {
          if (equal(target, ownEntry))
            throw new PassportConnectorError('LastDevice', 'A device cannot remove itself.');
          if (!initial.deviceEntries!.some((entry) => equal(entry, target)))
            throw new PassportConnectorError(
              'RemovalTargetNotFound',
              'The target is absent from the live ACC device set.',
            );
        }
      }
      return authoriser.withKeySession!(
        async () => {
          let view = await flow.step('chain.read', () => read(record, true));
          if (!view.booted || record.status !== 'active')
            throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
          if (view.specVersion !== 3)
            throw new PassportConnectorError(
              'BindingUnsupported',
              'The ACC spec version is not 3.',
            );
          const ownCounter = findCounter(record, view);
          if (ownCounter === undefined)
            throw new PassportConnectorError(
              'AccountNotFound',
              'This device is not live on the ACC.',
            );
          await keyring(record, view, false);
          const oldEntries = [...view.inboxEntries!];
          const oldKeyring = {
            account: record.address,
            encKey: view.encKey!,
            envelopes: [...oldEntries].reverse(),
          };
          const opened = await viewingKey.openInbox(networkId, oldKeyring, oldEntries);
          if (opened.length !== oldEntries.length)
            throw new PassportConnectorError(
              'InternalError',
              'The viewing key skipped inbox entries.',
            );
          const liveEntries = view.deviceEntries!;
          const self = { bytes: fromHex(record.address) };
          const ownEntry = pure.derive_device_entry_with_jubjub(
            self,
            record.publicKey,
            view.deviceEpoch,
            ownCounter,
          );
          if (!liveEntries.some((entry) => equal(entry, ownEntry)))
            throw new PassportConnectorError(
              'InternalError',
              'The ledger device set is inconsistent.',
            );
          if (target || enrollment) {
            if (
              view.authNonce !== initial!.authNonce ||
              view.deviceEpoch !== initial!.deviceEpoch ||
              !equal(view.encKey!, initial!.encKey!)
            )
              throw new PassportConnectorError(
                'DeviceRosterInvalid',
                'The ACC changed after the device flow was approved.',
              );
          }
          if (target && !liveEntries.some((entry) => equal(entry, target)))
            throw new PassportConnectorError(
              'RemovalTargetNotFound',
              'The target is absent from the live ACC device set.',
            );
          if (enrollment && liveEntries.some((entry) => equal(entry, enrollment.entry)))
            throw new PassportConnectorError('DeviceRosterInvalid', 'The joining device is live.');
          const reader = toHex(await viewingKey.readerPublicKey(networkId));
          const device = await authoriser.devicePublicKeyHex!();
          const roster = resolveJubjubReaders({
            account: record.address,
            epoch: view.deviceEpoch,
            registered: opened.flatMap((entry) => (entry?.kind === 'device' ? [entry.device] : [])),
            liveEntries,
            ...(target && {
              allowedEntries: liveEntries.filter((entry) => !equal(entry, target)),
            }),
            pure,
            decodeDevicePublicKey: decode,
          });
          if (
            enrollment &&
            opened.some(
              (item) =>
                item?.kind === 'device' && conflictsWithReader(item.device, enrollment.reader),
            )
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The joining reader or signing key already has a roster registration.',
            );
          if (
            enrollment &&
            roster.readers.some(
              (item) =>
                item.readerPublicKey === enrollment.reader.readerPublicKey &&
                item.devicePublicKey === enrollment.reader.devicePublicKey,
            )
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The joining device already has a live entry.',
            );
          if (enrollment && roster.dropped.some((entry) => !equal(entry, ownEntry)))
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'A live device has no unique, usable reader registration.',
            );
          if (target && roster.dropped.some((entry) => !equal(entry, ownEntry)))
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'A surviving device has no unique, usable reader registration.',
            );
          if (
            target &&
            roster.outside.some((removed) =>
              roster.readers.some(
                (survivor) =>
                  survivor.readerPublicKey === removed.readerPublicKey ||
                  survivor.devicePublicKey === removed.devicePublicKey,
              ),
            )
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The removed device shares a reader or signing key with a survivor.',
            );
          const held = await holdings.selectHeldEntries(record.address, oldEntries, opened);
          const seen = new Set<number>();
          const holdingEntries: Uint8Array[] = [];
          for (const index of held) {
            if (
              !Number.isSafeInteger(index) ||
              index < 0 ||
              index >= oldEntries.length ||
              seen.has(index) ||
              opened[index]?.kind !== 'coin'
            )
              throw new PassportConnectorError('InternalError', 'Invalid verified holding index.');
            seen.add(index);
            holdingEntries.push(oldEntries[index]!);
          }
          const registrations = oldEntries.filter(
            (entry) => entry.length === 192 && entry[0] === 0xd2 && entry[1] === 1,
          );
          const removedReader = target ? roster.outside[0] : undefined;
          const keys = await viewingKey.createKeys(networkId, {
            devicePublicKey: device,
            keyring: oldKeyring,
            registrations,
            readers: roster.readers.filter((item) => item.readerPublicKey !== reader),
            ...((target || enrollment) && { rotateRoster: true }),
            ...(removedReader && {
              removed: {
                devicePublicKey: removedReader.devicePublicKey,
                epoch: removedReader.epoch,
                counter: removedReader.counter,
              },
            }),
          });
          const reencrypted = await reencrypt(
            networkId,
            { keyring: oldKeyring, to: keys.encKey },
            holdingEntries,
          );
          if (
            reencrypted.length !== holdingEntries.length ||
            reencrypted.some((entry) => !(entry instanceof Uint8Array))
          )
            throw new PassportConnectorError(
              'InternalError',
              'A verified holding could not be sealed.',
            );
          const deliveries = await sealActiveReadGrants(
            {
              networkId,
              keyring: {
                account: record.address,
                encKey: keys.encKey,
                envelopes: keys.envelopes,
              },
              authNonce: view.authNonce,
              ...flow.ports,
            },
            { targets: ports.readGrants!, viewingKey, random: fresh },
          );
          if (enrollment) {
            const ordered = (items: readonly ActiveReadGrantTarget[]) =>
              items.map(({ grantId, readPublicKey }) => `${grantId}:${readPublicKey ?? ''}`).sort();
            if (
              deliveries.unsealedGrantIds.length ||
              JSON.stringify(ordered(deliveries.targets)) !==
                JSON.stringify(ordered(enrollment.grants))
            )
              throw new PassportConnectorError(
                'GrantRosterUnsettled',
                'Enrollment cannot preserve every active read grant.',
              );
          }
          const deliveryEntries = deliveries.sealed.map(({ entry }) => entry);
          for (const entry of [...keys.envelopes, ...keys.registrations, ...deliveryEntries])
            view = await append(flow, record, entry, view);
          view = await read(record, true);
          if (!equal(view.encKey!, oldKeyring.encKey))
            throw new PassportConnectorError(
              'EncryptionKeyMismatch',
              'The ACC key changed during rotation.',
            );
          const counter = findCounter(record, view);
          if (counter === undefined)
            throw new PassportConnectorError('AccountNotFound', 'This device is no longer live.');
          const latestOwnEntry = pure.derive_device_entry_with_jubjub(
            self,
            record.publicKey,
            view.deviceEpoch,
            counter,
          );
          const baseline = liveEntries
            .filter((entry) => !equal(entry, ownEntry))
            .map(toHex)
            .sort();
          const current = view
            .deviceEntries!.filter((entry) => !equal(entry, latestOwnEntry))
            .map(toHex)
            .sort();
          if (baseline.length !== current.length || baseline.some((item, i) => item !== current[i]))
            throw new PassportConnectorError('InternalError', 'The live device roster changed.');
          const expected = new Map<string, number>();
          for (const entry of [
            ...oldEntries,
            ...keys.envelopes,
            ...keys.registrations,
            ...deliveryEntries,
          ]) {
            const value = toHex(entry);
            expected.set(value, (expected.get(value) ?? 0) + 1);
          }
          for (const entry of view.inboxEntries!) {
            const value = toHex(entry);
            const remaining = expected.get(value) ?? 0;
            if (!remaining)
              throw new PassportConnectorError(
                'InternalError',
                'The ACC inbox changed during rotation.',
              );
            expected.set(value, remaining - 1);
          }
          if ([...expected.values()].some((remaining) => remaining !== 0))
            throw new PassportConnectorError(
              'InternalError',
              'The ACC inbox lost an expected entry.',
            );
          const latestGrants = await flow.step('grant.roster', () =>
            ports.readGrants!.readActiveReadGrantTargets(record.address),
          );
          const ordered = (items: typeof latestGrants.targets) =>
            items.map(({ grantId, readPublicKey }) => `${grantId}:${readPublicKey ?? ''}`).sort();
          if (
            latestGrants.authNonce !== view.authNonce ||
            JSON.stringify(ordered(deliveries.targets)) !==
              JSON.stringify(ordered(latestGrants.targets))
          )
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'The active read-grant roster changed during rotation.',
            );
          const nonce = view.authNonce;
          const circuit = 'rotate_enc_key_with_jubjub';
          const signed = await flow.step('passkey.sign', () =>
            authoriser.authorise({
              account: record.address,
              circuit,
              args: [keys.encKey],
              witnessValues: [],
              authNonce: nonce,
              useCounter: counter,
              challenge: (sigR, grindNonce) =>
                pure.challenge_rotate_enc_key_with_jubjub(
                  self,
                  sigR,
                  record.publicKey,
                  keys.encKey,
                  nonce,
                  grindNonce,
                ),
            }),
          );
          if (signed.scheme !== 'jubjub-schnorr')
            throw new PassportConnectorError(
              'InternalError',
              'The authoriser returned another arm.',
            );
          flow.checkpoint();
          const tx = await (
            await readChain()
          ).call({
            address: record.address,
            circuit,
            args: [
              keys.encKey,
              record.publicKey,
              counter,
              signed.sigR,
              signed.sigS,
              signed.grindNonce,
            ],
            ...flow.ports,
          });
          view = await advanced(record, nonce);
          if (!equal(view.encKey!, keys.encKey))
            throw new PassportConnectorError(
              'EncryptionKeyMismatch',
              'The rotated ACC key did not land.',
            );
          for (const entry of reencrypted) view = await append(flow, record, entry!, view);
          const rotation = {
            ...tx,
            droppedDeviceEntries: roster.dropped
              .filter((entry) => !equal(entry, ownEntry))
              .map(toHex),
            sealedReadGrants: deliveries.sealed.map(
              ({ grantId, readPublicKey, seal, sealedEncKey }) => ({
                grantId,
                readPublicKey,
                seal,
                sealedEncKey,
              }),
            ),
            unsealedGrantIds: deliveries.unsealedGrantIds,
          };
          if (enrollment) {
            view = await read(record, true);
            if (view.deviceEntries!.some((held) => equal(held, enrollment.entry)))
              throw new PassportConnectorError(
                'DeviceRosterInvalid',
                'The joining device is live.',
              );
            const enrolled = await completeEnrollment(
              flow,
              record,
              pure,
              view,
              enrollment.reader,
              enrollment.entry,
              deliveries.targets,
            );
            return {
              ...enrolled,
              rotationTxHash: tx.txHash,
              sealedReadGrants: rotation.sealedReadGrants,
            };
          }
          if (!target) return rotation;
          view = await read(record, true);
          if (!view.deviceEntries!.some((entry) => equal(entry, target)))
            throw new PassportConnectorError(
              'RemovalTargetNotFound',
              'The target disappeared before the removal call.',
            );
          const removeCounter = findCounter(record, view);
          if (removeCounter === undefined)
            throw new PassportConnectorError('NotAuthorised', 'This device is no longer live.');
          const removeNonce = view.authNonce;
          const removeCircuit = 'remove_device_with_jubjub';
          const removeSignature = await flow.step('passkey.sign', () =>
            authoriser.authorise({
              account: record.address,
              circuit: removeCircuit,
              args: [target],
              witnessValues: [],
              authNonce: removeNonce,
              useCounter: removeCounter,
              challenge: (sigR, grindNonce) =>
                pure.challenge_remove_device_with_jubjub(
                  self,
                  sigR,
                  record.publicKey,
                  target,
                  removeNonce,
                  grindNonce,
                ),
            }),
          );
          if (
            removeSignature.scheme !== 'jubjub-schnorr' ||
            removeSignature.useCounter !== removeCounter ||
            !samePoint(removeSignature.pk, record.publicKey)
          )
            throw new PassportConnectorError(
              'NotAuthorised',
              'The signature names another device.',
            );
          flow.checkpoint();
          const removed = await (
            await readChain()
          ).call({
            address: record.address,
            circuit: removeCircuit,
            args: [
              target,
              record.publicKey,
              removeCounter,
              removeSignature.sigR,
              removeSignature.sigS,
              removeSignature.grindNonce,
            ],
            ...flow.ports,
          });
          await advanced(record, removeNonce);
          const settled = await read(record, true);
          if (settled.deviceEntries!.some((entry) => equal(entry, target)))
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The device removal did not land.',
            );
          return {
            ...rotation,
            ...removed,
            removedCommitmentHex: toHex(target),
            rotationTxHash: tx.txHash,
          } satisfies DeviceRemovalResult;
        },
        target
          ? {
              kind: 'remove-device',
              account: record.address,
              commitmentHex: toHex(target),
              devices: initial!.deviceEntries!.filter((entry) => !equal(entry, target)).map(toHex),
            }
          : enrollment
            ? {
                kind: 'add-device',
                account: record.address,
                commitmentHex: toHex(enrollment.entry),
                reader: enrollment.reader,
                devices: enrollment.initial.deviceEntries!.map(toHex),
              }
            : { kind: 'rotate-encryption-key' },
      );
    };
    return existingFlow ? body(existingFlow) : run(options, body);
  };
  const account = (record: JubjubHint): PassportAccount => ({
    address: record.address,
    networkId,
    bindingId: network.bindingId,
    scheme: 'jubjub-schnorr',
    credentialId: record.credentialId.slice(),
    async state() {
      const view = await read(record);
      return {
        booted: view.booted,
        authNonce: view.authNonce,
        deviceEpoch: view.deviceEpoch,
        entryCount: view.entryCount,
        specVersion: view.specVersion,
      };
    },
    async rotateEncryptionKey() {
      throw new PassportConnectorError(
        'BindingUnsupported',
        'JubJub rotation requires sealed-key and inbox re-encryption flow.',
      );
    },
    rotateViewingKey: (options) =>
      rotateViewingKey(record, options) as Promise<ViewingKeyRotationResult>,
    removeDevice: (commitmentHex, options) =>
      rotateViewingKey(record, options, commitmentHex) as Promise<DeviceRemovalResult>,
    addDevice: (reader, options) => addDevice(record, reader, options),
    issueGrant: async (scope, options = {}) => {
      if (!ports.records || !ports.grants || !ports.grantJournal || !ports.grantOrigin)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'Grant issue needs local records, a live grant source, durable journal and host origin.',
        );
      if (network.bindingId !== 'acc-s3r1.1')
        throw new PassportConnectorError('BindingUnsupported', 'Unsupported ACC grant binding.');
      const pure = requireGrantPure((await readBinding()).pureCircuits);
      return issueAndPublishJubjubGrant(
        { hint: record, origin: ports.grantOrigin, scope, ...options },
        {
          bindingId: 'acc-s3r1.1',
          networkId,
          pure,
          chain: await readChain(),
          authoriser,
          records: ports.records,
          grants: ports.grants,
          journal: ports.grantJournal,
          viewingKey,
          random: fresh,
        },
      );
    },
    revokeGrant: async (grantId, options = {}) => {
      if (!ports.records || !ports.grantDetails)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'Grant revocation needs local records and live grant details.',
        );
      if (network.bindingId !== 'acc-s3r1.1')
        throw new PassportConnectorError('BindingUnsupported', 'Unsupported ACC grant binding.');
      const pure = requireRevokePure((await readBinding()).pureCircuits);
      return revokeAndConfirmJubjubGrant(
        { hint: record, grantId, ...options },
        {
          bindingId: 'acc-s3r1.1',
          pure,
          chain: await readChain(),
          authoriser,
          records: ports.records,
          grants: ports.grantDetails,
          random: fresh,
        },
      );
    },
    readShieldedHoldings: (options = {}) =>
      run(options, async (flow) => {
        if (!ports.holdings)
          throw new PassportConnectorError(
            'BindingUnsupported',
            'Reading shielded holdings requires a chain-backed holding source.',
          );
        const view = await flow.step('chain.read', () => read(record));
        if (!view.booted || record.status !== 'active')
          throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
        if (view.specVersion !== 3)
          throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
        const pure = requirePure((await readBinding()).pureCircuits);
        recordPure.set(record, pure);
        if (findCounter(record, view) === undefined)
          throw new PassportConnectorError('NotAuthorised', 'This device has no live ACC entry.');
        // The pinned Lace v1 coin-description format is 192 bytes with the 01 01 prefix.
        // Device envelopes and grant records need no owner key ceremony for an empty read.
        if (
          !view.inboxEntries!.some(
            (entry) => entry.length === 192 && entry[0] === 1 && entry[1] === 1,
          )
        )
          return [];
        return authoriser.withKeySession!(
          async () => {
            const pk = await authoriser.devicePublicKey();
            if (!samePoint(pk, record.publicKey))
              throw new PassportConnectorError(
                'NotAuthorised',
                'The selected device does not own this ACC.',
              );
            return readVerifiedHoldings(
              {
                account: record.address,
                keyring: {
                  account: record.address,
                  encKey: view.encKey!,
                  envelopes: [...view.inboxEntries!].reverse(),
                },
              },
              {
                networkId,
                chain: await readChain(),
                authoriser,
                viewingKey,
                holdings: ports.holdings!,
              },
            );
          },
          { kind: 'read-holdings' },
        );
      }),
  });

  return {
    apiVersion: PASSPORT_API_VERSION,
    networkId,
    bindingId: network.bindingId,
    createAccount: ({ userName, retireAuthority, onProgress, ...options }) =>
      run(
        options,
        async (flow) => {
          if (typeof retireAuthority !== 'boolean')
            throw new PassportConnectorError('InternalError', 'retireAuthority must be a boolean.');
          const { credentialId } = await flow.step('passkey.create', () =>
            credentials.create({ name: userName }),
          );
          return authoriser.withKeySession!(
            async () => {
              const pk = await authoriser.devicePublicKey();
              const devicePublicKey = await authoriser.devicePublicKeyHex!();
              const keys = await flow.step('passkey.prf', () =>
                viewingKey.createKeys(networkId, { devicePublicKey }),
              );
              const salt = fresh(32);
              const pure = requirePure((await readBinding()).pureCircuits);
              const boot = pure.derive_boot_commitment_with_jubjub(salt, pk);
              const { address } = await flow.step('deploy', () =>
                ports.deployer.deploy({
                  boot,
                  encKey: keys.encKey,
                  firstArm: 'jubjub',
                  retireAuthority,
                  ...flow.ports,
                }),
              );
              const record: JubjubHint = {
                address,
                scheme: 'jubjub-schnorr',
                credentialId,
                publicKey: pk,
                salt,
                keyEntries: [...keys.envelopes, ...keys.registrations],
                status: 'deployed',
              };
              await flow.step(
                'directory.write',
                async () => {
                  for (let attempt = 0; ; attempt++) {
                    try {
                      return await directory.put(networkId, record);
                    } catch (error) {
                      if (attempt >= 2) throw error;
                      await sleep(200 * 2 ** attempt);
                    }
                  }
                },
                'always',
              );
              const view = await awaitDeployed(record);
              return finish(flow, record, view);
            },
            { kind: 'create-account', lockAccount: retireAuthority },
          );
        },
        onProgress,
      ),
    openAccount: (options = {}) =>
      run(options, async (flow) => {
        const identity = await flow.step('passkey.identify', () => credentials.identify());
        const hint = await flow.step('directory.read', () =>
          directory.get(networkId, { kind: 'credential-id', credentialId: identity.credentialId }),
        );
        if (!hint || !isJubjubHint(hint) || !equal(hint.credentialId, identity.credentialId))
          throw new PassportConnectorError('AccountNotFound', 'No JubJub ACC for this passkey.');
        return authoriser.withKeySession!(
          async () => {
            const pk = await authoriser.devicePublicKey();
            if (!samePoint(pk, hint.publicKey))
              throw new PassportConnectorError(
                'AccountNotFound',
                'The ACC hint names another device.',
              );
            const view = await flow.step('chain.read', () => read(hint));
            return finish(flow, hint, view);
          },
          { kind: 'sign-in' },
        );
      }),
  };
}
