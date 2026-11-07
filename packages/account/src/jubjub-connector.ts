import { withLoginSession } from './with-login-session.js';
import { snapshotGrantScope, snapshotDeviceReader } from './request-snapshots.js';
import {
  accountInboxReader,
  hasInbox,
  requireDeviceInbox,
  type InboxLedgerView,
} from './inbox-view.js';
import { jubjubWithdrawals } from './jubjub-withdrawals.js';
import { lazyPort } from './lazy-port.js';
import {
  PASSPORT_API_VERSION,
  type DeviceEnrollmentResult,
  type FlowOptions,
  type DeviceRemovalResult,
  type PassportDeviceReader,
  type PassportAccount,
  type PassportConnectorAPI,
  type PassportGrantRevokeResult,
  type ViewingKeyRotationResult,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { startFlow, type Flow } from './flow.js';
import { readVerifiedHoldings } from './holdings.js';
import { issueAndPublishJubjubGrant } from './jubjub-grant-settlement.js';
import type { IssueJubjubGrantPure } from './jubjub-grant-issue.js';
import { recoverPendingJubjubGrants } from './jubjub-grant-publication.js';
import type { GrantRecoveryJournal } from './jubjub-grant-publication.js';
import { revokeAndConfirmJubjubGrant } from './jubjub-grant-revoke.js';
import type { RevokeJubjubGrantPure } from './jubjub-grant-revoke.js';
import { revokeAllJubjubGrants } from './jubjub-grant-revoke-all.js';
import type { RevokeAllJubjubGrantPure } from './jubjub-grant-revoke-all.js';
import { JUBJUB_READER_SCAN_LIMIT } from './jubjub-readers.js';
import { createJubjubViewingRotation } from './jubjub-viewing-rotation.js';
import type { JubjubHint } from './jubjub-rotation-types.js';
import type {
  AccLedgerView,
  AccountHint,
  ActiveReadGrantTarget,
  CurvePoint,
  DeviceReader,
  JubjubPureCircuits,
  PassportPorts,
} from './ports/index.js';

const RETRIES = 30;
const equal = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);
const samePoint = (a: CurvePoint, b: CurvePoint): boolean => a.x === b.x && a.y === b.y;
const conflictsWithReader = (registered: DeviceReader, joining: PassportDeviceReader) =>
  (registered.readerPublicKey === joining.readerPublicKey ||
    registered.devicePublicKey === joining.devicePublicKey) &&
  (registered.readerPublicKey !== joining.readerPublicKey ||
    registered.devicePublicKey !== joining.devicePublicKey ||
    (registered.scheme === 'p256-webauthn') !==
      ('scheme' in joining && joining.scheme === 'p256-webauthn') ||
    (registered.scheme === 'p256-webauthn' &&
      'policy' in joining &&
      (!registered.policy ||
        !equal(registered.policy.rp_id_hash, joining.policy.rp_id_hash) ||
        !equal(registered.policy.origin, joining.policy.origin))));
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
  const readBinding = lazyPort(ports.binding);
  const readChain = lazyPort(ports.chain);
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
  const read = accountInboxReader(readChain);
  const awaitDeployed = async (record: JubjubHint): Promise<InboxLedgerView> => {
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const view = await (await readChain()).readAccount(record.address, { includeInbox: true });
      if (view && hasInbox(view)) return view;
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
  const keyring = async (record: JubjubHint, view: InboxLedgerView, pending: boolean) => {
    const reader = await viewingKey.readerPublicKey(networkId);
    if (reader.length !== 32)
      throw new PassportConnectorError('InternalError', 'Invalid reader key.');
    const pendingEntries = record.keyEntries ?? [];
    if (pending && pendingEntries.length !== 2)
      throw new PassportConnectorError('AccountNotFound', 'The pending key entries are missing.');
    const entries = pending ? [...view.inboxEntries, ...pendingEntries] : [...view.inboxEntries];
    try {
      if (!entries.length) throw new Error('the ACC inbox has no sealed key entries');
      const opened = await viewingKey.openInbox(
        networkId,
        { account: record.address, encKey: view.encKey, envelopes: [...entries].reverse() },
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
  const advanced = async (record: JubjubHint, nonce: bigint): Promise<InboxLedgerView> => {
    for (let attempt = 0; attempt < RETRIES; attempt++) {
      const view = await read(record);
      if (view.authNonce > nonce) return view;
      await sleep(1000);
    }
    throw new PassportConnectorError('InternalError', 'The ACC call did not appear in the ledger.');
  };
  const awaitBooted = async (record: JubjubHint): Promise<InboxLedgerView> => {
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
  const finish = async (flow: Flow, record: JubjubHint, view: InboxLedgerView) => {
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
        if (view.inboxEntries.some((held) => equal(held, entry))) continue;
        view = await append(flow, record, entry, view);
      }
    }
    await keyring(record, view, false);
    const active: JubjubHint = { ...record, status: 'active' };
    recordPure.set(active, pure);
    if (pending)
      await flow.step('directory.write', () => directory.put(networkId, active), 'always');
    // Grant APIs require the same verified local record as address-based opening.
    // Reconstruct it after successful create/directory reopening as well; the
    // current live counter is authoritative, never an old profile's cached value.
    const counter = findCounter(active, view);
    if (counter === undefined)
      throw new PassportConnectorError('NotAuthorised', 'This device has no live ACC entry.');
    await ports.records?.write({
      address: active.address,
      bindingId: network.bindingId,
      scheme: 'jubjub-schnorr',
      credentialId: Uint8Array.from(active.credentialId),
      localUseCounter: counter,
    });
    return account(active);
  };
  const joiningEntry = async (address: string, reader: PassportDeviceReader) => {
    const p256 = 'scheme' in reader && reader.scheme === 'p256-webauthn';
    if (
      !/^[0-9a-f]{64}$/.test(reader.readerPublicKey) ||
      ('scheme' in reader && !p256) ||
      (!p256 && 'policy' in reader) ||
      (p256 &&
        (!(reader.policy?.rp_id_hash instanceof Uint8Array) ||
          reader.policy.rp_id_hash.length !== 32 ||
          !(reader.policy.origin instanceof Uint8Array) ||
          reader.policy.origin.length !== 21))
    )
      throw new PassportConnectorError(
        'DeviceRosterInvalid',
        'The joining keys or WebAuthn policy are malformed.',
      );
    const decode = p256 ? viewingKey.decodeP256DevicePublicKey : viewingKey.decodeDevicePublicKey;
    if (!decode)
      throw new PassportConnectorError(
        'BindingUnsupported',
        'The joining device decoder is unavailable.',
      );
    const point = decode(reader.devicePublicKey);
    if (!point)
      throw new PassportConnectorError('DeviceRosterInvalid', 'The joining device key is invalid.');
    const pure = (await readBinding()).pureCircuits;
    if (p256 && typeof pure.derive_device_entry_with_p256 !== 'function')
      throw new PassportConnectorError(
        'BindingUnsupported',
        'The binding cannot derive a P-256 device entry.',
      );
    return {
      point,
      p256,
      derive: (epoch: bigint, counter: bigint) =>
        p256
          ? pure.derive_device_entry_with_p256(
              { bytes: fromHex(address) },
              point as import('./ports/index.js').P256PublicKey,
              reader.policy,
              epoch,
              counter,
            )
          : requirePure(pure).derive_device_entry_with_jubjub(
              { bytes: fromHex(address) },
              point,
              epoch,
              counter,
            ),
    };
  };
  /** Deliver from the live keyring, then enroll the reader through a separate gated call. */
  const completeEnrollment = async (
    flow: Flow,
    record: JubjubHint,
    pure: JubjubPureCircuits,
    view: InboxLedgerView,
    reader: PassportDeviceReader,
    entry: Uint8Array,
    expectedGrants: readonly ActiveReadGrantTarget[],
  ): Promise<DeviceEnrollmentResult> => {
    requireDeviceInbox(view);
    const ownerKey = await authoriser.devicePublicKey();
    if (!samePoint(ownerKey, record.publicKey) || findCounter(record, view) === undefined)
      throw new PassportConnectorError('NotAuthorised', 'This device no longer owns the ACC.');
    if (reader.readerPublicKey === toHex(await viewingKey.readerPublicKey(networkId)))
      throw new PassportConnectorError('DeviceRosterInvalid', 'The joining reader is the owner.');
    await keyring(record, view, false);
    const currentKeyring = {
      account: record.address,
      encKey: view.encKey,
      envelopes: [...view.inboxEntries].reverse(),
    };
    const opened = await viewingKey.openInbox(networkId, currentKeyring, view.inboxEntries);
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
      const joining = await joiningEntry(record.address, reader);
      for (let counter = 0n; counter < JUBJUB_READER_SCAN_LIMIT; counter++) {
        if (view.hasEntry(joining.derive(view.deviceEpoch, counter)))
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
    requireDeviceInbox(view);
    if (
      !equal(view.encKey, currentKeyring.encKey) ||
      view.deviceEpoch !== epoch ||
      ![delivery.envelope, delivery.registration].every((sealed) =>
        view.inboxEntries.some((held) => equal(held, sealed)),
      )
    )
      throw new PassportConnectorError('EncryptionKeyMismatch', 'The key delivery did not settle.');
    if (view.deviceEntries.some((held) => equal(held, entry)))
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
      if (!ports.readGrants)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'JubJub enrollment needs a reader decoder and a complete chain-backed read-grant source.',
        );
      const reader = snapshotDeviceReader(input);
      const joining = await joiningEntry(record.address, reader);
      if (!joining.p256 && samePoint(joining.point, record.publicKey))
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
      const entry = joining.derive(initial.deviceEpoch, 0n);
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
          if (!equal(view.encKey, initial.encKey))
            throw new PassportConnectorError('EncryptionKeyMismatch', 'The ACC key changed.');
          if (view.deviceEntries.some((held) => equal(held, entry)))
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The joining device is already live.',
            );
          return completeEnrollment(flow, record, pure, view, reader, entry, []);
        },
        { kind: 'add-device', account: record.address, commitmentHex: toHex(entry), reader },
      );
    });
  const rotateViewingKey = createJubjubViewingRotation({
    ports,
    authoriser,
    viewingKey,
    withOwnerSession(operation, descriptor) {
      const current = authoriser.withKeySession;
      if (!current)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'JubJub accounts need a directory, viewing key, and session-capable authoriser.',
        );
      return current.bind(authoriser)(operation, descriptor);
    },
    ownerPublicKeyHex() {
      const current = authoriser.devicePublicKeyHex;
      if (!current)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'JubJub accounts need a directory, viewing key, and session-capable authoriser.',
        );
      return current.call(authoriser);
    },
    async resolveBinding(record) {
      const binding = await readBinding();
      const pure = requirePure(binding.pureCircuits);
      recordPure.set(record, pure);
      return { binding, pure };
    },
    revocationPure: async () => requireRevokePure((await readBinding()).pureCircuits),
    read: (record) => read(record, true),
    chain: readChain,
    findCounter,
    keyring,
    append,
    advanced,
    completeEnrollment,
    conflictsWithReader,
    run,
    random: fresh,
    sleep,
  });
  const account = (record: JubjubHint): PassportAccount => ({
    address: record.address,
    networkId,
    bindingId: network.bindingId,
    scheme: 'jubjub-schnorr',
    credentialId: Uint8Array.from(record.credentialId),
    ...jubjubWithdrawals({
      record,
      ports: { ...ports, viewingKey },
      readBinding,
      readChain,
      requirePure,
      read,
      findCounter,
      recordPure,
      run,
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
      scope = snapshotGrantScope(scope);
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
          !view.inboxEntries.some(
            (entry) => entry.length === 192 && entry[0] === 1 && entry[1] === 1,
          )
        )
          return [];
        const routine = ports.routineViewingKey?.({
          account: record.address,
          networkId,
          bindingId: network.bindingId,
          credentialId: Uint8Array.from(record.credentialId),
        });
        if (routine)
          return readVerifiedHoldings(
            {
              account: record.address,
              keyring: {
                account: record.address,
                encKey: view.encKey,
                envelopes: [...view.inboxEntries].reverse(),
              },
            },
            {
              networkId,
              chain: await readChain(),
              authoriser: { withKeySession: async (work) => work() },
              viewingKey: routine,
              holdings: ports.holdings!,
            },
          );
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
                  encKey: view.encKey,
                  envelopes: [...view.inboxEntries].reverse(),
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

  const api: PassportConnectorAPI = {
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
              credentialId: Uint8Array.from(identity.credentialId),
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
                encKey: view.encKey,
                envelopes: [...view.inboxEntries].reverse(),
              },
              view.inboxEntries,
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
              credentialId: Uint8Array.from(record.credentialId),
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
          directory.get(networkId, {
            kind: 'credential-id',
            credentialId: identity.credentialId,
          }),
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
  return withLoginSession(credentials, api, ports.onAccountOpened);
}
