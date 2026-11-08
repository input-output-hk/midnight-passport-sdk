import { toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { validSealedEntries, type SealedP256Hint } from './p256-device.js';
import {
  readinessEqual,
  type P256ReadinessHost,
  type PendingSealedP256Hint,
  type SealedReaderInput,
} from './p256-readiness-types.js';
import type { AccLedgerView, OpenedInboxEntry } from './ports/index.js';

const hasCreationEntries = (record: SealedP256Hint): record is PendingSealedP256Hint =>
  validSealedEntries(record.keyEntries);

function admitSealedReader(
  host: P256ReadinessHost,
  record: SealedP256Hint,
  view: AccLedgerView,
  pending: boolean,
): SealedReaderInput {
  const keyring = host.viewingKey;
  const devicePublicKeyHex = host.authoriser.devicePublicKeyHex?.bind(host.authoriser);
  const { encKey, inboxEntries } = view;
  if (!keyring || !devicePublicKeyHex || !encKey || !inboxEntries)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'P-256 sealed accounts need an inbox reader, keyring and compressed device key.',
    );
  let pendingRecord: PendingSealedP256Hint | undefined;
  if (pending) {
    if (!hasCreationEntries(record))
      throw new PassportConnectorError(
        'BindingUnsupported',
        'The pending ACC has no sealed creation entries.',
      );
    pendingRecord = record;
  }
  return {
    keyring,
    devicePublicKeyHex,
    encKey,
    entries: pendingRecord ? [...inboxEntries, ...pendingRecord.keyEntries] : [...inboxEntries],
    pendingRecord,
  };
}

async function authenticatePendingRegistration(
  host: P256ReadinessHost,
  input: SealedReaderInput,
  record: SealedP256Hint,
  opened: readonly (OpenedInboxEntry | null)[],
): Promise<void> {
  const device = opened[1];
  const reader = await input.keyring.readerPublicKey(host.networkId);
  const deviceKey = await input.devicePublicKeyHex();
  if (
    device?.kind !== 'device' ||
    device.device.scheme !== 'p256-webauthn' ||
    device.device.readerPublicKey !== toHex(reader) ||
    device.device.devicePublicKey !== deviceKey ||
    (device.device.policy !== undefined &&
      (!readinessEqual(device.device.policy.rp_id_hash, record.policy.rp_id_hash) ||
        !readinessEqual(device.device.policy.origin, record.policy.origin)))
  )
    throw new Error('the sealed registration does not name this device');
}

/** Authenticate a real batch; an empty keyring batch can be a transport no-op. */
export async function authenticateSealedReader(
  host: P256ReadinessHost,
  record: SealedP256Hint,
  view: AccLedgerView,
  pending: boolean,
  inOwnerSession = false,
): Promise<SealedReaderInput> {
  const input = admitSealedReader(host, record, view, pending);
  const check = async () => {
    if (!input.entries.length) throw new Error('the ACC inbox has no sealed key entries');
    const opened = await input.keyring.openInbox(
      host.networkId,
      { account: record.address, encKey: input.encKey, envelopes: [...input.entries].reverse() },
      input.pendingRecord ? input.pendingRecord.keyEntries : input.entries.slice(0, 1),
    );
    if (pending) await authenticatePendingRegistration(host, input, record, opened);
  };
  try {
    if (host.authoriser.withKeySession && !inOwnerSession)
      await host.authoriser.withKeySession(check, { kind: 'sign-in', account: record.address });
    else await check();
  } catch (cause) {
    throw new PassportConnectorError(
      'EncryptionKeyMismatch',
      'No sealed envelope for this passkey opens the ACC encryption key.',
      { cause },
    );
  }
  return input;
}

/** Deliberately raw observations: 30 unsuccessful reads each have their original sleep. */
export async function observeSealedAccount(
  host: P256ReadinessHost,
  record: SealedP256Hint,
  ready: (view: AccLedgerView) => boolean,
): Promise<AccLedgerView> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const view = await (await host.chain()).readAccount(record.address, { includeInbox: true });
    if (view && ready(view)) return view;
    await host.sleep(1000);
  }
  throw new PassportConnectorError('InternalError', 'The sealed ACC call did not appear on chain.');
}
