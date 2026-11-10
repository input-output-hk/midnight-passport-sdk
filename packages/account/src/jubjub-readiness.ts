/** Verified activation, sealed-reader readiness and inbox publication phases. */
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type {
  AccBinding,
  AccLedgerView,
  AccountDirectory,
  AccountViewingKey,
  Authoriser,
  Chain,
  JubjubPureCircuits,
  PassportPorts,
} from './ports/index.js';
import type { JubjubHint } from './jubjub-rotation-types.js';
import { accountInboxReader, hasInbox, type InboxLedgerView } from './inbox-view.js';
import type { Flow } from './flow.js';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { JUBJUB_READER_SCAN_LIMIT } from './jubjub-readers.js';
import { equal, samePoint, requirePure } from './jubjub-binding.js';

export interface JubjubReadinessHost {
  readonly ports: Pick<PassportPorts, 'records' | 'network'>;
  readonly authoriser: Authoriser;
  readonly viewingKey: AccountViewingKey;
  readonly directory: AccountDirectory;
  readonly networkId: string;
  readBinding(): Promise<AccBinding>;
  readChain(): Promise<Chain>;
  readonly read: ReturnType<typeof accountInboxReader>;
  readonly recordPure: WeakMap<JubjubHint, JubjubPureCircuits>;
  sleep(ms: number): Promise<void>;
  account(record: JubjubHint): PassportAccount;
}
const RETRIES = 30;
export async function awaitJubjubDeployment(
  host: JubjubReadinessHost,
  record: JubjubHint,
): Promise<InboxLedgerView> {
  const { readChain, sleep } = host;

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const view = await (await readChain()).readAccount(record.address, { includeInbox: true });
    if (view && hasInbox(view)) return view;
    await sleep(1000);
  }
  throw new PassportConnectorError('AccountNotFound', 'The deployed ACC did not appear on chain.');
}

export function findJubjubCounter(
  host: JubjubReadinessHost,
  record: JubjubHint,
  view: AccLedgerView,
): bigint | undefined {
  const { recordPure } = host;

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
}

export async function verifyJubjubKeyring(
  host: JubjubReadinessHost,
  record: JubjubHint,
  view: InboxLedgerView,
  pending: boolean,
) {
  const { viewingKey, networkId, authoriser } = host;

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
      const deviceHex = authoriser.devicePublicKeyHex;
      if (!deviceHex)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'The device-key source is unavailable.',
        );
      if (
        device?.kind !== 'device' ||
        device.device.readerPublicKey !== toHex(reader) ||
        device.device.devicePublicKey !== (await deviceHex.call(authoriser))
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
}

export async function awaitJubjubAdvance(
  host: JubjubReadinessHost,
  record: JubjubHint,
  nonce: bigint,
): Promise<InboxLedgerView> {
  const { read, sleep } = host;

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const view = await read(record);
    if (view.authNonce > nonce) return view;
    await sleep(1000);
  }
  throw new PassportConnectorError('InternalError', 'The ACC call did not appear in the ledger.');
}

export async function awaitJubjubActivation(
  host: JubjubReadinessHost,
  record: JubjubHint,
): Promise<InboxLedgerView> {
  const { read, sleep } = host;

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const view = await read(record);
    if (view.booted) return view;
    await sleep(1000);
  }
  throw new PassportConnectorError('InternalError', 'ACC activation did not appear in the ledger.');
}

export async function appendJubjubInbox(
  host: JubjubReadinessHost,
  flow: Flow,
  record: JubjubHint,
  entry: Uint8Array,
  view: AccLedgerView,
) {
  const { recordPure, authoriser, readChain } = host;

  const pure = recordPure.get(record);
  if (!pure) throw new PassportConnectorError('InternalError', 'No pinned binding for account.');
  const counter = findJubjubCounter(host, record, view);
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
  return awaitJubjubAdvance(host, record, view.authNonce);
}

export async function finishJubjubReadiness(
  host: JubjubReadinessHost,
  flow: Flow,
  record: JubjubHint,
  view: InboxLedgerView,
) {
  const { readBinding, readChain, recordPure, directory, networkId, ports } = host;

  const pure = requirePure((await readBinding()).pureCircuits);
  recordPure.set(record, pure);
  const pending = record.status === 'deployed';
  await verifyJubjubKeyring(host, record, view, pending);
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
    view = await awaitJubjubActivation(host, record);
  }
  if (findJubjubCounter(host, record, view) === undefined)
    throw new PassportConnectorError('AccountNotFound', 'This passkey has no live ACC entry.');
  if (pending) {
    for (const entry of record.keyEntries ?? []) {
      if (view.inboxEntries.some((held) => equal(held, entry))) continue;
      view = await appendJubjubInbox(host, flow, record, entry, view);
    }
  }
  await verifyJubjubKeyring(host, record, view, false);
  const active: JubjubHint = { ...record, status: 'active' };
  recordPure.set(active, pure);
  if (pending) await flow.step('directory.write', () => directory.put(networkId, active), 'always');
  // Grant APIs require the same verified local record as address-based opening.
  // Reconstruct it after successful create/directory reopening as well; the
  // current live counter is authoritative, never an old profile's cached value.
  const counter = findJubjubCounter(host, active, view);
  if (counter === undefined)
    throw new PassportConnectorError('NotAuthorised', 'This device has no live ACC entry.');
  await ports.records?.write({
    address: active.address,
    bindingId: ports.network.bindingId,
    scheme: 'jubjub-schnorr',
    credentialId: Uint8Array.from(active.credentialId),
    localUseCounter: counter,
  });
  return host.account(active);
}
