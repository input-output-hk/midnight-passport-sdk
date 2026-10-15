import {
  PASSPORT_API_VERSION,
  type CreateAccountStep,
  type FlowOptions,
  type P256DeviceReader,
  type DeviceEnrollmentResult,
  type DeviceRemovalResult,
  type PassportGrantRevokeResult,
  type ViewingKeyRotationResult,
  type PassportAccount,
  type PassportConnectorAPI,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { grantRosterFingerprint } from './grant-roster.js';
import { validGrantId } from './grant-publication-state.js';
import { issueAndPublishP256Grant, type IssueP256GrantPure } from './p256-grant-issue.js';
import { recoverPendingP256Grants } from './p256-grant-publication.js';
import type { GrantRecoveryJournal } from './jubjub-grant-publication.js';
import { readVerifiedHoldings } from './holdings.js';
import { createJubjubAccounts } from './jubjub-connector.js';
import { resolveRegisteredReaders } from './jubjub-readers.js';
import { sealActiveReadGrants } from './read-grant-deliveries.js';
import { startFlow, type Flow } from './flow.js';
import type {
  AccLedgerView,
  AccPureCircuits,
  AccountHint,
  CurvePoint,
  Lazy,
  P256PublicKey,
  PassportPorts,
  WebAuthnPolicy,
} from './ports/index.js';

const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const requireP256GrantPure = (
  value: unknown,
): IssueP256GrantPure &
  AccPureCircuits & {
    challenge_append_inbox_with_p256: NonNullable<
      AccPureCircuits['challenge_append_inbox_with_p256']
    >;
  } => {
  const pure = value as Partial<IssueP256GrantPure & AccPureCircuits>;
  for (const name of [
    'derive_grant_id_with_jubjub',
    'derive_grant_object_commit',
    'derive_grant_scope_digest',
    'derive_device_entry_with_p256',
    'challenge_issue_grant_with_p256',
    'challenge_append_inbox_with_p256',
  ] as const)
    if (typeof pure[name] !== 'function')
      throw new PassportConnectorError('BindingUnsupported', `ACC binding lacks ${name}.`);
  return pure as IssueP256GrantPure &
    AccPureCircuits & {
      challenge_append_inbox_with_p256: NonNullable<
        AccPureCircuits['challenge_append_inbox_with_p256']
      >;
    };
};

/**
 * The rescan probes use counters 0..RESCAN_LIMIT-1 (MIP-0013 S11). The prototype always starts at 0,
 * so an account allows 64 authorised calls per passkey entry.
 */
export const RESCAN_LIMIT = 64;

/**
 * Retries of the `deployed` registry write after a deploy (Final review M2). The salt it records is
 * the only way to activate the account, so one lost write would orphan a 10-wave deployment. The
 * write is idempotent (an identical re-PUT answers 204), so retrying it is safe.
 */
export const DEPLOYED_PUT_RETRIES = 3;
const RETRY_BASE_MS = 200;
/** Both browsers and Node have `setTimeout`; the package compiles without either's types. */
const timers = globalThis as unknown as { setTimeout(run: () => void, ms: number): unknown };
const sleep = (ms: number) => new Promise<void>((resolve) => timers.setTimeout(resolve, ms));
/** Web Crypto's generator, which browsers and Node both have. */
const webRandom = (length: number) =>
  (
    globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(new Uint8Array(length));

/** A hint for the P-256 arm. */
type P256Hint = AccountHint & {
  readonly credentialId: Uint8Array;
  readonly policy: WebAuthnPolicy;
  /** Active address-based recovery has no local creation entries, but validates the ledger envelope. */
  readonly sealed?: true;
};
const isP256 = (hint: AccountHint): hint is P256Hint =>
  hint.scheme === 'p256-webauthn' && hint.credentialId !== undefined && hint.policy !== undefined;
type SealedP256Hint = P256Hint &
  ({ readonly keyEntries: readonly Uint8Array[] } | { readonly sealed: true });
const validSealedEntries = (entries: readonly Uint8Array[] | undefined): boolean =>
  entries?.length === 2 &&
  entries[0]?.length === 192 &&
  entries[0][0] === 0xd1 &&
  (entries[0][1] === 1 || entries[0][1] === 2) &&
  entries[1]?.length === 192 &&
  (entries[1][0] === 0xd4 || entries[1][0] === 0xd5) &&
  entries[1][1] === entries[0][1];
const isSealedP256 = (hint: P256Hint): hint is SealedP256Hint =>
  validSealedEntries(hint.keyEntries) || (hint.status === 'active' && hint.sealed === true);
/** The circuits' P-256 key; a point that already is one passes as is, so the same key reaches the chain. */
const p256 = (point: CurvePoint): P256PublicKey =>
  (point as Partial<P256PublicKey>).identity === false
    ? (point as P256PublicKey)
    : { x: point.x, y: point.y, identity: false };

/**
 * Whether the open-time `enc_key` check (lace-platform's `encryption-key-mismatch`) can run. The
 * ACC keeps no epoch for `enc_key`: the constructor sets it, and only `rotate_enc_key_with_*`
 * changes it, each gated and so each advancing `auth_nonce` (spec_version 2). While `auth_nonce`
 * is 0 no gated call has run, so `enc_key` must still be the key the passkey derives; after one,
 * it may have been rotated (to a random key, in the prototype), and the check is skipped rather
 * than refusing a rotated account. Skipped too when the reader does not report `enc_key`, or for a
 * spec_version whose rules this release does not know.
 */
const encKeyComparable = (
  view: AccLedgerView,
): view is AccLedgerView & { readonly encKey: Uint8Array } =>
  view.encKey !== undefined && view.authNonce === 0n && view.specVersion === 2;

/** Loads a `Lazy` port on first use, once; a failed load is retried on the next use. */
function once<T>(value: Lazy<T>): () => Promise<T> {
  if (typeof value !== 'function') return () => Promise.resolve(value);
  const load = value as () => Promise<T>;
  let pending: Promise<T> | undefined;
  return () =>
    (pending ??= load().catch((e: unknown) => {
      pending = undefined;
      throw e;
    }));
}

/** The account API over the ports (design §1.3, §2.1). */
export function createPassportAccounts(ports: PassportPorts): PassportConnectorAPI {
  if (ports.authoriser.scheme === 'jubjub-schnorr') return createJubjubAccounts(ports);
  const { authoriser, credentials, directory, encryptionKey, network, viewingKey } = ports;
  const { networkId } = network;
  if (authoriser.scheme !== 'p256-webauthn' || !authoriser.deviceBinding) {
    throw new PassportConnectorError(
      'BindingUnsupported',
      'The selected authorisation arm needs a compatible authoriser and binding.',
    );
  }
  const binding = once(ports.binding);
  const chain = once(ports.chain);
  const random = ports.random ?? webRandom;
  /** Records what the chain already holds, so it runs even once the flow is aborted. */
  const put = (flow: Flow, record: P256Hint) =>
    flow.step('directory.write', async () => directory?.put(networkId, record), 'always');
  /** Flows run through `run`: their events, their abort checks and their errors (design §3.3, §3.4). */
  const run = async <T>(
    options: FlowOptions,
    body: (flow: Flow) => Promise<T>,
    onProgress?: (step: CreateAccountStep) => void,
  ): Promise<T> => {
    const flow = startFlow(options, random, onProgress);
    try {
      return await body(flow);
    } catch (e) {
      throw flow.fail(e);
    }
  };

  const submitActivation = (flow: Flow, record: P256Hint) =>
    flow.step('activate', async () =>
      (await chain()).call({
        address: record.address,
        circuit: 'activate_initial_device_with_p256',
        args: [p256(record.publicKey), record.salt, record.policy],
        ...flow.ports,
      }),
    );

  const activate = async (flow: Flow, record: P256Hint): Promise<P256Hint> => {
    await submitActivation(flow, record);
    const active: P256Hint = { ...record, status: 'active' };
    await put(flow, active);
    return active;
  };

  const recordDeployed = (flow: Flow, record: P256Hint) =>
    flow.step(
      'directory.write',
      async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await directory?.put(networkId, record);
          } catch (e) {
            if (attempt >= DEPLOYED_PUT_RETRIES) {
              throw new PassportConnectorError(
                'InternalError',
                `The account at ${record.address} is deployed, but the registry did not record it after ${attempt + 1} attempts: ${e instanceof Error ? e.message : String(e)}`,
                { cause: e },
              );
            }
            await sleep(RETRY_BASE_MS * 2 ** attempt);
          }
        }
      },
      'always',
    );

  const readAccount = async (record: P256Hint): Promise<AccLedgerView> => {
    const view = await (
      await chain()
    ).readAccount(record.address, {
      includeInbox: viewingKey !== undefined,
    });
    if (!view)
      throw new PassportConnectorError('AccountNotFound', `No contract at ${record.address}.`);
    return view;
  };
  const readView = (flow: Flow, record: P256Hint) =>
    flow.step('chain.read', () => readAccount(record));

  /** The 0..RESCAN_LIMIT-1 counter scan: the counter of this passkey's live entry, if any. */
  const findCounter = (flow: Flow, record: P256Hint, view: AccLedgerView) =>
    flow.step('counter.scan', async (): Promise<bigint | undefined> => {
      const { pureCircuits } = await binding();
      const self = { bytes: fromHex(record.address) };
      for (let k = 0n; k < BigInt(RESCAN_LIMIT); k++) {
        const entry = pureCircuits.derive_device_entry_with_p256(
          self,
          p256(record.publicKey),
          record.policy,
          view.deviceEpoch,
          k,
        );
        if (view.hasEntry(entry)) return k;
      }
      return undefined;
    });

  const notHeld = (record: P256Hint) =>
    new PassportConnectorError(
      'AccountNotFound',
      `The account at ${record.address} does not hold this passkey.`,
    );

  const useCounter = async (
    flow: Flow,
    record: P256Hint,
  ): Promise<{ counter: bigint; authNonce: bigint }> => {
    const view = await readView(flow, record);
    const counter = await findCounter(flow, record, view);
    if (counter === undefined) {
      throw new PassportConnectorError(
        'AccountNotFound',
        'This passkey has no live entry on the account.',
      );
    }
    return { counter, authNonce: view.authNonce };
  };

  /**
   * Completes a 'deployed' record whose passkey `openAccount` has already verified. Activation may
   * already have landed on-chain while its response or the registry write was lost, so a booted
   * ledger is adopted instead of activating a second time, but only once it holds this passkey.
   * An unbooted ledger is activated: its boot commitment binds pk, salt and policy on chain, so a
   * mismatched record cannot activate someone else's account, and the entry is checked afterwards
   * all the same before the record is marked active.
   */
  const finishActivation = async (
    flow: Flow,
    record: P256Hint,
    view: AccLedgerView,
  ): Promise<P256Hint> => {
    if (!view.booted) {
      await submitActivation(flow, record);
      const after = await readView(flow, record);
      if ((await findCounter(flow, record, after)) === undefined) throw notHeld(record);
    }
    const active: P256Hint = { ...record, status: 'active' };
    await put(flow, active);
    return active;
  };

  const sealedKeyring = async (
    record: SealedP256Hint,
    view: AccLedgerView,
    pending: boolean,
    inOwnerSession = false,
  ) => {
    const keyring = viewingKey;
    const devicePublicKeyHex = authoriser.devicePublicKeyHex?.bind(authoriser);
    const { encKey, inboxEntries } = view;
    if (!keyring || !devicePublicKeyHex || !encKey || !inboxEntries)
      throw new PassportConnectorError(
        'BindingUnsupported',
        'P-256 sealed accounts need an inbox reader, keyring and compressed device key.',
      );
    if (pending && !validSealedEntries(record.keyEntries))
      throw new PassportConnectorError(
        'BindingUnsupported',
        'The pending ACC has no sealed creation entries.',
      );
    const entries = pending ? [...inboxEntries, ...record.keyEntries!] : [...inboxEntries];
    const check = async () => {
      const opened = await keyring.openInbox(
        networkId,
        { account: record.address, encKey, envelopes: entries.reverse() },
        pending ? record.keyEntries! : [],
      );
      if (pending) {
        const device = opened[1];
        const reader = await keyring.readerPublicKey(networkId);
        const deviceKey = await devicePublicKeyHex();
        if (
          device?.kind !== 'device' ||
          device.device.scheme !== 'p256-webauthn' ||
          device.device.readerPublicKey !== toHex(reader) ||
          device.device.devicePublicKey !== deviceKey ||
          (device.device.policy !== undefined &&
            (!equalBytes(device.device.policy.rp_id_hash, record.policy.rp_id_hash) ||
              !equalBytes(device.device.policy.origin, record.policy.origin)))
        )
          throw new Error('the sealed registration does not name this device');
      }
    };
    try {
      if (authoriser.withKeySession && !inOwnerSession)
        await authoriser.withKeySession(check, { kind: 'sign-in', account: record.address });
      else await check();
    } catch (cause) {
      throw new PassportConnectorError(
        'EncryptionKeyMismatch',
        'No sealed envelope for this passkey opens the ACC encryption key.',
        { cause },
      );
    }
  };

  const awaitSealedView = async (
    record: SealedP256Hint,
    ready: (view: AccLedgerView) => boolean,
  ): Promise<AccLedgerView> => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const view = await (await chain()).readAccount(record.address, { includeInbox: true });
      if (view && ready(view)) return view;
      await sleep(1000);
    }
    throw new PassportConnectorError(
      'InternalError',
      'The sealed ACC call did not appear on chain.',
    );
  };

  const appendP256 = async (
    flow: Flow,
    record: SealedP256Hint,
    entry: Uint8Array,
    view: AccLedgerView,
  ): Promise<AccLedgerView> => {
    const pure = (await binding()).pureCircuits;
    if (!pure.challenge_append_inbox_with_p256)
      throw new PassportConnectorError('BindingUnsupported', 'ACC lacks P-256 inbox signing.');
    const counter = await findCounter(flow, record, view);
    if (counter === undefined) throw notHeld(record);
    const circuit = 'append_inbox_with_p256';
    const challenge = pure.challenge_append_inbox_with_p256(
      { bytes: fromHex(record.address) },
      p256(record.publicKey),
      entry,
      view.authNonce,
    );
    const signed = await flow.step('passkey.sign', () =>
      authoriser.authorise({
        account: record.address,
        circuit,
        args: [entry],
        witnessValues: [],
        authNonce: view.authNonce,
        useCounter: counter,
        challenge,
        credentialId: record.credentialId,
      }),
    );
    if (
      signed.scheme !== 'p256-webauthn' ||
      signed.useCounter !== counter ||
      signed.pk.x !== record.publicKey.x ||
      signed.pk.y !== record.publicKey.y
    )
      throw new PassportConnectorError('NotAuthorised', 'The signature names another device.');
    flow.checkpoint();
    await (
      await chain()
    ).call({
      address: record.address,
      circuit,
      args: [
        entry,
        {
          pk: p256(record.publicKey),
          policy: record.policy,
          authenticator_data: signed.authenticatorData,
          sig: signed.sig,
          use_counter: counter,
        },
      ],
      ...flow.ports,
    });
    return awaitSealedView(record, (candidate) => candidate.authNonce > view.authNonce);
  };

  const finishSealed = async (flow: Flow, record: SealedP256Hint): Promise<P256Hint> => {
    let view = await awaitSealedView(record, (candidate) =>
      Boolean(candidate.encKey && candidate.inboxEntries),
    );
    const pending = record.status === 'deployed';
    await sealedKeyring(record, view, pending);
    if (!view.booted) {
      if (!pending) throw new PassportConnectorError('AccountNotFound', 'The ACC is not booted.');
      await submitActivation(flow, record);
      view = await awaitSealedView(record, (candidate) => candidate.booted);
    }
    if ((await findCounter(flow, record, view)) === undefined) throw notHeld(record);
    if (pending) {
      for (const entry of record.keyEntries!) {
        if (view.inboxEntries?.some((held) => equalBytes(held, entry))) continue;
        view = await appendP256(flow, record, entry, view);
      }
    }
    await sealedKeyring(record, view, false);
    const active: P256Hint = { ...record, status: 'active' };
    if (pending) await put(flow, active);
    const counter = await findCounter(flow, active, view);
    if (counter === undefined) throw notHeld(active);
    await ports.records?.write({
      address: active.address,
      bindingId: network.bindingId,
      scheme: 'p256-webauthn',
      credentialId: active.credentialId.slice(),
      localUseCounter: counter,
    });
    return active;
  };

  const addP256Device = (record: P256Hint, reader: P256DeviceReader, options: FlowOptions = {}) =>
    run(options, async (flow): Promise<DeviceEnrollmentResult> => {
      const keyring = viewingKey;
      const decode = keyring?.decodeP256DevicePublicKey;
      const pure = (await binding()).pureCircuits;
      if (
        !isSealedP256(record) ||
        !keyring ||
        !decode ||
        !pure.challenge_add_device_with_p256 ||
        !ports.readGrants ||
        !authoriser.withKeySession
      )
        throw new PassportConnectorError(
          'BindingUnsupported',
          'P-256 enrollment needs a sealed keyring, P-256 decoder, key session and live read-grant source.',
        );
      if (
        !/^[0-9a-f]{64}$/.test(reader.readerPublicKey) ||
        !reader.policy ||
        !(reader.policy.rp_id_hash instanceof Uint8Array) ||
        reader.policy.rp_id_hash.length !== 32 ||
        !(reader.policy.origin instanceof Uint8Array) ||
        reader.policy.origin.length !== 21
      )
        throw new PassportConnectorError(
          'DeviceRosterInvalid',
          'The joining reader or WebAuthn policy is malformed.',
        );
      const point = decode(reader.devicePublicKey);
      if (!point || (point.x === record.publicKey.x && point.y === record.publicKey.y))
        throw new PassportConnectorError(
          'DeviceRosterInvalid',
          'The joining key must identify another valid P-256 device.',
        );
      const read = async () => {
        const view = await flow.step('chain.read', async () =>
          (await chain()).readAccount(record.address, { includeInbox: true, includeDevices: true }),
        );
        if (!view) throw new PassportConnectorError('AccountNotFound', 'The ACC is absent.');
        if (!view.encKey || !view.inboxEntries || !view.deviceEntries)
          throw new PassportConnectorError(
            'BindingUnsupported',
            'The chain port omits ACC roster or inbox data.',
          );
        return view as AccLedgerView & {
          readonly encKey: Uint8Array;
          readonly inboxEntries: readonly Uint8Array[];
          readonly deviceEntries: readonly Uint8Array[];
        };
      };
      let initial = await read();
      if (!initial.booted || record.status !== 'active')
        throw new PassportConnectorError('AccountNotFound', 'The P-256 ACC is not active.');
      if (initial.specVersion !== 3)
        throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
      let initialCounter = await findCounter(flow, record, initial);
      if (initialCounter === undefined) throw notHeld(record);
      const self = { bytes: fromHex(record.address) };
      const ownerEntry = (counter: bigint) =>
        pure.derive_device_entry_with_p256(
          self,
          p256(record.publicKey),
          record.policy,
          initial.deviceEpoch,
          counter,
        );
      const otherEntries = (entries: readonly Uint8Array[], own: Uint8Array) =>
        entries
          .filter((entry) => !equalBytes(entry, own))
          .map(toHex)
          .sort();
      let baseline = otherEntries(initial.deviceEntries, ownerEntry(initialCounter));
      const target = pure.derive_device_entry_with_p256(
        { bytes: fromHex(record.address) },
        point,
        reader.policy,
        initial.deviceEpoch,
        0n,
      );
      if (initial.deviceEntries.some((held) => equalBytes(held, target)))
        throw new PassportConnectorError(
          'DeviceRosterInvalid',
          'The joining device is already live.',
        );
      let grants = await flow.step('grant.roster', () =>
        ports.readGrants!.readActiveReadGrantTargets(record.address),
      );
      if (grants.authNonce !== initial.authNonce)
        throw new PassportConnectorError('GrantRosterUnsettled', 'The read-grant roster is stale.');
      const grantFingerprint = (targets: typeof grants.targets) =>
        targets.map(({ grantId, readPublicKey }) => `${grantId}:${readPublicKey ?? ''}`).sort();
      return authoriser.withKeySession(
        async () => {
          const selected = await authoriser.devicePublicKey();
          const selectedBinding = await authoriser.deviceBinding!();
          if (
            selected.x !== record.publicKey.x ||
            selected.y !== record.publicKey.y ||
            !equalBytes(selectedBinding.credentialId, record.credentialId) ||
            !equalBytes(selectedBinding.policy.rp_id_hash, record.policy.rp_id_hash) ||
            !equalBytes(selectedBinding.policy.origin, record.policy.origin)
          )
            throw new PassportConnectorError(
              'NotAuthorised',
              'The selected passkey does not own this ACC.',
            );
          if (reader.readerPublicKey === toHex(await keyring.readerPublicKey(networkId)))
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The joining reader is the owner.',
            );
          let rotation: ViewingKeyRotationResult | DeviceRemovalResult | undefined;
          if (grants.targets.length) {
            const beforeRotation = await read();
            const beforeRoster = otherEntries(
              beforeRotation.deviceEntries,
              ownerEntry(initialCounter!),
            );
            const approvedGrants = await flow.step('grant.roster', () =>
              ports.readGrants!.readActiveReadGrantTargets(record.address),
            );
            if (
              beforeRotation.authNonce !== initial.authNonce ||
              beforeRotation.deviceEpoch !== initial.deviceEpoch ||
              !equalBytes(beforeRotation.encKey, initial.encKey) ||
              beforeRoster.length !== baseline.length ||
              beforeRoster.some((entry, index) => entry !== baseline[index]) ||
              beforeRotation.deviceEntries.some((held) => equalBytes(held, target)) ||
              approvedGrants.authNonce !== initial.authNonce ||
              JSON.stringify(grantFingerprint(approvedGrants.targets)) !==
                JSON.stringify(grantFingerprint(grants.targets))
            )
              throw new PassportConnectorError(
                'GrantRosterUnsettled',
                'The ACC or read-grant roster changed before enrollment rotation.',
              );
            // The joiner must never receive the old viewing or roster keys while a read grant is
            // live. Rotate under the add-device consent session, preserve every grantee, then
            // deliver only the fresh keys to the joiner before enrolling it.
            rotation = await rotateP256ViewingKey(
              record,
              options,
              undefined,
              undefined,
              undefined,
              { requireAllGrants: true, inOwnerSession: true, rotateRosterForEnrollment: true },
            );
            initial = await read();
            if (
              initial.deviceEpoch !== beforeRotation.deviceEpoch ||
              initial.authNonce <= beforeRotation.authNonce ||
              equalBytes(initial.encKey, beforeRotation.encKey)
            )
              throw new PassportConnectorError(
                'DeviceRosterInvalid',
                'The ACC did not settle the expected enrollment rotation.',
              );
            initialCounter = await findCounter(flow, record, initial);
            if (initialCounter === undefined) throw notHeld(record);
            const rotatedRoster = otherEntries(initial.deviceEntries, ownerEntry(initialCounter));
            if (
              rotatedRoster.length !== baseline.length ||
              rotatedRoster.some((entry, index) => entry !== baseline[index])
            )
              throw new PassportConnectorError(
                'DeviceRosterInvalid',
                'The live device roster changed during enrollment rotation.',
              );
            baseline = rotatedRoster;
            const latest = await flow.step('grant.roster', () =>
              ports.readGrants!.readActiveReadGrantTargets(record.address),
            );
            if (
              latest.authNonce !== initial.authNonce ||
              JSON.stringify(grantFingerprint(latest.targets)) !==
                JSON.stringify(grantFingerprint(grants.targets))
            )
              throw new PassportConnectorError(
                'GrantRosterUnsettled',
                'The read-grant roster changed during enrollment rotation.',
              );
            grants = latest;
          }
          let view = await read();
          if (
            view.authNonce !== initial.authNonce ||
            view.deviceEpoch !== initial.deviceEpoch ||
            !equalBytes(view.encKey!, initial.encKey!)
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The ACC changed before enrollment.',
            );
          await sealedKeyring(record, view, false, true);
          const oldKeyring = {
            account: record.address,
            encKey: view.encKey!,
            envelopes: [...view.inboxEntries!].reverse(),
          };
          const opened = await keyring.openInbox(networkId, oldKeyring, view.inboxEntries!);
          if (opened.length !== view.inboxEntries!.length)
            throw new PassportConnectorError(
              'InternalError',
              'The keyring returned an incomplete inbox.',
            );
          if (
            opened.some(
              (item) =>
                item?.kind === 'device' &&
                (item.device.readerPublicKey === reader.readerPublicKey ||
                  item.device.devicePublicKey === reader.devicePublicKey) &&
                (item.device.readerPublicKey !== reader.readerPublicKey ||
                  item.device.devicePublicKey !== reader.devicePublicKey ||
                  !item.device.policy ||
                  !equalBytes(item.device.policy.rp_id_hash, reader.policy.rp_id_hash) ||
                  !equalBytes(item.device.policy.origin, reader.policy.origin)),
            )
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The joining reader or signing key conflicts with the roster.',
            );
          const delivery = await keyring.sealToDevice(networkId, oldKeyring, {
            ...reader,
            epoch: view.deviceEpoch,
            counter: 0n,
          });
          await appendP256(flow, record, delivery.envelope, view);
          view = await read();
          await appendP256(flow, record, delivery.registration, view);
          view = await read();
          if (
            view.deviceEpoch !== initial.deviceEpoch ||
            !equalBytes(view.encKey!, initial.encKey!) ||
            ![delivery.envelope, delivery.registration].every((sealed) =>
              view.inboxEntries!.some((held) => equalBytes(held, sealed)),
            )
          )
            throw new PassportConnectorError(
              'EncryptionKeyMismatch',
              'The key delivery did not settle.',
            );
          if (view.deviceEntries!.some((held) => equalBytes(held, target)))
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The joining device became live.',
            );
          const latestGrants = await flow.step('grant.roster', () =>
            ports.readGrants!.readActiveReadGrantTargets(record.address),
          );
          if (
            latestGrants.authNonce !== view.authNonce ||
            JSON.stringify(grantFingerprint(latestGrants.targets)) !==
              JSON.stringify(grantFingerprint(grants.targets))
          )
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'The read-grant roster changed.',
            );
          const counter = await findCounter(flow, record, view);
          if (counter === undefined) throw notHeld(record);
          const current = otherEntries(view.deviceEntries!, ownerEntry(counter));
          if (
            current.length !== baseline.length ||
            current.some((entry, index) => entry !== baseline[index])
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The live device roster changed during delivery.',
            );
          const circuit = 'add_device_with_p256';
          const challenge = pure.challenge_add_device_with_p256!(
            { bytes: fromHex(record.address) },
            p256(record.publicKey),
            target,
            view.authNonce,
          );
          const signed = await flow.step('passkey.sign', () =>
            authoriser.authorise({
              account: record.address,
              circuit,
              args: [target],
              witnessValues: [],
              authNonce: view.authNonce,
              useCounter: counter,
              challenge,
              credentialId: record.credentialId,
            }),
          );
          if (
            signed.scheme !== 'p256-webauthn' ||
            signed.useCounter !== counter ||
            signed.pk.x !== record.publicKey.x ||
            signed.pk.y !== record.publicKey.y
          )
            throw new PassportConnectorError(
              'NotAuthorised',
              'The signature names another device.',
            );
          flow.checkpoint();
          const tx = await (
            await chain()
          ).call({
            address: record.address,
            circuit,
            args: [
              target,
              {
                pk: p256(record.publicKey),
                policy: record.policy,
                authenticator_data: signed.authenticatorData,
                sig: signed.sig,
                use_counter: counter,
              },
            ],
            ...flow.ports,
          });
          for (let attempt = 0; attempt < 30; attempt++) {
            flow.checkpoint();
            const settled = await read();
            if (
              settled.authNonce > view.authNonce &&
              settled.deviceEntries.some((held) => equalBytes(held, target))
            )
              return {
                ...tx,
                commitmentHex: toHex(target),
                nextUseCounter: counter + 1n,
                ...(rotation && {
                  rotationTxHash: rotation.txHash,
                  sealedReadGrants: rotation.sealedReadGrants,
                }),
              };
            if (attempt < 29) await sleep(1000);
          }
          throw new PassportConnectorError(
            'DeviceRosterInvalid',
            'The enrollment did not appear in the live ACC set.',
          );
        },
        { kind: 'add-device', account: record.address, commitmentHex: toHex(target), reader },
      );
    });

  const rotateP256ViewingKey = (
    record: P256Hint,
    options: FlowOptions = {},
    removal?: string,
    excludedGrant?: string | 'all',
    onRotated?: (state: { readonly encKey: Uint8Array; readonly authNonce: bigint }) => void,
    controls: {
      readonly requireAllGrants?: boolean;
      readonly inOwnerSession?: boolean;
      readonly rotateRosterForEnrollment?: boolean;
    } = {},
  ) =>
    run(options, async (flow): Promise<ViewingKeyRotationResult | DeviceRemovalResult> => {
      const keyring = viewingKey;
      const reencrypt = keyring?.reencryptInbox;
      const decodeJubjub = keyring?.decodeDevicePublicKey;
      const decodeP256 = keyring?.decodeP256DevicePublicKey;
      const pure = (await binding()).pureCircuits;
      if (
        !isSealedP256(record) ||
        !keyring ||
        !reencrypt ||
        !decodeJubjub ||
        !decodeP256 ||
        !pure.derive_device_entry_with_jubjub ||
        !pure.challenge_append_inbox_with_p256 ||
        (removal !== undefined && !pure.challenge_remove_device_with_p256) ||
        !ports.holdings ||
        !ports.readGrants ||
        !authoriser.withKeySession ||
        !authoriser.deviceBinding ||
        !authoriser.devicePublicKeyHex
      )
        throw new PassportConnectorError(
          'BindingUnsupported',
          'P-256 rotation needs sealed keys, both device decoders, verified holdings and a complete read-grant source.',
        );
      if (removal !== undefined && !/^[0-9a-f]{64}$/i.test(removal))
        throw new PassportConnectorError(
          'RemovalTargetNotFound',
          'The target must be a 32-byte device commitment.',
        );
      const target = removal === undefined ? undefined : fromHex(removal.toLowerCase());
      const read = async () => {
        const view = await flow.step('chain.read', async () =>
          (await chain()).readAccount(record.address, { includeInbox: true, includeDevices: true }),
        );
        if (!view) throw new PassportConnectorError('AccountNotFound', 'The ACC is absent.');
        if (!view.encKey || !view.inboxEntries || !view.deviceEntries)
          throw new PassportConnectorError(
            'BindingUnsupported',
            'The chain port omits the ACC key, inbox or live devices.',
          );
        return view as AccLedgerView & {
          readonly encKey: Uint8Array;
          readonly inboxEntries: readonly Uint8Array[];
          readonly deviceEntries: readonly Uint8Array[];
        };
      };
      const withSession: NonNullable<typeof authoriser.withKeySession> = controls.inOwnerSession
        ? (operation) => operation()
        : (operation, descriptor) => authoriser.withKeySession!(operation, descriptor);
      return withSession(
        async () => {
          const selected = await authoriser.devicePublicKey();
          const selectedBinding = await authoriser.deviceBinding!();
          if (
            selected.x !== record.publicKey.x ||
            selected.y !== record.publicKey.y ||
            !equalBytes(selectedBinding.credentialId, record.credentialId) ||
            !equalBytes(selectedBinding.policy.rp_id_hash, record.policy.rp_id_hash) ||
            !equalBytes(selectedBinding.policy.origin, record.policy.origin)
          )
            throw new PassportConnectorError(
              'NotAuthorised',
              'The selected passkey does not own this ACC.',
            );
          let view = await read();
          if (!view.booted || record.status !== 'active')
            throw new PassportConnectorError('AccountNotFound', 'The P-256 ACC is not active.');
          if (view.specVersion !== 3)
            throw new PassportConnectorError(
              'BindingUnsupported',
              'The ACC spec version is not 3.',
            );
          const initialCounter = await findCounter(flow, record, view);
          if (initialCounter === undefined) throw notHeld(record);
          if (target) {
            const own = pure.derive_device_entry_with_p256(
              { bytes: fromHex(record.address) },
              p256(record.publicKey),
              record.policy,
              view.deviceEpoch,
              initialCounter,
            );
            if (equalBytes(target, own))
              throw new PassportConnectorError('LastDevice', 'A device cannot remove itself.');
            if (!view.deviceEntries.some((entry) => equalBytes(entry, target)))
              throw new PassportConnectorError('RemovalTargetNotFound', 'The target is not live.');
          }
          await sealedKeyring(record, view, false, true);
          const oldEntries = [...view.inboxEntries];
          const oldKeyring = {
            account: record.address,
            encKey: view.encKey,
            envelopes: [...oldEntries].reverse(),
          };
          const opened = await keyring.openInbox(networkId, oldKeyring, oldEntries);
          if (opened.length !== oldEntries.length)
            throw new PassportConnectorError(
              'InternalError',
              'The keyring returned an incomplete inbox.',
            );
          const ownerReader = toHex(await keyring.readerPublicKey(networkId));
          const ownerDevice = await authoriser.devicePublicKeyHex!();
          const roster = resolveRegisteredReaders({
            account: record.address,
            epoch: view.deviceEpoch,
            registered: opened.flatMap((item) => (item?.kind === 'device' ? [item.device] : [])),
            liveEntries: view.deviceEntries,
            ...(target && {
              allowedEntries: view.deviceEntries.filter((entry) => !equalBytes(entry, target)),
            }),
            pure: { derive_device_entry_with_jubjub: pure.derive_device_entry_with_jubjub! },
            p256Pure: pure,
            decodeDevicePublicKey: decodeJubjub,
            decodeP256DevicePublicKey: decodeP256,
          });
          if (
            roster.dropped.length ||
            !roster.readers.some(
              (reader) =>
                reader.readerPublicKey === ownerReader &&
                reader.devicePublicKey === ownerDevice &&
                reader.scheme === 'p256-webauthn' &&
                reader.policy &&
                equalBytes(reader.policy.rp_id_hash, record.policy.rp_id_hash) &&
                equalBytes(reader.policy.origin, record.policy.origin),
            )
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'Every live device needs one unique registered reader before rotation.',
            );
          const removedReader = target ? roster.outside[0] : undefined;
          if (
            target &&
            (roster.outside.length !== 1 ||
              !removedReader ||
              roster.readers.some(
                (survivor) =>
                  survivor.readerPublicKey === removedReader.readerPublicKey ||
                  survivor.devicePublicKey === removedReader.devicePublicKey,
              ))
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The removed device needs one distinct registered reader.',
            );
          const initial = view;
          const held = await ports.holdings!.selectHeldEntries(record.address, oldEntries, opened);
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
          const keys = await keyring.createKeys(networkId, {
            scheme: 'p256-webauthn',
            devicePublicKey: ownerDevice,
            policy: record.policy,
            keyring: oldKeyring,
            registrations,
            readers: roster.readers.filter((reader) => reader.readerPublicKey !== ownerReader),
            ...((target || controls.rotateRosterForEnrollment) && { rotateRoster: true }),
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
              'A verified holding could not be resealed.',
            );
          const deliveries = await sealActiveReadGrants(
            {
              networkId,
              keyring: { account: record.address, encKey: keys.encKey, envelopes: keys.envelopes },
              authNonce: view.authNonce,
              ...(excludedGrant === 'all' && { exceptAll: true }),
              ...(excludedGrant && excludedGrant !== 'all' && { exceptGrantId: excludedGrant }),
              ...flow.ports,
            },
            { targets: ports.readGrants!, viewingKey: keyring, random },
          );
          if (
            excludedGrant &&
            excludedGrant !== 'all' &&
            !deliveries.targets.some(({ grantId }) => grantId === excludedGrant)
          )
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'The read grant disappeared before key rotation.',
            );
          if (
            (target || (excludedGrant && excludedGrant !== 'all') || controls.requireAllGrants) &&
            deliveries.unsealedGrantIds.length
          )
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'A surviving read grantee cannot receive the fresh key.',
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
          const appended = [
            ...keys.envelopes,
            ...keys.registrations,
            ...deliveries.sealed.map(({ entry }) => entry),
          ];
          for (const entry of appended) {
            await appendP256(flow, record, entry, view);
            view = await read();
          }
          if (
            !equalBytes(view.encKey, initial.encKey) ||
            view.deviceEpoch !== initial.deviceEpoch ||
            view.authNonce !== initial.authNonce + BigInt(appended.length)
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The ACC changed during key delivery.',
            );
          const ownerEntry = (counter: bigint) =>
            pure.derive_device_entry_with_p256(
              { bytes: fromHex(record.address) },
              p256(record.publicKey),
              record.policy,
              view.deviceEpoch,
              counter,
            );
          const other = (entries: readonly Uint8Array[], own: Uint8Array) =>
            entries
              .filter((entry) => !equalBytes(entry, own))
              .map(toHex)
              .sort();
          const counter = await findCounter(flow, record, view);
          if (counter === undefined) throw notHeld(record);
          const baseline = other(initial.deviceEntries, ownerEntry(initialCounter));
          const current = other(view.deviceEntries, ownerEntry(counter));
          if (
            baseline.length !== current.length ||
            current.some((entry, i) => entry !== baseline[i])
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The live device roster changed.',
            );
          const expected = new Map<string, number>();
          for (const entry of [...oldEntries, ...appended]) {
            const value = toHex(entry);
            expected.set(value, (expected.get(value) ?? 0) + 1);
          }
          for (const entry of view.inboxEntries) {
            const value = toHex(entry);
            const count = expected.get(value) ?? 0;
            if (!count)
              throw new PassportConnectorError(
                'InternalError',
                'The ACC inbox changed during delivery.',
              );
            expected.set(value, count - 1);
          }
          if ([...expected.values()].some((count) => count !== 0))
            throw new PassportConnectorError(
              'InternalError',
              'The ACC inbox lost a sealed delivery.',
            );
          const latestGrants = await flow.step('grant.roster', () =>
            ports.readGrants!.readActiveReadGrantTargets(record.address),
          );
          const targetKey = (targets: readonly { grantId: string; readPublicKey?: string }[]) =>
            targets.map(({ grantId, readPublicKey }) => `${grantId}:${readPublicKey ?? ''}`).sort();
          if (
            latestGrants.authNonce !== view.authNonce ||
            JSON.stringify(targetKey(latestGrants.targets)) !==
              JSON.stringify(targetKey(deliveries.targets))
          )
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'The read-grant roster changed.',
            );
          const circuit = 'rotate_enc_key_with_p256';
          const challenge = pure.challenge_rotate_enc_key_with_p256(
            { bytes: fromHex(record.address) },
            p256(record.publicKey),
            keys.encKey,
            view.authNonce,
          );
          const signed = await flow.step('passkey.sign', () =>
            authoriser.authorise({
              account: record.address,
              circuit,
              args: [keys.encKey],
              witnessValues: [],
              authNonce: view.authNonce,
              useCounter: counter,
              challenge,
              credentialId: record.credentialId,
            }),
          );
          if (
            signed.scheme !== 'p256-webauthn' ||
            signed.useCounter !== counter ||
            signed.pk.x !== record.publicKey.x ||
            signed.pk.y !== record.publicKey.y
          )
            throw new PassportConnectorError(
              'NotAuthorised',
              'The signature names another device.',
            );
          flow.checkpoint();
          const tx = await (
            await chain()
          ).call({
            address: record.address,
            circuit,
            args: [
              keys.encKey,
              {
                pk: p256(record.publicKey),
                policy: record.policy,
                authenticator_data: signed.authenticatorData,
                sig: signed.sig,
                use_counter: counter,
              },
            ],
            ...flow.ports,
          });
          let rotatedView = await awaitSealedView(
            record,
            (candidate) =>
              candidate.authNonce > latestGrants.authNonce &&
              candidate.encKey !== undefined &&
              equalBytes(candidate.encKey, keys.encKey),
          );
          for (const entry of reencrypted)
            rotatedView = await appendP256(flow, record, entry!, rotatedView);
          onRotated?.({ encKey: keys.encKey, authNonce: rotatedView.authNonce });
          const rotation = {
            ...tx,
            droppedDeviceEntries: [],
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
          if (!target) return rotation;
          const beforeRemoval = await read();
          if (
            !beforeRemoval.deviceEntries.some((entry) => equalBytes(entry, target)) ||
            !equalBytes(beforeRemoval.encKey, keys.encKey)
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The removal target or ACC key changed.',
            );
          const removeCounter = await findCounter(flow, record, beforeRemoval);
          if (removeCounter === undefined) throw notHeld(record);
          const removeCircuit = 'remove_device_with_p256';
          const removeChallenge = pure.challenge_remove_device_with_p256!(
            { bytes: fromHex(record.address) },
            p256(record.publicKey),
            target,
            beforeRemoval.authNonce,
          );
          const removeSignature = await flow.step('passkey.sign', () =>
            authoriser.authorise({
              account: record.address,
              circuit: removeCircuit,
              args: [target],
              witnessValues: [],
              authNonce: beforeRemoval.authNonce,
              useCounter: removeCounter,
              challenge: removeChallenge,
              credentialId: record.credentialId,
            }),
          );
          if (
            removeSignature.scheme !== 'p256-webauthn' ||
            removeSignature.useCounter !== removeCounter ||
            removeSignature.pk.x !== record.publicKey.x ||
            removeSignature.pk.y !== record.publicKey.y
          )
            throw new PassportConnectorError(
              'NotAuthorised',
              'The signature names another device.',
            );
          flow.checkpoint();
          const removed = await (
            await chain()
          ).call({
            address: record.address,
            circuit: removeCircuit,
            args: [
              target,
              {
                pk: p256(record.publicKey),
                policy: record.policy,
                authenticator_data: removeSignature.authenticatorData,
                sig: removeSignature.sig,
                use_counter: removeCounter,
              },
            ],
            ...flow.ports,
          });
          for (let attempt = 0; attempt < 30; attempt++) {
            flow.checkpoint();
            const settled = await read();
            if (
              settled.authNonce > beforeRemoval.authNonce &&
              !settled.deviceEntries.some((entry) => equalBytes(entry, target))
            )
              return {
                ...rotation,
                ...removed,
                removedCommitmentHex: toHex(target),
                rotationTxHash: tx.txHash,
              };
            if (attempt < 29) await sleep(1000);
          }
          throw new PassportConnectorError(
            'DeviceRosterInvalid',
            'The removed device is still in the live ACC set.',
          );
        },
        target
          ? { kind: 'remove-device', account: record.address, commitmentHex: toHex(target) }
          : { kind: 'rotate-encryption-key', account: record.address },
      );
    });

  const account = (record: P256Hint): PassportAccount => ({
    address: record.address,
    networkId,
    bindingId: network.bindingId,
    scheme: record.scheme,
    // A copy: the caller may not alter the id the account's own ceremonies are pinned to.
    credentialId: record.credentialId.slice(),
    addDevice: (reader, options) => {
      if (!('scheme' in reader) || reader.scheme !== 'p256-webauthn')
        throw new PassportConnectorError(
          'DeviceRosterInvalid',
          'P-256 enrollment needs a P-256 key and WebAuthn policy.',
        );
      return addP256Device(record, reader, options);
    },
    async state() {
      const view = await readAccount(record);
      return {
        booted: view.booted,
        authNonce: view.authNonce,
        deviceEpoch: view.deviceEpoch,
        entryCount: view.entryCount,
        specVersion: view.specVersion,
      };
    },
    readShieldedHoldings: (options = {}) =>
      run(options, async (flow) => {
        if (!isSealedP256(record) || !viewingKey || !ports.holdings || !authoriser.withKeySession)
          throw new PassportConnectorError(
            'BindingUnsupported',
            'P-256 holdings need a sealed keyring, key session and chain-backed holding source.',
          );
        const view = await readView(flow, record);
        if (!view.booted || record.status !== 'active')
          throw new PassportConnectorError('AccountNotFound', 'The P-256 ACC is not active.');
        if (view.specVersion !== 3)
          throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
        const counter = await findCounter(flow, record, view);
        if (counter === undefined) throw notHeld(record);
        return authoriser.withKeySession(
          async () => {
            const selected = await authoriser.devicePublicKey();
            const binding = await authoriser.deviceBinding!();
            if (
              selected.x !== record.publicKey.x ||
              selected.y !== record.publicKey.y ||
              !equalBytes(binding.credentialId, record.credentialId) ||
              !equalBytes(binding.policy.rp_id_hash, record.policy.rp_id_hash) ||
              !equalBytes(binding.policy.origin, record.policy.origin)
            )
              throw new PassportConnectorError(
                'NotAuthorised',
                'The selected passkey does not own this ACC.',
              );
            await sealedKeyring(record, view, false);
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
                chain: await chain(),
                authoriser,
                viewingKey,
                holdings: ports.holdings!,
              },
            );
          },
          { kind: 'read-holdings', account: record.address },
        );
      }),
    rotateViewingKey: (options) => rotateP256ViewingKey(record, options),
    removeDevice: (commitmentHex, options) =>
      rotateP256ViewingKey(record, options, commitmentHex) as Promise<DeviceRemovalResult>,
    rotateEncryptionKey: (newKey, options = {}) =>
      run(options, async (flow) => {
        if (isSealedP256(record))
          throw new PassportConnectorError(
            'BindingUnsupported',
            'Sealed P-256 accounts require roster-safe viewing-key rotation.',
          );
        const { counter, authNonce } = await useCounter(flow, record);
        const self = { bytes: fromHex(record.address) };
        const circuit = 'rotate_enc_key_with_p256';
        const challenge = (await binding()).pureCircuits.challenge_rotate_enc_key_with_p256(
          self,
          p256(record.publicKey),
          newKey,
          authNonce,
        );
        const signed = await flow.step('passkey.sign', () =>
          authoriser.authorise({
            account: record.address,
            circuit,
            args: [newKey],
            witnessValues: [],
            authNonce,
            useCounter: counter,
            challenge,
            credentialId: record.credentialId,
          }),
        );
        if (signed.scheme !== 'p256-webauthn') {
          throw new PassportConnectorError('InternalError', `A ${signed.scheme} authorisation.`);
        }
        const auth = {
          pk: p256(record.publicKey),
          policy: record.policy,
          authenticator_data: signed.authenticatorData,
          sig: signed.sig,
          use_counter: counter,
        };
        flow.checkpoint();
        // The chain port reports its own steps (prove, sponsor.*, chain.finality) through `onEvent`.
        return (await chain()).call({
          address: record.address,
          circuit,
          args: [newKey, auth],
          ...flow.ports,
        });
      }),
    issueGrant: async (scope, options = {}) => {
      if (
        !isSealedP256(record) ||
        !viewingKey ||
        !ports.records ||
        !ports.grants ||
        !ports.grantCommitments ||
        !ports.grantJournal ||
        !ports.grantOrigin
      )
        throw new PassportConnectorError(
          'BindingUnsupported',
          'P-256 grant issue needs sealed keys, local records, live grants, durable journal and host origin.',
        );
      if (
        scope.read &&
        (!ports.holdings || !ports.readGrants || !viewingKey.reencryptInbox || !viewingKey.sealView)
      )
        throw new PassportConnectorError(
          'BindingUnsupported',
          'Read grants need verified holdings, live read grants and a full viewing-key port.',
        );
      if (network.bindingId !== 'acc-s3r1.1')
        throw new PassportConnectorError('BindingUnsupported', 'Unsupported ACC grant binding.');
      const pure = requireP256GrantPure((await binding()).pureCircuits);
      return issueAndPublishP256Grant(
        { hint: record, origin: ports.grantOrigin, scope, ...options },
        {
          bindingId: 'acc-s3r1.1',
          networkId,
          pure,
          chain: await chain(),
          authoriser,
          records: ports.records,
          grants: ports.grants,
          commitments: ports.grantCommitments,
          journal: ports.grantJournal,
          viewingKey,
          random,
          ...(scope.read && {
            rotateBeforeIssue: () =>
              rotateP256ViewingKey(record, options, undefined, undefined, undefined, {
                requireAllGrants: true,
              }) as Promise<ViewingKeyRotationResult>,
          }),
        },
      );
    },
    recoverPendingGrants: async (options = {}) => {
      if (
        !isSealedP256(record) ||
        !viewingKey ||
        !ports.records ||
        !ports.grants ||
        !ports.grantCommitments ||
        !ports.grantJournal ||
        typeof (ports.grantJournal as Partial<GrantRecoveryJournal>).pending !== 'function'
      )
        throw new PassportConnectorError(
          'BindingUnsupported',
          'P-256 grant recovery needs sealed keys, local records, live grants and pending journal enumeration.',
        );
      if (network.bindingId !== 'acc-s3r1.1')
        throw new PassportConnectorError('BindingUnsupported', 'Unsupported ACC grant binding.');
      const pure = requireP256GrantPure((await binding()).pureCircuits);
      return recoverPendingP256Grants(
        { hint: record, ...options },
        {
          bindingId: 'acc-s3r1.1',
          networkId,
          pure,
          chain: await chain(),
          grants: ports.grants,
          commitments: ports.grantCommitments,
          journal: ports.grantJournal as GrantRecoveryJournal,
          viewingKey,
          authoriser,
          records: ports.records,
          random,
        },
      );
    },
    revokeGrant: (grantId, options = {}) =>
      run(options, async (flow): Promise<PassportGrantRevokeResult> => {
        const pure = (await binding()).pureCircuits;
        if (
          network.bindingId !== 'acc-s3r1.1' ||
          !ports.grantDetails ||
          !pure.challenge_revoke_grant_with_p256
        )
          throw new PassportConnectorError(
            'BindingUnsupported',
            'P-256 revoke needs the pinned grant binding and live grant details.',
          );
        if (!validGrantId(grantId))
          throw new PassportConnectorError(
            'GrantScopeInvalid',
            'The grant id must be 32-byte hex.',
          );
        let grant = await flow.step('grant.roster', () =>
          ports.grantDetails!.readGrant(record.address, grantId),
        );
        if (!grant) throw new PassportConnectorError('GrantNotFound', 'The grant is missing.');
        if (!grant.active)
          throw new PassportConnectorError('GrantRevoked', 'The grant is already revoked.');
        let view = await readView(flow, record);
        if (!view.booted || record.status !== 'active' || view.specVersion !== 3)
          throw new PassportConnectorError('AccountNotFound', 'The active spec-3 ACC is missing.');
        if (grant.authNonce !== view.authNonce)
          throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster is stale.');
        let rotation: ViewingKeyRotationResult | undefined;
        let rotated: { readonly encKey: Uint8Array; readonly authNonce: bigint } | undefined;
        if (grant.read) {
          if (!isSealedP256(record) || !ports.holdings || !ports.readGrants)
            throw new PassportConnectorError(
              'BindingUnsupported',
              'Read-grant revoke needs sealed keys, verified holdings and live read targets.',
            );
          const targets = await flow.step('grant.roster', () =>
            ports.readGrants!.readActiveReadGrantTargets(record.address),
          );
          if (
            targets.authNonce !== view.authNonce ||
            !targets.targets.some(({ grantId: id }) => id === grantId)
          )
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'The read grant is absent from the live targets.',
            );
          rotation = (await rotateP256ViewingKey(record, options, undefined, grantId, (state) => {
            rotated = state;
          })) as ViewingKeyRotationResult;
          view = await readView(flow, record);
          if (
            !rotated ||
            view.authNonce !== rotated.authNonce ||
            !view.encKey ||
            !equalBytes(view.encKey, rotated.encKey)
          )
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'The ACC key changed after read-grant rotation.',
            );
          grant = await flow.step('grant.roster', () =>
            ports.grantDetails!.readGrant(record.address, grantId),
          );
          if (!grant?.active || !grant.read || grant.authNonce !== view.authNonce)
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'The read grant changed during viewing-key rotation.',
            );
        }
        const counter = await findCounter(flow, record, view);
        if (counter === undefined) throw notHeld(record);
        const selected = await authoriser.devicePublicKey();
        if (selected.x !== record.publicKey.x || selected.y !== record.publicKey.y)
          throw new PassportConnectorError(
            'NotAuthorised',
            'The selected passkey does not own this ACC.',
          );
        const circuit = 'revoke_grant_with_p256';
        const id = fromHex(grantId);
        const signed = await flow.step('passkey.sign', () =>
          authoriser.authorise({
            account: record.address,
            circuit,
            args: [id],
            witnessValues: [],
            authNonce: view.authNonce,
            useCounter: counter,
            challenge: pure.challenge_revoke_grant_with_p256!(
              { bytes: fromHex(record.address) },
              p256(record.publicKey),
              id,
              view.authNonce,
            ),
            credentialId: record.credentialId,
          }),
        );
        if (
          signed.scheme !== 'p256-webauthn' ||
          signed.useCounter !== counter ||
          signed.pk.x !== record.publicKey.x ||
          signed.pk.y !== record.publicKey.y
        )
          throw new PassportConnectorError('NotAuthorised', 'The signature names another device.');
        const latest = await flow.step('grant.roster', () =>
          ports.grantDetails!.readGrant(record.address, grantId),
        );
        const current = await readView(flow, record);
        if (
          !latest?.active ||
          latest.read !== grant.read ||
          latest.authNonce !== view.authNonce ||
          current.authNonce !== view.authNonce ||
          current.deviceEpoch !== view.deviceEpoch ||
          (rotated && (!current.encKey || !equalBytes(current.encKey, rotated.encKey)))
        )
          throw new PassportConnectorError(
            'GrantRosterUnsettled',
            'The grant changed before submission.',
          );
        flow.checkpoint();
        const tx = await (
          await chain()
        ).call({
          address: record.address,
          circuit,
          args: [
            id,
            {
              pk: p256(record.publicKey),
              policy: record.policy,
              authenticator_data: signed.authenticatorData,
              sig: signed.sig,
              use_counter: counter,
            },
          ],
          ...flow.ports,
        });
        for (let attempt = 0; attempt < 30; attempt++) {
          flow.checkpoint();
          const settled = await flow.step('grant.roster', () =>
            ports.grantDetails!.readGrant(record.address, grantId),
          );
          if (settled && !settled.active && settled.authNonce > view.authNonce)
            return {
              ...tx,
              grantId,
              status: 'revoked',
              nextUseCounter: counter + 1n,
              ...(rotation && { rotation }),
            };
          if (attempt < 29) await sleep(1000);
        }
        throw new PassportConnectorError(
          'GrantRosterUnsettled',
          'The submitted grant revocation did not settle.',
        );
      }),
    revokeAllGrants: (options = {}) =>
      run(options, async (flow) => {
        if (network.bindingId !== 'acc-s3r1.1' || !ports.grantRoster)
          throw new PassportConnectorError(
            'BindingUnsupported',
            'P-256 revoke-all needs the pinned grants binding and a complete live grant roster.',
          );
        let roster = await flow.step('grant.roster', () =>
          ports.grantRoster!.readGrantRoster(record.address),
        );
        const baseline = grantRosterFingerprint(roster);
        const activeReadIds = roster.entries
          .filter(({ active, read }) => active && read)
          .map(({ id }) => id)
          .sort();
        let rotation: ViewingKeyRotationResult | undefined;
        let rotated: { readonly encKey: Uint8Array; readonly authNonce: bigint } | undefined;
        if (activeReadIds.length) {
          if (!isSealedP256(record) || !ports.readGrants || !ports.holdings)
            throw new PassportConnectorError(
              'BindingUnsupported',
              'Read-grant revoke-all needs sealed keys, verified holdings and live read targets.',
            );
          const targets = await flow.step('grant.roster', () =>
            ports.readGrants!.readActiveReadGrantTargets(record.address),
          );
          if (
            targets.authNonce !== roster.authNonce ||
            JSON.stringify(targets.targets.map(({ grantId }) => grantId).sort()) !==
              JSON.stringify(activeReadIds)
          )
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'The active read-grant targets differ from the ACC grant map.',
            );
          rotation = (await rotateP256ViewingKey(record, options, undefined, 'all', (state) => {
            rotated = state;
          })) as ViewingKeyRotationResult;
          const advanced = await flow.step('grant.roster', () =>
            ports.grantRoster!.readGrantRoster(record.address),
          );
          if (
            advanced.authNonce <= roster.authNonce ||
            advanced.generation !== roster.generation ||
            grantRosterFingerprint(advanced) !== baseline
          )
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'The grant map changed during viewing-key rotation.',
            );
          roster = advanced;
        }
        const view = await readView(flow, record);
        if (!view.booted || view.specVersion !== 3)
          throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
        if (view.authNonce !== roster.authNonce)
          throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster is stale.');
        if (
          rotated &&
          (view.authNonce !== rotated.authNonce ||
            !view.encKey ||
            !equalBytes(view.encKey, rotated.encKey))
        )
          throw new PassportConnectorError(
            'GrantRosterUnsettled',
            'The ACC key changed after read-grant rotation.',
          );
        const counter = await findCounter(flow, record, view);
        if (counter === undefined) throw notHeld(record);
        const publicKey = await authoriser.devicePublicKey();
        if (publicKey.x !== record.publicKey.x || publicKey.y !== record.publicKey.y)
          throw new PassportConnectorError(
            'NotAuthorised',
            'The selected device does not own this ACC.',
          );
        const circuit = 'revoke_all_grants_with_p256';
        const pure = (await binding()).pureCircuits;
        if (!pure.challenge_revoke_all_grants_with_p256)
          throw new PassportConnectorError(
            'BindingUnsupported',
            'The binding lacks P-256 grant challenges.',
          );
        const challenge = pure.challenge_revoke_all_grants_with_p256(
          { bytes: fromHex(record.address) },
          p256(record.publicKey),
          view.authNonce,
        );
        const signed = await flow.step('passkey.sign', () =>
          authoriser.authorise({
            account: record.address,
            circuit,
            args: [],
            witnessValues: [],
            authNonce: view.authNonce,
            useCounter: counter,
            challenge,
            credentialId: record.credentialId,
          }),
        );
        if (
          signed.scheme !== 'p256-webauthn' ||
          signed.useCounter !== counter ||
          signed.pk.x !== record.publicKey.x ||
          signed.pk.y !== record.publicKey.y
        )
          throw new PassportConnectorError('NotAuthorised', 'The signature names another device.');
        const latest = await flow.step('grant.roster', () =>
          ports.grantRoster!.readGrantRoster(record.address),
        );
        const current = await readView(flow, record);
        if (
          latest.authNonce !== view.authNonce ||
          current.authNonce !== view.authNonce ||
          (rotated && (!current.encKey || !equalBytes(current.encKey, rotated.encKey))) ||
          latest.generation !== roster.generation ||
          grantRosterFingerprint(latest) !== baseline
        )
          throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster changed.');
        flow.checkpoint();
        const tx = await (
          await chain()
        ).call({
          address: record.address,
          circuit,
          args: [
            {
              pk: p256(record.publicKey),
              policy: record.policy,
              authenticator_data: signed.authenticatorData,
              sig: signed.sig,
              use_counter: counter,
            },
          ],
          ...flow.ports,
        });
        const generation = (roster.generation + 1n) & ((1n << 32n) - 1n);
        await flow.step('grant.roster', async () => {
          for (let attempt = 0; attempt < 30; attempt++) {
            flow.checkpoint();
            const settled = await ports.grantRoster!.readGrantRoster(record.address);
            grantRosterFingerprint(settled);
            if (
              settled.authNonce > view.authNonce &&
              settled.generation === generation &&
              settled.entries.length === 0
            )
              return;
            if (attempt < 29) await sleep(1000);
          }
          throw new PassportConnectorError(
            'GrantRosterUnsettled',
            'The submitted revoke-all did not clear the live ACC grant map.',
          );
        });
        return {
          ...tx,
          status: 'cleared' as const,
          generation,
          nextUseCounter: counter + 1n,
          ...(rotation && { rotation }),
        };
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
          if (typeof retireAuthority !== 'boolean') {
            // Irreversible, so the caller decides, with no default (D-11); before any prompt.
            throw new PassportConnectorError('InternalError', 'retireAuthority must be a boolean.');
          }
          const { credentialId, publicKey, device } = await flow.step(
            'passkey.create',
            async () => {
              const { credentialId } = await credentials.create({ name: userName });
              const publicKey = await authoriser.devicePublicKey();
              const device = (await authoriser.deviceBinding?.())!;
              return { credentialId, publicKey, device };
            },
          );
          // Before the deploy: a passkey without PRF fails here, with nothing on chain.
          if (viewingKey && !authoriser.devicePublicKeyHex)
            throw new PassportConnectorError(
              'BindingUnsupported',
              'P-256 sealed accounts need a compressed device public key.',
            );
          const { pureCircuits } = await binding();
          if (viewingKey && !pureCircuits.challenge_append_inbox_with_p256)
            throw new PassportConnectorError(
              'BindingUnsupported',
              'ACC lacks P-256 inbox signing.',
            );
          const keys = viewingKey
            ? await flow.step('passkey.prf', async () =>
                viewingKey.createKeys(networkId, {
                  scheme: 'p256-webauthn',
                  devicePublicKey: await authoriser.devicePublicKeyHex!(),
                  policy: device.policy,
                }),
              )
            : undefined;
          const encKey = keys
            ? keys.encKey
            : await flow.step('passkey.prf', () => encryptionKey.publicKey(networkId));
          const salt = random(32);
          if (
            keys &&
            (!validSealedEntries([...keys.envelopes, ...keys.registrations]) ||
              keys.registrations[0]?.[0] !== 0xd5)
          )
            throw new PassportConnectorError(
              'InternalError',
              'P-256 keyring did not provide one envelope and one registration.',
            );
          const boot = pureCircuits.derive_boot_commitment_with_p256(
            salt,
            p256(publicKey),
            device.policy,
          );
          // A deployer honours `signal` only before it submits anything: an account it deployed is
          // always returned, and recorded below, so its salt is never lost.
          const { address } = await flow.step('deploy', () =>
            ports.deployer.deploy({
              boot,
              encKey,
              retireAuthority,
              firstArm: 'p256',
              ...flow.ports,
            }),
          );
          const deployed: P256Hint = {
            scheme: 'p256-webauthn',
            credentialId,
            publicKey,
            policy: device.policy,
            address,
            salt,
            ...(keys && { keyEntries: [...keys.envelopes, ...keys.registrations] }),
            status: 'deployed',
          };
          // Recorded before activation: the salt is the only way to activate (Review Focus 2).
          await recordDeployed(flow, deployed);
          return account(
            viewingKey && isSealedP256(deployed)
              ? await finishSealed(flow, deployed)
              : await activate(flow, deployed),
          );
        },
        onProgress,
      ),
    openAccountAt: (address, options = {}) =>
      run(options, async (flow) => {
        if (!/^[0-9a-f]{64}$/.test(address))
          throw new PassportConnectorError(
            'AccountNotFound',
            'ACC address must be 32-byte lowercase hex.',
          );
        if (!viewingKey || !authoriser.devicePublicKeyHex)
          throw new PassportConnectorError(
            'BindingUnsupported',
            'Address recovery needs a sealed P-256 keyring.',
          );
        const identity = await flow.step('passkey.identify', () => credentials.identify());
        const publicKey = await authoriser.devicePublicKey();
        const device = await authoriser.deviceBinding!();
        if (
          !equalBytes(identity.credentialId, device.credentialId) ||
          !identity.owns(publicKey, device.policy)
        )
          throw new PassportConnectorError(
            'NotAuthorised',
            'The selected passkey does not match its device binding.',
          );
        const record: SealedP256Hint = {
          address,
          scheme: 'p256-webauthn',
          credentialId: identity.credentialId.slice(),
          publicKey,
          policy: device.policy,
          status: 'active',
          sealed: true,
        };
        const view = await readView(flow, record);
        if (!view.booted || view.specVersion !== 3)
          throw new PassportConnectorError(
            'AccountNotFound',
            'The selected ACC is not an active spec-3 account.',
          );
        const counter = await findCounter(flow, record, view);
        if (counter === undefined) throw notHeld(record);
        await sealedKeyring(record, view, false);
        await ports.records?.write({
          address,
          bindingId: network.bindingId,
          scheme: 'p256-webauthn',
          credentialId: record.credentialId.slice(),
          localUseCounter: counter,
        });
        return account(record);
      }),
    openAccount: (options = {}) =>
      run(options, async (flow) => {
        const identity = await flow.step('passkey.identify', () => credentials.identify());
        const hint = await flow.step('directory.read', async () =>
          directory?.get(networkId, {
            kind: 'credential-id',
            credentialId: identity.credentialId,
          }),
        );
        if (!hint)
          throw new PassportConnectorError(
            'AccountNotFound',
            'No Passport account for this passkey on this network.',
          );
        // The registry is an untrusted hint (Ruling R10(b)): the record must name the picked
        // passkey's own key, the address must hold a ledger, and that ledger must hold the passkey.
        if (
          !isP256(hint) ||
          !equalBytes(hint.credentialId, identity.credentialId) ||
          !identity.owns(hint.publicKey, hint.policy)
        ) {
          throw new PassportConnectorError(
            'AccountNotFound',
            'The registry record does not belong to this passkey.',
          );
        }
        const view = await readView(flow, hint);
        if (
          (hint.status === 'active' || view.booted) &&
          (await findCounter(flow, hint, view)) === undefined
        )
          throw notHeld(hint);
        if (viewingKey) {
          if (!isSealedP256(hint))
            throw new PassportConnectorError(
              'BindingUnsupported',
              'This P-256 account has no sealed viewing key; use the legacy adapter or migrate it.',
            );
          return account(await finishSealed(flow, hint));
        }
        if (encKeyComparable(view)) {
          const derived = await flow.step('passkey.prf', () => encryptionKey.publicKey(networkId));
          if (!equalBytes(derived, view.encKey)) {
            throw new PassportConnectorError(
              'EncryptionKeyMismatch',
              `The account at ${hint.address} holds an encryption key this passkey does not derive.`,
            );
          }
        }
        return account(hint.status === 'active' ? hint : await finishActivation(flow, hint, view));
      }),
  };
}
