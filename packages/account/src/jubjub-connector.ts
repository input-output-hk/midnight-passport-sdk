import {
  PASSPORT_API_VERSION,
  type FlowOptions,
  type PassportAccount,
  type PassportConnectorAPI,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { startFlow, type Flow } from './flow.js';
import type {
  AccLedgerView,
  AccountHint,
  Authoriser,
  CurvePoint,
  JubjubPureCircuits,
  PassportPorts,
} from './ports/index.js';

/** Lace's current Passport device-entry rescan bound (PR #2845, 05e1e3d). */
const MAX_SCAN = 4096n;
const RETRIES = 30;
const equal = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((byte, index) => byte === b[index]);
const samePoint = (a: CurvePoint, b: CurvePoint): boolean => a.x === b.x && a.y === b.y;
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
  ] as const) {
    if (typeof pure[name] !== 'function')
      throw new PassportConnectorError('BindingUnsupported', `ACC binding lacks ${name}.`);
  }
  return pure as JubjubPureCircuits;
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
  const read = async (record: JubjubHint): Promise<AccLedgerView> => {
    const view = await (await readChain()).readAccount(record.address, { includeInbox: true });
    if (!view) throw new PassportConnectorError('AccountNotFound', `No ACC at ${record.address}.`);
    if (!view.encKey || !view.inboxEntries)
      throw new PassportConnectorError('BindingUnsupported', 'The chain port omits the ACC inbox.');
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
    for (let counter = 0n; counter < MAX_SCAN; counter++) {
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
    if (signed.scheme !== 'jubjub-schnorr')
      throw new PassportConnectorError('InternalError', 'The authoriser returned another arm.');
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
    if (pending)
      await flow.step('directory.write', () => directory.put(networkId, active), 'always');
    return account(active);
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
            { kind: 'create-account' },
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
