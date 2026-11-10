import { withJubjubOwnerSession, jubjubOwnerKeyHex } from './jubjub-binding.js';
import { readJubjubHoldings } from './jubjub-holdings.js';
import { jubjubGrantMethods } from './jubjub-grant-methods.js';
import {
  awaitJubjubDeployment,
  findJubjubCounter,
  verifyJubjubKeyring,
  awaitJubjubAdvance,
  appendJubjubInbox,
  finishJubjubReadiness,
  type JubjubReadinessHost,
} from './jubjub-readiness.js';
import {
  equal,
  samePoint,
  conflictsWithReader,
  isJubjubHint,
  requirePure,
  requireRevokePure,
} from './jubjub-binding.js';
import { createJubjubAccount } from './jubjub-creation.js';
import { withLoginSession } from './with-login-session.js';
import { snapshotDeviceReader } from './request-snapshots.js';
import { accountInboxReader, requireDeviceInbox, type InboxLedgerView } from './inbox-view.js';
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
  type ViewingKeyRotationResult,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { startFlow, type Flow } from './flow.js';

import { JUBJUB_READER_SCAN_LIMIT } from './jubjub-readers.js';
import { createJubjubViewingRotation } from './jubjub-viewing-rotation.js';
import type { JubjubHint } from './jubjub-rotation-types.js';
import type {
  AccLedgerView,
  ActiveReadGrantTarget,
  JubjubPureCircuits,
  PassportPorts,
} from './ports/index.js';

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
  const recordPure = new WeakMap<JubjubHint, JubjubPureCircuits>();
  const readiness: JubjubReadinessHost = {
    ports,
    authoriser,
    directory,
    viewingKey,
    networkId,
    readBinding,
    readChain,
    read,
    recordPure,
    sleep,
    account: (record) => account(record),
  };
  const awaitDeployed = (record: JubjubHint) => awaitJubjubDeployment(readiness, record);
  const findCounter = (record: JubjubHint, view: AccLedgerView) =>
    findJubjubCounter(readiness, record, view);
  const keyring = (record: JubjubHint, view: InboxLedgerView, pending: boolean) =>
    verifyJubjubKeyring(readiness, record, view, pending);
  const advanced = (record: JubjubHint, nonce: bigint) =>
    awaitJubjubAdvance(readiness, record, nonce);
  const append = (flow: Flow, record: JubjubHint, entry: Uint8Array, view: AccLedgerView) =>
    appendJubjubInbox(readiness, flow, record, entry, view);
  const finish = (flow: Flow, record: JubjubHint, view: InboxLedgerView) =>
    finishJubjubReadiness(readiness, flow, record, view);
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
      return withJubjubOwnerSession(
        authoriser,
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
    withOwnerSession: (operation, descriptor) =>
      withJubjubOwnerSession(authoriser, operation, descriptor),
    ownerPublicKeyHex: () => jubjubOwnerKeyHex(authoriser),
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
    ...jubjubGrantMethods(
      {
        ports,
        authoriser,
        viewingKey,
        network,
        networkId,
        readBinding,
        readChain,
        fresh,
        rotateViewingKey,
      },
      record,
    ),
    readShieldedHoldings: (options) =>
      readJubjubHoldings(
        {
          ports,
          networkId,
          network,
          viewingKey,
          authoriser,
          recordPure,
          read,
          readBinding,
          readChain,
          findCounter,
          run,
        },
        record,
        options,
      ),
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
        return withJubjubOwnerSession(
          authoriser,
          async () => {
            const publicKey = await authoriser.devicePublicKey();
            const devicePublicKey = await jubjubOwnerKeyHex(authoriser);
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
        (flow) =>
          createJubjubAccount(userName, retireAuthority, {
            ports,
            flow,
            fresh,
            sleep,
            awaitDeployed,
            finish,
            pure: async () => requirePure((await readBinding()).pureCircuits),
          }),
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
        return withJubjubOwnerSession(
          authoriser,
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
