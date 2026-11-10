import { p256AccountView } from './p256-account-view.js';
import { PassportConnectorError } from './errors.js';
import { createP256Observation } from './p256-observation.js';
import { composeP256Operations } from './p256-composition.js';
import { createP256Account } from './p256-creation.js';
import { activateCreatedAccount, recordDeployedHint } from './p256-activation.js';
import { openDirectoryP256Account, openKnownP256Account } from './p256-account-open.js';
import type { P256ReadinessHost } from './p256-readiness-types.js';
import { authenticateSealedReader, observeSealedAccount } from './p256-sealed-reader.js';
import { appendP256InboxEntry, finishSealedAccount } from './p256-sealed-readiness.js';
import { withLoginSession } from './with-login-session.js';
import { type P256Hint, type SealedP256Hint } from './p256-device.js';
import { lazyPort } from './lazy-port.js';
import {
  PASSPORT_API_VERSION,
  type CreateAccountStep,
  type FlowOptions,
  type PassportConnectorAPI,
} from '@input-output-hk/mn-passport-protocol';
import { createJubjubAccounts } from './jubjub-connector.js';
import { startFlow, type Flow } from './flow.js';
import type { AccLedgerView, PassportPorts } from './ports/index.js';

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
/** Both browsers and Node have `setTimeout`; the package compiles without either's types. */
const timers = globalThis as unknown as { setTimeout(run: () => void, ms: number): unknown };
const sleep = (ms: number) => new Promise<void>((resolve) => timers.setTimeout(resolve, ms));
/** Web Crypto's generator, which browsers and Node both have. */
const webRandom = (length: number) =>
  (
    globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(new Uint8Array(length));

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

  const { readAccount, readView, findCounter, notHeld, useCounter } = createP256Observation(
    { binding, chain, viewingKey },
    RESCAN_LIMIT,
  );
  const readiness: P256ReadinessHost = {
    ports,
    authoriser,
    credentials,
    directory,
    encryptionKey,
    network,
    networkId,
    viewingKey,
    binding,
    chain,
    readView,
    findCounter,
    notHeld,
    sleep,
  };
  const sealedKeyring = (
    record: SealedP256Hint,
    view: AccLedgerView,
    pending: boolean,
    inOwnerSession = false,
  ) => authenticateSealedReader(readiness, record, view, pending, inOwnerSession);
  const awaitSealedView = (record: SealedP256Hint, ready: (view: AccLedgerView) => boolean) =>
    observeSealedAccount(readiness, record, ready);
  const appendP256 = (flow: Flow, record: SealedP256Hint, entry: Uint8Array, view: AccLedgerView) =>
    appendP256InboxEntry(readiness, flow, record, entry, view);
  const recordDeployed = (flow: Flow, record: P256Hint) =>
    recordDeployedHint(readiness, flow, record, DEPLOYED_PUT_RETRIES);
  const finishSealed = (flow: Flow, record: SealedP256Hint) =>
    finishSealedAccount(readiness, flow, record);
  const activate = (flow: Flow, record: P256Hint) =>
    activateCreatedAccount(readiness, flow, record);

  const accountHostBase = {
    ...readiness,
    ports,
    run,
    random,
    readAccount,
    useCounter,
    sealedKeyring,
  };
  const { addP256Device, rotateP256ViewingKey, revocation } = composeP256Operations({
    ...accountHostBase,
    appendP256,
    awaitSealedView,
  });
  const accountHost = { ...accountHostBase, addP256Device, rotateP256ViewingKey };
  const account = (record: P256Hint) => p256AccountView(accountHost, revocation, record);

  const api: PassportConnectorAPI = {
    apiVersion: PASSPORT_API_VERSION,
    networkId,
    bindingId: network.bindingId,
    createAccount: ({ userName, retireAuthority, onProgress, ...options }) =>
      run(
        options,
        (flow) =>
          createP256Account(userName, retireAuthority, {
            ports,
            flow,
            binding,
            random,
            recordDeployed,
            finishSealed,
            activate,
            account,
          }),
        onProgress,
      ),
    openAccountAt: (address, options = {}) =>
      run(options, async (flow) => account(await openKnownP256Account(readiness, flow, address))),
    openAccount: (options = {}) =>
      run(options, async (flow) => account(await openDirectoryP256Account(readiness, flow))),
  };
  return withLoginSession(credentials, api, ports.onAccountOpened);
}
