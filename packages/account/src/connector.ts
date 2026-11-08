import { createP256Account } from './p256-creation.js';
import { openP256Address } from './p256-address-open.js';
import { withLoginSession } from './with-login-session.js';
import { snapshotGrantScope } from './request-snapshots.js';
import {
  type P256Hint,
  type SealedP256Hint,
  isP256,
  isSealedP256,
  validSealedEntries,
  p256,
} from './p256-device.js';
import { createP256ViewingRotation } from './p256-viewing-rotation.js';
import { createP256DeviceEnrollment } from './p256-device-enrollment.js';
import { revokeP256Grant, revokeAllP256Grants } from './p256-grant-revocation.js';
import { lazyPort } from './lazy-port.js';
import {
  PASSPORT_API_VERSION,
  type CreateAccountStep,
  type FlowOptions,
  type DeviceRemovalResult,
  type ViewingKeyRotationResult,
  type PassportAccount,
  type PassportConnectorAPI,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { issueAndPublishP256Grant, type IssueP256GrantPure } from './p256-grant-issue.js';
import { recoverPendingP256Grants } from './p256-grant-publication.js';
import type { GrantRecoveryJournal } from './jubjub-grant-publication.js';
import { readQualifiedHolding, readVerifiedHoldings } from './holdings.js';
import { createJubjubAccounts } from './jubjub-connector.js';
import { prepareShieldedWithdrawal, prepareUnshieldedWithdrawal } from './unshielded-withdrawal.js';
import { startFlow, type Flow } from './flow.js';
import type {
  AccLedgerView,
  AccPureCircuits,
  PassportPorts,
  QualifiedHoldingSource,
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
  const binding = lazyPort(ports.binding);
  const chain = lazyPort(ports.chain);
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
      if (!entries.length) throw new Error('the ACC inbox has no sealed key entries');
      const opened = await keyring.openInbox(
        networkId,
        { account: record.address, encKey, envelopes: [...entries].reverse() },
        // Empty batches can be a transport no-op, so request an actual sealed entry.
        pending ? record.keyEntries! : entries.slice(0, 1),
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
      credentialId: Uint8Array.from(active.credentialId),
      localUseCounter: counter,
    });
    return active;
  };

  const addP256Device = createP256DeviceEnrollment({
    ports,
    binding,
    chain,
    run,
    withOwnerSession(operation, descriptor) {
      const current = authoriser.withKeySession;
      if (!current)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'P-256 enrollment needs a sealed keyring, joining-device decoder, key session and live read-grant source.',
        );
      return current.bind(authoriser)(operation, descriptor);
    },
    ownerBinding() {
      const current = authoriser.deviceBinding;
      if (!current)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'The selected authorisation arm needs a compatible authoriser and binding.',
        );
      return current.call(authoriser);
    },
    findCounter,
    notHeld,
    sealedKeyring,
    append: appendP256,
    rotate: (record, options) =>
      rotateP256ViewingKey(record, options, undefined, undefined, undefined, {
        inOwnerSession: true,
        rotateRosterForEnrollment: true,
      }),
    sleep,
  });

  const rotateP256ViewingKey = createP256ViewingRotation({
    ports,
    binding,
    chain,
    run,
    findCounter,
    notHeld,
    sealedKeyring,
    appendP256,
    awaitSealedView,
    random,
    sleep,
  });

  const revocation = {
    ports,
    authoriser,
    network,
    binding,
    chain,
    readView,
    findCounter,
    notHeld,
    rotate: rotateP256ViewingKey,
    sleep,
  };

  const account = (record: P256Hint): PassportAccount => ({
    address: record.address,
    networkId,
    bindingId: network.bindingId,
    scheme: record.scheme,
    // A copy: the caller may not alter the id the account's own ceremonies are pinned to.
    credentialId: Uint8Array.from(record.credentialId),
    withdrawUnshielded: (request, options = {}) =>
      run(options, async (flow) => {
        const transfer = prepareUnshieldedWithdrawal(request);
        const pure = (await binding()).pureCircuits;
        if (
          network.bindingId !== 'acc-s3r1.1' ||
          !pure.challenge_withdraw_unshielded_with_p256 ||
          !authoriser.withKeySession ||
          !authoriser.deviceBinding
        )
          throw new PassportConnectorError(
            'BindingUnsupported',
            'P-256 withdrawal needs the pinned challenge, key session and device binding.',
          );
        if (record.status !== 'active')
          throw new PassportConnectorError('AccountNotFound', 'The P-256 ACC is not active.');
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
            const { counter, authNonce } = await useCounter(flow, record);
            const circuit = 'withdraw_unshielded_with_p256';
            const challenge = pure.challenge_withdraw_unshielded_with_p256!(
              { bytes: fromHex(record.address) },
              p256(record.publicKey),
              transfer.color,
              transfer.amount,
              transfer.recipient,
              authNonce,
            );
            const signed = await flow.step('passkey.sign', () =>
              authoriser.authorise({
                account: record.address,
                circuit,
                args: [transfer.color, transfer.amount, transfer.recipient],
                witnessValues: [],
                authNonce,
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
                transfer.color,
                transfer.amount,
                transfer.recipient,
                {
                  pk: p256(record.publicKey),
                  use_counter: counter,
                  policy: record.policy,
                  authenticator_data: signed.authenticatorData,
                  sig: signed.sig,
                },
              ],
              ...flow.ports,
            });
            return { ...tx, nextUseCounter: counter + 1n };
          },
          {
            kind: 'withdraw-unshielded',
            account: record.address,
            color: toHex(transfer.color),
            amount: transfer.amount.toString(),
            recipient: toHex(transfer.recipient.bytes),
          },
        );
      }),
    withdrawShielded: (request, options = {}) =>
      run(options, async (flow) => {
        const transfer = prepareShieldedWithdrawal(request);
        const qualified = ports.holdings as QualifiedHoldingSource | undefined;
        const pure = (await binding()).pureCircuits;
        if (
          network.bindingId !== 'acc-s3r1.1' ||
          !pure.challenge_withdraw_shielded_with_p256 ||
          !isSealedP256(record) ||
          !viewingKey ||
          !qualified?.selectQualifiedHeldCoins ||
          !authoriser.withKeySession ||
          !authoriser.deviceBinding
        )
          throw new PassportConnectorError(
            'BindingUnsupported',
            'P-256 shielded withdrawal needs sealed keys, qualified holdings and a key session.',
          );
        if (record.status !== 'active')
          throw new PassportConnectorError('AccountNotFound', 'The P-256 ACC is not active.');
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
            const view = await readView(flow, record);
            if (!view.booted || view.specVersion !== 3)
              throw new PassportConnectorError('AccountNotFound', 'The P-256 ACC is not active.');
            const counter = await findCounter(flow, record, view);
            if (counter === undefined) throw notHeld(record);
            await sealedKeyring(record, view, false, true);
            const chainPort = await chain();
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
            const circuit = 'withdraw_shielded_with_p256';
            const challenge = pure.challenge_withdraw_shielded_with_p256!(
              { bytes: fromHex(record.address) },
              p256(record.publicKey),
              transfer.recipient,
              transfer.color,
              transfer.amount,
              coin,
              view.authNonce,
            );
            const signed = await flow.step('passkey.sign', () =>
              authoriser.authorise({
                account: record.address,
                circuit,
                args: [transfer.recipient, transfer.color, transfer.amount],
                witnessValues: [coin],
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
            const tx = await chainPort.call({
              address: record.address,
              circuit,
              args: [
                transfer.recipient,
                transfer.color,
                transfer.amount,
                {
                  pk: p256(record.publicKey),
                  use_counter: counter,
                  policy: record.policy,
                  authenticator_data: signed.authenticatorData,
                  sig: signed.sig,
                },
              ],
              heldCoin: coin,
              ...flow.ports,
            });
            return { ...tx, nextUseCounter: counter + 1n };
          },
          {
            kind: 'withdraw-shielded',
            account: record.address,
            color: toHex(transfer.color),
            amount: transfer.amount.toString(),
            recipient: toHex(transfer.recipient.bytes),
            inboxIndex: transfer.inboxIndex,
          },
        );
      }),
    addDevice: (reader, options) => {
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
    async deviceRoster() {
      const view = await (await chain()).readAccount(record.address, { includeDevices: true });
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
                encKey: view.encKey!,
                envelopes: [...view.inboxEntries!].reverse(),
              },
            },
            {
              networkId,
              chain: await chain(),
              authoriser: { withKeySession: async (work) => work() },
              viewingKey: routine,
              holdings: ports.holdings!,
            },
          );
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
        newKey = Uint8Array.from(newKey);
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
      scope = snapshotGrantScope(scope);
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
              rotateP256ViewingKey(record, options) as Promise<ViewingKeyRotationResult>,
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
      run(options, (flow) => revokeP256Grant(revocation, record, grantId, options, flow)),
    revokeAllGrants: (options = {}) =>
      run(options, (flow) => revokeAllP256Grants(revocation, record, options, flow)),
  });

  const api: PassportConnectorAPI = {
    apiVersion: PASSPORT_API_VERSION,
    networkId,
    bindingId: network.bindingId,
    createAccount: ({ userName, retireAuthority, onProgress, ...options }) =>
      run(
        options,
        async (flow) =>
          account(
            await createP256Account(userName, retireAuthority, {
              ports,
              flow,
              binding,
              random,
              recordDeployed,
              finishSealed,
              activate,
            }),
          ),
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
        const { record, view } = await openP256Address(
          address,
          networkId,
          identity,
          authoriser,
          viewingKey,
          await chain(),
          flow,
        );
        const counter = await findCounter(flow, record, view);
        if (counter === undefined) throw notHeld(record);
        await sealedKeyring(record, view, false);
        await ports.records?.write({
          address,
          bindingId: network.bindingId,
          scheme: 'p256-webauthn',
          credentialId: Uint8Array.from(record.credentialId),
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
  return withLoginSession(credentials, api, ports.onAccountOpened);
}
