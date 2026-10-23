import { resolveRemovalReader } from './removal-reader.js';
import {
  PASSPORT_API_VERSION,
  type DeviceEnrollmentResult,
  type FlowOptions,
  type DeviceRemovalResult,
  type JubjubDeviceReader,
  type PassportDeviceReader,
  type PassportAccount,
  type PassportConnectorAPI,
  type PassportGrantRevokeResult,
  type ViewingKeyRotationResult,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { startFlow, type Flow } from './flow.js';
import { readQualifiedHolding, readVerifiedHoldings } from './holdings.js';
import { validGrantId } from './grant-publication-state.js';
import { issueAndPublishJubjubGrant } from './jubjub-grant-settlement.js';
import type { IssueJubjubGrantPure } from './jubjub-grant-issue.js';
import { recoverPendingJubjubGrants } from './jubjub-grant-publication.js';
import type { GrantRecoveryJournal } from './jubjub-grant-publication.js';
import { revokeAndConfirmJubjubGrant } from './jubjub-grant-revoke.js';
import type { RevokeJubjubGrantPure } from './jubjub-grant-revoke.js';
import { revokeAllJubjubGrants } from './jubjub-grant-revoke-all.js';
import type { RevokeAllJubjubGrantPure } from './jubjub-grant-revoke-all.js';
import {
  JUBJUB_READER_SCAN_LIMIT,
  resolveJubjubReaders,
  resolveRegisteredReaders,
} from './jubjub-readers.js';
import { sealActiveReadGrants } from './read-grant-deliveries.js';
import { prepareShieldedWithdrawal, prepareUnshieldedWithdrawal } from './unshielded-withdrawal.js';
import type {
  AccLedgerView,
  AccountHint,
  ActiveReadGrantTarget,
  Authoriser,
  CurvePoint,
  DeviceReader,
  JubjubPureCircuits,
  PassportPorts,
  QualifiedHoldingSource,
} from './ports/index.js';

const RETRIES = 30;
const equal = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);
const samePoint = (a: CurvePoint, b: CurvePoint): boolean => a.x === b.x && a.y === b.y;
const conflictsWithReader = (registered: DeviceReader, joining: JubjubDeviceReader) =>
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
};

type EnrollmentContext = {
  readonly reader: JubjubDeviceReader;
  readonly entry: Uint8Array;
  readonly initial: AccLedgerView;
  readonly grants: readonly ActiveReadGrantTarget[];
};

function isJubjubHint(hint: AccountHint): hint is JubjubHint {
  const entries = hint.keyEntries;
  const validEntries =
    Array.isArray(entries) &&
    entries.length === 2 &&
    entries[0]?.length === 192 &&
    entries[0][0] === 0xd1 &&
    (entries[0][1] === 1 || entries[0][1] === 2) &&
    entries[1]?.length === 192 &&
    entries[1][0] === 0xd2 &&
    entries[1][1] === entries[0][1];
  return (
    hint.scheme === 'jubjub-schnorr' &&
    hint.credentialId instanceof Uint8Array &&
    (hint.salt === undefined || hint.salt.length === 32) &&
    (entries === undefined || validEntries) &&
    (hint.status !== 'deployed' || (hint.salt?.length === 32 && validEntries))
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

function requireRevokeAllPure(value: unknown): RevokeAllJubjubGrantPure {
  const pure = requirePure(value) as Partial<RevokeAllJubjubGrantPure>;
  if (typeof pure.challenge_revoke_all_grants_with_jubjub !== 'function')
    throw new PassportConnectorError(
      'BindingUnsupported',
      'ACC binding lacks challenge_revoke_all_grants_with_jubjub.',
    );
  return pure as RevokeAllJubjubGrantPure;
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
    const pendingEntries = record.keyEntries ?? [];
    if (pending && pendingEntries.length !== 2)
      throw new PassportConnectorError('AccountNotFound', 'The pending key entries are missing.');
    const entries = pending ? [...view.inboxEntries!, ...pendingEntries] : [...view.inboxEntries!];
    try {
      if (!entries.length) throw new Error('the ACC inbox has no sealed key entries');
      const opened = await viewingKey.openInbox(
        networkId,
        { account: record.address, encKey: view.encKey!, envelopes: [...entries].reverse() },
        // Hosted adapters may return immediately for an empty batch. A nonempty opening
        // forces the key origin to authenticate the envelope against the live enc_key.
        pending ? pendingEntries : entries.slice(0, 1),
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
      if (record.salt?.length !== 32)
        throw new PassportConnectorError('AccountNotFound', 'The pending boot salt is missing.');
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
      for (const entry of record.keyEntries ?? []) {
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
  const addDevice = (record: JubjubHint, input: PassportDeviceReader, options: FlowOptions = {}) =>
    run(options, async (flow): Promise<DeviceEnrollmentResult> => {
      if ('scheme' in input && input.scheme === 'p256-webauthn')
        throw new PassportConnectorError(
          'DeviceRosterInvalid',
          'A JubJub owner cannot enroll a P-256 reader through this flow.',
        );
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
    revocation?: string,
    revokeAll = false,
    inOwnerSession = false,
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
      if (revocation && !validGrantId(revocation))
        throw new PassportConnectorError('GrantScopeInvalid', 'The grant id must be 32-byte hex.');
      if (revocation && (!ports.grantDetails || !ports.records))
        throw new PassportConnectorError(
          'BindingUnsupported',
          'Read grant revocation needs live grant details and local account records.',
        );
      if (revocation && !(await ports.records!.exists()))
        throw new PassportConnectorError('AccountNotFound', 'No local account record exists.');
      const resolvedBinding = await readBinding();
      const pure = requirePure(resolvedBinding.pureCircuits);
      recordPure.set(record, pure);
      if (removal !== undefined && !/^[0-9a-f]{64}$/i.test(removal))
        throw new PassportConnectorError(
          'RemovalTargetNotFound',
          'The target must be a 32-byte device commitment.',
        );
      const target = removal === undefined ? undefined : fromHex(removal.toLowerCase());
      const initial =
        enrollment?.initial ??
        (target || revocation || revokeAll
          ? await flow.step('chain.read', () => read(record, true))
          : undefined);
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
        if (revocation) {
          const grant = await flow.step('grant.roster', () =>
            ports.grantDetails!.readGrant(record.address, revocation),
          );
          if (!grant) throw new PassportConnectorError('GrantNotFound', 'The grant is missing.');
          if (!grant.active)
            throw new PassportConnectorError('GrantRevoked', 'The grant is already revoked.');
          if (!grant.read)
            throw new PassportConnectorError('GrantScopeInvalid', 'The grant has no read access.');
          if (grant.authNonce !== initial.authNonce)
            throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster is stale.');
          const targets = await flow.step('grant.roster', () =>
            ports.readGrants!.readActiveReadGrantTargets(record.address),
          );
          if (
            targets.authNonce !== initial.authNonce ||
            !targets.targets.some(({ grantId }) => grantId === revocation)
          )
            throw new PassportConnectorError('GrantRosterUnsettled', 'The read grant is absent.');
        }
      }
      const withSession: NonNullable<Authoriser['withKeySession']> = inOwnerSession
        ? (operation) => operation()
        : (operation, descriptor) => authoriser.withKeySession!(operation, descriptor);
      return withSession(
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
          if (revocation) {
            const stored = await ports.records!.read();
            if (
              stored?.scheme !== 'jubjub-schnorr' ||
              stored.address !== record.address ||
              stored.bindingId !== network.bindingId ||
              !stored.credentialId ||
              !equal(stored.credentialId, record.credentialId)
            )
              throw new PassportConnectorError(
                'NotAuthorised',
                'The local record does not match this device.',
              );
          }
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
          if (target || enrollment || revocation || revokeAll) {
            if (
              view.authNonce !== initial!.authNonce ||
              view.deviceEpoch !== initial!.deviceEpoch ||
              !equal(view.encKey!, initial!.encKey!)
            )
              throw new PassportConnectorError(
                revocation ? 'GrantRosterUnsettled' : 'DeviceRosterInvalid',
                'The ACC changed after the owner flow was approved.',
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
          const registered = opened.flatMap((entry) =>
            entry?.kind === 'device' ? [entry.device] : [],
          );
          const rosterInput = {
            account: record.address,
            epoch: view.deviceEpoch,
            registered,
            liveEntries,
            ...(target && {
              allowedEntries: liveEntries.filter((entry) => !equal(entry, target)),
            }),
            pure,
            decodeDevicePublicKey: decode,
          };
          const decodeP256 = viewingKey.decodeP256DevicePublicKey;
          if (registered.some((entry) => entry.scheme === 'p256-webauthn') && !decodeP256)
            throw new PassportConnectorError(
              'BindingUnsupported',
              'A mixed roster needs a P-256 registration decoder.',
            );
          const roster = decodeP256
            ? resolveRegisteredReaders({
                ...rosterInput,
                p256Pure: resolvedBinding.pureCircuits,
                decodeP256DevicePublicKey: decodeP256,
              })
            : resolveJubjubReaders(rosterInput);
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
          if (roster.dropped.some((entry) => !equal(entry, ownEntry) || (!target && !enrollment)))
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'A live device has no unique, usable reader registration.',
            );
          const removedReader = target
            ? await resolveRemovalReader(roster, {
                ...(viewingKey.readDeviceRegistrationHistory && {
                  read: () =>
                    viewingKey.readDeviceRegistrationHistory!(networkId, oldKeyring, oldEntries),
                }),
                resolve: (registered) =>
                  decodeP256
                    ? resolveRegisteredReaders({
                        ...rosterInput,
                        registered,
                        p256Pure: resolvedBinding.pureCircuits,
                        decodeP256DevicePublicKey: decodeP256,
                      })
                    : resolveJubjubReaders({ ...rosterInput, registered }),
              })
            : undefined;
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
            (entry) =>
              entry.length === 192 &&
              (entry[1] === 1 || entry[1] === 2) &&
              (entry[0] === 0xd2 || entry[0] === 0xd4 || entry[0] === 0xd5),
          );
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
              ...(revocation && { exceptGrantId: revocation }),
              ...(revokeAll && { exceptAll: true }),
              ...flow.ports,
            },
            { targets: ports.readGrants!, viewingKey, random: fresh },
          );
          if (deliveries.unsealedGrantIds.length)
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'Every surviving read grantee must receive the fresh viewing secret.',
            );
          if (
            removedReader &&
            deliveries.targets.some(
              ({ readPublicKey }) => readPublicKey === removedReader.readerPublicKey,
            )
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'An active read grant would return the fresh key to the removed reader.',
            );
          if (revocation && !deliveries.targets.some(({ grantId }) => grantId === revocation))
            throw new PassportConnectorError('GrantRosterUnsettled', 'The read grant disappeared.');
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
          if (revocation) {
            view = await read(record, true);
            const grant = await flow.step('grant.roster', () =>
              ports.grantDetails!.readGrant(record.address, revocation),
            );
            if (!grant?.active || !grant.read || grant.authNonce !== view.authNonce)
              throw new PassportConnectorError(
                'GrantRosterUnsettled',
                'The read grant changed during rotation.',
              );
            const revokeCounter = findCounter(record, view);
            if (revokeCounter === undefined)
              throw new PassportConnectorError('NotAuthorised', 'This device is no longer live.');
            const id = fromHex(revocation);
            const nonce = view.authNonce;
            const revokePure = requireRevokePure((await readBinding()).pureCircuits);
            const signed = await flow.step('passkey.sign', () =>
              authoriser.authorise({
                account: record.address,
                circuit: 'revoke_grant_with_jubjub',
                args: [id],
                witnessValues: [],
                authNonce: nonce,
                useCounter: revokeCounter,
                challenge: (sigR, grindNonce) =>
                  revokePure.challenge_revoke_grant_with_jubjub(
                    self,
                    sigR,
                    record.publicKey,
                    id,
                    nonce,
                    grindNonce,
                  ),
              }),
            );
            if (
              signed.scheme !== 'jubjub-schnorr' ||
              signed.useCounter !== revokeCounter ||
              !samePoint(signed.pk, record.publicKey)
            )
              throw new PassportConnectorError(
                'NotAuthorised',
                'The revocation signature names another device.',
              );
            flow.checkpoint();
            const revoked = await (
              await readChain()
            ).call({
              address: record.address,
              circuit: 'revoke_grant_with_jubjub',
              args: [
                id,
                record.publicKey,
                revokeCounter,
                signed.sigR,
                signed.sigS,
                signed.grindNonce,
              ],
              ...flow.ports,
            });
            await advanced(record, nonce);
            const stored = await ports.records!.read();
            if (!stored || stored.address !== record.address)
              throw new PassportConnectorError(
                'AccountNotFound',
                'No local account record exists.',
              );
            await ports.records!.write({ ...stored, localUseCounter: revokeCounter + 1n });
            for (let attempt = 0; attempt < RETRIES; attempt++) {
              flow.checkpoint();
              const settled = await flow.step('grant.roster', () =>
                ports.grantDetails!.readGrant(record.address, revocation),
              );
              if (settled && !settled.active) {
                return {
                  ...revoked,
                  grantId: revocation,
                  status: 'revoked' as const,
                  nextUseCounter: revokeCounter + 1n,
                  rotation,
                };
              }
              if (attempt + 1 < RETRIES) await sleep(1000);
            }
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'The read grant revocation did not settle.',
            );
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
            : revokeAll
              ? {
                  kind: 'revoke-all-grants',
                  account: record.address,
                  read: true,
                  devices: initial!.deviceEntries!.map(toHex),
                }
              : revocation
                ? {
                    kind: 'revoke-grant',
                    account: record.address,
                    grantId: revocation,
                    read: true,
                    devices: initial!.deviceEntries!.map(toHex),
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
    withdrawUnshielded: (request, options = {}) =>
      run(options, async (flow) => {
        const transfer = prepareUnshieldedWithdrawal(request);
        const pure = requirePure((await readBinding()).pureCircuits);
        if (network.bindingId !== 'acc-s3r1.1' || !pure.challenge_withdraw_unshielded_with_jubjub)
          throw new PassportConnectorError(
            'BindingUnsupported',
            'JubJub withdrawal needs the pinned challenge circuit.',
          );
        if (record.status !== 'active')
          throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
        recordPure.set(record, pure);
        return authoriser.withKeySession!(
          async () => {
            const pk = await authoriser.devicePublicKey();
            if (!samePoint(pk, record.publicKey))
              throw new PassportConnectorError(
                'NotAuthorised',
                'The selected device does not own this ACC.',
              );
            const view = await flow.step('chain.read', () => read(record));
            if (!view.booted || view.specVersion !== 3)
              throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
            const counter = await flow.step('counter.scan', async () => findCounter(record, view));
            if (counter === undefined)
              throw new PassportConnectorError(
                'NotAuthorised',
                'This device has no live ACC entry.',
              );
            const self = { bytes: fromHex(record.address) };
            const circuit = 'withdraw_unshielded_with_jubjub';
            const signed = await flow.step('passkey.sign', () =>
              authoriser.authorise({
                account: record.address,
                circuit,
                args: [transfer.color, transfer.amount, transfer.recipient],
                witnessValues: [],
                authNonce: view.authNonce,
                useCounter: counter,
                challenge: (sigR, grindNonce) =>
                  pure.challenge_withdraw_unshielded_with_jubjub!(
                    self,
                    sigR,
                    record.publicKey,
                    transfer.color,
                    transfer.amount,
                    transfer.recipient,
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
              throw new PassportConnectorError(
                'NotAuthorised',
                'The signature names another device.',
              );
            flow.checkpoint();
            const tx = await (
              await readChain()
            ).call({
              address: record.address,
              circuit,
              args: [
                transfer.color,
                transfer.amount,
                transfer.recipient,
                record.publicKey,
                counter,
                signed.sigR,
                signed.sigS,
                signed.grindNonce,
              ],
              ...flow.ports,
            });
            return { ...tx, nextUseCounter: counter + 1n };
          },
          {
            kind: 'withdraw-unshielded',
            account: record.address,
            color: request.color,
            amount: request.amount,
            recipient: request.recipient,
          },
        );
      }),
    withdrawShielded: (request, options = {}) =>
      run(options, async (flow) => {
        const transfer = prepareShieldedWithdrawal(request);
        const qualified = ports.holdings as QualifiedHoldingSource | undefined;
        const pure = requirePure((await readBinding()).pureCircuits);
        if (
          network.bindingId !== 'acc-s3r1.1' ||
          !pure.challenge_withdraw_shielded_with_jubjub ||
          !qualified?.selectQualifiedHeldCoins
        )
          throw new PassportConnectorError(
            'BindingUnsupported',
            'JubJub shielded withdrawal needs the pinned challenge and qualified holdings.',
          );
        if (record.status !== 'active')
          throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
        recordPure.set(record, pure);
        return authoriser.withKeySession!(
          async () => {
            const pk = await authoriser.devicePublicKey();
            if (!samePoint(pk, record.publicKey))
              throw new PassportConnectorError(
                'NotAuthorised',
                'The selected device does not own this ACC.',
              );
            const view = await flow.step('chain.read', () => read(record));
            if (!view.booted || view.specVersion !== 3)
              throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
            const counter = await flow.step('counter.scan', async () => findCounter(record, view));
            if (counter === undefined)
              throw new PassportConnectorError(
                'NotAuthorised',
                'This device has no live ACC entry.',
              );
            const chainPort = await readChain();
            const coin = await readQualifiedHolding(
              {
                account: record.address,
                keyring: {
                  account: record.address,
                  encKey: view.encKey!,
                  envelopes: [...view.inboxEntries!].reverse(),
                },
                inboxIndex: transfer.inboxIndex,
                color: transfer.color,
              },
              { networkId, chain: chainPort, viewingKey, holdings: qualified },
            );
            if (transfer.amount !== coin.value)
              throw new PassportConnectorError(
                'TransferInvalid',
                'A shielded owner withdrawal must spend the selected coin exactly until change settlement is available.',
              );
            const self = { bytes: fromHex(record.address) };
            const circuit = 'withdraw_shielded_with_jubjub';
            const signed = await flow.step('passkey.sign', () =>
              authoriser.authorise({
                account: record.address,
                circuit,
                args: [transfer.recipient, transfer.color, transfer.amount],
                witnessValues: [coin],
                authNonce: view.authNonce,
                useCounter: counter,
                challenge: (sigR, grindNonce) =>
                  pure.challenge_withdraw_shielded_with_jubjub!(
                    self,
                    sigR,
                    record.publicKey,
                    transfer.recipient,
                    transfer.color,
                    transfer.amount,
                    coin,
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
              throw new PassportConnectorError(
                'NotAuthorised',
                'The signature names another device.',
              );
            flow.checkpoint();
            const tx = await chainPort.call({
              address: record.address,
              circuit,
              args: [
                transfer.recipient,
                transfer.color,
                transfer.amount,
                record.publicKey,
                counter,
                signed.sigR,
                signed.sigS,
                signed.grindNonce,
              ],
              heldCoin: coin,
              ...flow.ports,
            });
            return { ...tx, nextUseCounter: counter + 1n };
          },
          {
            kind: 'withdraw-shielded',
            account: record.address,
            color: request.color,
            amount: request.amount,
            recipient: request.recipient,
            inboxIndex: request.inboxIndex,
          },
        );
      }),
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
    async deviceRoster() {
      const view = await (await readChain()).readAccount(record.address, { includeDevices: true });
      if (!view?.booted || !view.deviceEntries || view.deviceEntries.length !== view.entryCount)
        throw new PassportConnectorError(
          'DeviceRosterInvalid',
          'The live ACC roster is unavailable.',
        );
      return {
        deviceEpoch: view.deviceEpoch,
        authNonce: view.authNonce,
        commitments: view.deviceEntries.map(toHex).sort(),
      };
    },
    async grantRoster() {
      if (!ports.grantRoster)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'A live ACC grant roster is required.',
        );
      return ports.grantRoster.readGrantRoster(record.address);
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
      if (
        !ports.records ||
        !ports.grants ||
        !ports.grantCommitments ||
        !ports.grantJournal ||
        !ports.grantOrigin
      )
        throw new PassportConnectorError(
          'BindingUnsupported',
          'Grant issue needs local records, a live grant source, durable journal and host origin.',
        );
      if (
        scope.read &&
        (!ports.holdings ||
          !ports.readGrants ||
          !viewingKey.reencryptInbox ||
          !viewingKey.decodeDevicePublicKey ||
          !viewingKey.sealView)
      )
        throw new PassportConnectorError(
          'BindingUnsupported',
          'Read grants need verified holdings, live read grants and a full viewing-key port.',
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
          commitments: ports.grantCommitments,
          journal: ports.grantJournal,
          viewingKey,
          random: fresh,
          ...(scope.read && {
            rotateBeforeIssue: () =>
              rotateViewingKey(
                record,
                options,
                undefined,
                undefined,
                undefined,
                undefined,
                false,
                true,
              ) as Promise<ViewingKeyRotationResult>,
          }),
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
      const grant = await ports.grantDetails.readGrant(record.address, grantId);
      if (grant?.read && grant.active)
        return rotateViewingKey(
          record,
          options,
          undefined,
          undefined,
          undefined,
          grantId,
        ) as Promise<PassportGrantRevokeResult>;
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
    revokeAllGrants: async (options = {}) => {
      if (!ports.records || !ports.grantRoster)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'Grant revoke-all needs local records and the complete live grant roster.',
        );
      if (network.bindingId !== 'acc-s3r1.1')
        throw new PassportConnectorError('BindingUnsupported', 'Unsupported ACC grant binding.');
      const pure = requireRevokeAllPure((await readBinding()).pureCircuits);
      return revokeAllJubjubGrants(
        { hint: record, ...options },
        {
          bindingId: 'acc-s3r1.1',
          pure,
          chain: await readChain(),
          grants: ports.grantRoster,
          authoriser,
          records: ports.records,
          random: fresh,
          ...(ports.holdings &&
            ports.readGrants &&
            viewingKey.reencryptInbox &&
            viewingKey.decodeDevicePublicKey &&
            viewingKey.sealView && {
              rotateBeforeRevokeAll: () =>
                rotateViewingKey(
                  record,
                  options,
                  undefined,
                  undefined,
                  undefined,
                  undefined,
                  true,
                  true,
                ) as Promise<ViewingKeyRotationResult>,
            }),
        },
      );
    },
    recoverPendingGrants: async (options = {}) => {
      if (
        !ports.records ||
        !ports.grants ||
        !ports.grantCommitments ||
        !ports.grantJournal ||
        typeof (ports.grantJournal as Partial<GrantRecoveryJournal>).pending !== 'function'
      )
        throw new PassportConnectorError(
          'BindingUnsupported',
          'Grant recovery needs local records, a live roster and pending journal enumeration.',
        );
      if (network.bindingId !== 'acc-s3r1.1')
        throw new PassportConnectorError('BindingUnsupported', 'Unsupported ACC grant binding.');
      const pure = requireGrantPure((await readBinding()).pureCircuits);
      return recoverPendingJubjubGrants(
        { hint: record, ...options },
        {
          bindingId: 'acc-s3r1.1',
          networkId,
          pure,
          chain: await readChain(),
          grants: ports.grants,
          commitments: ports.grantCommitments,
          journal: ports.grantJournal as GrantRecoveryJournal,
          viewingKey,
          authoriser,
          records: ports.records,
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
    openAccountAt: (address, options = {}) =>
      run(options, async (flow) => {
        if (!/^[0-9a-f]{64}$/.test(address))
          throw new PassportConnectorError(
            'AccountNotFound',
            'ACC address must be 32-byte lowercase hex.',
          );
        const identity = await flow.step('passkey.identify', () => credentials.identify());
        return authoriser.withKeySession!(
          async () => {
            const publicKey = await authoriser.devicePublicKey();
            const devicePublicKey = await authoriser.devicePublicKeyHex!();
            const record: JubjubHint = {
              address,
              scheme: 'jubjub-schnorr',
              credentialId: identity.credentialId.slice(),
              publicKey,
              status: 'active',
            };
            const view = await flow.step('chain.read', () => read(record, true));
            if (!view.booted || view.specVersion !== 3)
              throw new PassportConnectorError(
                'AccountNotFound',
                'The selected ACC is not an active spec-3 account.',
              );
            const pure = requirePure((await readBinding()).pureCircuits);
            recordPure.set(record, pure);
            const counter = findCounter(record, view);
            if (counter === undefined)
              throw new PassportConnectorError(
                'NotAuthorised',
                'This device has no live ACC entry.',
              );
            await keyring(record, view, false);
            const readerPublicKey = toHex(await viewingKey.readerPublicKey(networkId));
            const opened = await viewingKey.openInbox(
              networkId,
              {
                account: address,
                encKey: view.encKey!,
                envelopes: [...view.inboxEntries!].reverse(),
              },
              view.inboxEntries!,
            );
            const matching = opened.filter(
              (entry) =>
                entry?.kind === 'device' &&
                entry.device.scheme !== 'p256-webauthn' &&
                entry.device.readerPublicKey === readerPublicKey &&
                entry.device.devicePublicKey === devicePublicKey,
            );
            if (matching.length !== 1)
              throw new PassportConnectorError(
                'EncryptionKeyMismatch',
                'The live ACC inbox has no unique registration for this device.',
              );
            // Known-address opening has already verified the live entry and sealed keys.
            // Existing directory pointers are write-once and may retain boot salt/key entries;
            // never replace them with this minimal address-derived hint (or trust them over chain).
            const existing = await flow.step('directory.read', () =>
              directory.get(networkId, {
                kind: 'credential-id',
                credentialId: identity.credentialId,
              }),
            );
            if (!existing)
              await flow.step('directory.write', () => directory.put(networkId, record), 'always');
            await ports.records?.write({
              address,
              bindingId: network.bindingId,
              scheme: 'jubjub-schnorr',
              credentialId: record.credentialId.slice(),
              localUseCounter: counter,
            });
            return account(record);
          },
          { kind: 'sign-in' },
        );
      }),
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
