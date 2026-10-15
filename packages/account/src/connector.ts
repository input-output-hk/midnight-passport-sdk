import {
  PASSPORT_API_VERSION,
  type CreateAccountStep,
  type FlowOptions,
  type PassportAccount,
  type PassportConnectorAPI,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { grantRosterFingerprint } from './grant-roster.js';
import { createJubjubAccounts } from './jubjub-connector.js';
import { startFlow, type Flow } from './flow.js';
import type {
  AccLedgerView,
  AccountHint,
  CurvePoint,
  Lazy,
  P256PublicKey,
  PassportPorts,
  WebAuthnPolicy,
} from './ports/index.js';

const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

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
};
const isP256 = (hint: AccountHint): hint is P256Hint =>
  hint.scheme === 'p256-webauthn' && hint.credentialId !== undefined && hint.policy !== undefined;
type SealedP256Hint = P256Hint & { readonly keyEntries: readonly Uint8Array[] };
const validSealedEntries = (entries: readonly Uint8Array[] | undefined): boolean =>
  entries?.length === 2 &&
  entries[0]?.length === 192 &&
  entries[0][0] === 0xd1 &&
  entries[0][1] === 1 &&
  entries[1]?.length === 192 &&
  entries[1][0] === 0xd4 &&
  entries[1][1] === 1;
const isSealedP256 = (hint: P256Hint): hint is SealedP256Hint =>
  validSealedEntries(hint.keyEntries);
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

  const sealedKeyring = async (record: SealedP256Hint, view: AccLedgerView, pending: boolean) => {
    const keyring = viewingKey;
    const devicePublicKeyHex = authoriser.devicePublicKeyHex?.bind(authoriser);
    const { encKey, inboxEntries } = view;
    if (!keyring || !devicePublicKeyHex || !encKey || !inboxEntries)
      throw new PassportConnectorError(
        'BindingUnsupported',
        'P-256 sealed accounts need an inbox reader, keyring and compressed device key.',
      );
    const entries = pending ? [...inboxEntries, ...record.keyEntries] : [...inboxEntries];
    const check = async () => {
      const opened = await keyring.openInbox(
        networkId,
        { account: record.address, encKey, envelopes: entries.reverse() },
        pending ? record.keyEntries : [],
      );
      if (pending) {
        const device = opened[1];
        const reader = await keyring.readerPublicKey(networkId);
        const deviceKey = await devicePublicKeyHex();
        if (
          device?.kind !== 'device' ||
          device.device.scheme !== 'p256-webauthn' ||
          device.device.readerPublicKey !== toHex(reader) ||
          device.device.devicePublicKey !== deviceKey
        )
          throw new Error('the sealed registration does not name this device');
      }
    };
    try {
      if (authoriser.withKeySession)
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
      const pure = (await binding()).pureCircuits;
      if (!pure.challenge_append_inbox_with_p256)
        throw new PassportConnectorError('BindingUnsupported', 'ACC lacks P-256 inbox signing.');
      for (const entry of record.keyEntries) {
        if (view.inboxEntries?.some((held) => equalBytes(held, entry))) continue;
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
        const nonce = view.authNonce;
        view = await awaitSealedView(record, (candidate) => candidate.authNonce > nonce);
      }
    }
    await sealedKeyring(record, view, false);
    const active: P256Hint = { ...record, status: 'active' };
    if (pending) await put(flow, active);
    return active;
  };

  const account = (record: P256Hint): PassportAccount => ({
    address: record.address,
    networkId,
    bindingId: network.bindingId,
    scheme: record.scheme,
    // A copy: the caller may not alter the id the account's own ceremonies are pinned to.
    credentialId: record.credentialId.slice(),
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
    revokeAllGrants: (options = {}) =>
      run(options, async (flow) => {
        if (network.bindingId !== 'acc-s3r1.1' || !ports.grantRoster)
          throw new PassportConnectorError(
            'BindingUnsupported',
            'P-256 revoke-all needs the pinned grants binding and a complete live grant roster.',
          );
        const roster = await flow.step('grant.roster', () =>
          ports.grantRoster!.readGrantRoster(record.address),
        );
        const baseline = grantRosterFingerprint(roster);
        if (roster.entries.some(({ active, read }) => active && read))
          throw new PassportConnectorError(
            'BindingUnsupported',
            'Live read grants require viewing-secret rotation before revoke-all.',
          );
        const view = await readView(flow, record);
        if (!view.booted || view.specVersion !== 3)
          throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
        if (view.authNonce !== roster.authNonce)
          throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster is stale.');
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
        return { ...tx, status: 'cleared' as const, generation, nextUseCounter: counter + 1n };
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
                }),
              )
            : undefined;
          const encKey = keys
            ? keys.encKey
            : await flow.step('passkey.prf', () => encryptionKey.publicKey(networkId));
          const salt = random(32);
          if (keys && !validSealedEntries([...keys.envelopes, ...keys.registrations]))
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
