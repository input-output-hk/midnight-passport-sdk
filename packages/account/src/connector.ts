import {
  PASSPORT_CONNECTOR_VERSION,
  type PassportAccount,
  type PassportConnectorAPI,
} from '@midnight-ntwrk/mn-passport-protocol';
import { fromHex } from './codec.js';
import { PassportConnectorError, toPassportError } from './errors.js';
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

/** A hint of the P-256 arm, the one arm this release drives (#24 adds JubJub). */
type P256Hint = AccountHint & {
  readonly credentialId: Uint8Array;
  readonly policy: WebAuthnPolicy;
};
const isP256 = (hint: AccountHint): hint is P256Hint =>
  hint.scheme === 'p256-webauthn' && hint.credentialId !== undefined && hint.policy !== undefined;
/** The circuits' P-256 key; a point that already is one passes as is, so the same key reaches the chain. */
const p256 = (point: CurvePoint): P256PublicKey =>
  (point as Partial<P256PublicKey>).identity === false
    ? (point as P256PublicKey)
    : { x: point.x, y: point.y, identity: false };

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
  const { authoriser, credentials, directory, encryptionKey, network } = ports;
  const { networkId } = network;
  if (authoriser.scheme !== 'p256-webauthn' || !authoriser.deviceBinding) {
    throw new PassportConnectorError(
      'BindingUnsupported',
      'This release drives the p256-webauthn arm only, with its WebAuthn binding.',
    );
  }
  const binding = once(ports.binding);
  const chain = once(ports.chain);
  const random = ports.random ?? webRandom;
  const put = async (record: P256Hint) => directory?.put(networkId, record);

  const submitActivation = async (record: P256Hint) =>
    (await chain()).call({
      address: record.address,
      circuit: 'activate_initial_device_with_p256',
      args: [p256(record.publicKey), record.salt, record.policy],
    });

  const activate = async (record: P256Hint): Promise<P256Hint> => {
    await submitActivation(record);
    const active: P256Hint = { ...record, status: 'active' };
    await put(active);
    return active;
  };

  const recordDeployed = async (record: P256Hint): Promise<void> => {
    for (let attempt = 0; ; attempt++) {
      try {
        await put(record);
        return;
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
  };

  const readView = async (record: P256Hint): Promise<AccLedgerView> => {
    const view = await (await chain()).readAccount(record.address);
    if (!view)
      throw new PassportConnectorError('AccountNotFound', `No contract at ${record.address}.`);
    return view;
  };

  /** The 0..RESCAN_LIMIT-1 counter scan: the counter of this passkey's live entry, if any. */
  const findCounter = async (
    record: P256Hint,
    view: AccLedgerView,
  ): Promise<bigint | undefined> => {
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
  };

  const notHeld = (record: P256Hint) =>
    new PassportConnectorError(
      'AccountNotFound',
      `The account at ${record.address} does not hold this passkey.`,
    );

  const useCounter = async (record: P256Hint): Promise<{ counter: bigint; authNonce: bigint }> => {
    const view = await readView(record);
    const counter = await findCounter(record, view);
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
  const finishActivation = async (record: P256Hint, view: AccLedgerView): Promise<P256Hint> => {
    if (!view.booted) {
      await submitActivation(record);
      if ((await findCounter(record, await readView(record))) === undefined) throw notHeld(record);
    }
    const active: P256Hint = { ...record, status: 'active' };
    await put(active);
    return active;
  };

  const account = (record: P256Hint): PassportAccount => ({
    address: record.address,
    networkId,
    bindingId: network.bindingId,
    // A copy: the caller may not alter the id the account's own ceremonies are pinned to.
    credentialId: record.credentialId.slice(),
    async state() {
      const view = await readView(record);
      return {
        booted: view.booted,
        authNonce: view.authNonce,
        deviceEpoch: view.deviceEpoch,
        entryCount: view.entryCount,
        specVersion: view.specVersion,
      };
    },
    async rotateEncryptionKey(newKey) {
      try {
        const { counter, authNonce } = await useCounter(record);
        const self = { bytes: fromHex(record.address) };
        const circuit = 'rotate_enc_key_with_p256';
        const challenge = (await binding()).pureCircuits.challenge_rotate_enc_key_with_p256(
          self,
          p256(record.publicKey),
          newKey,
          authNonce,
        );
        const signed = await authoriser.authorise({
          account: record.address,
          circuit,
          args: [newKey],
          witnessValues: [],
          authNonce,
          useCounter: counter,
          challenge,
          credentialId: record.credentialId,
        });
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
        return await (
          await chain()
        ).call({ address: record.address, circuit, args: [newKey, auth] });
      } catch (e) {
        throw toPassportError(e);
      }
    },
  });

  return {
    apiVersion: PASSPORT_CONNECTOR_VERSION,
    networkId,
    async createAccount({ userName, onProgress }) {
      try {
        const { credentialId } = await credentials.create({ name: userName });
        const publicKey = await authoriser.devicePublicKey();
        const device = (await authoriser.deviceBinding?.())!;
        onProgress?.('passkey-created');
        // Before the deploy: a passkey without PRF fails here, with nothing on chain.
        const encKey = await encryptionKey.publicKey(networkId);
        const salt = random(32);
        const { pureCircuits } = await binding();
        const boot = pureCircuits.derive_boot_commitment_with_p256(
          salt,
          p256(publicKey),
          device.policy,
        );
        onProgress?.('deploying');
        // The prototype's service always retires the authority; T3 takes it from the caller (D-11).
        const { address } = await ports.deployer.deploy({ boot, encKey, retireAuthority: true });
        const deployed: P256Hint = {
          scheme: 'p256-webauthn',
          credentialId,
          publicKey,
          policy: device.policy,
          address,
          salt,
          status: 'deployed',
        };
        // Recorded before activation: the salt is the only way to activate (Review Focus 2).
        await recordDeployed(deployed);
        onProgress?.('deployed');
        onProgress?.('activating');
        const active = await activate(deployed);
        onProgress?.('active');
        return account(active);
      } catch (e) {
        throw toPassportError(e);
      }
    },
    async openAccount() {
      try {
        const identity = await credentials.identify();
        const hint = await directory?.get(networkId, {
          kind: 'credential-id',
          credentialId: identity.credentialId,
        });
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
        const view = await readView(hint);
        if (
          (hint.status === 'active' || view.booted) &&
          (await findCounter(hint, view)) === undefined
        )
          throw notHeld(hint);
        return account(hint.status === 'active' ? hint : await finishActivation(hint, view));
      } catch (e) {
        throw toPassportError(e);
      }
    },
  };
}
