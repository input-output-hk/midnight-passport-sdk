/** Admit capabilities, owner binding and the exact live mixed reader roster. */
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import type { Flow } from './flow.js';
import type { DeviceInboxLedgerView } from './inbox-view.js';
import { resolveRegisteredReaders } from './jubjub-readers.js';
import { resolveRemovalReader } from './removal-reader.js';
import { isSealedP256, p256, type P256Hint } from './p256-device.js';
import { rotationEqual as equal } from './p256-rotation-types.js';
import type {
  OpenedRotation,
  P256RotationHost,
  RotationControls,
  RotationIntent,
  RotationOperation,
} from './p256-rotation-types.js';
import type { AccLedgerView, FlowDescriptor } from './ports/index.js';

export function rotationUnsupported(): never {
  throw new PassportConnectorError(
    'BindingUnsupported',
    'P-256 rotation needs sealed keys, both device decoders, verified holdings and a complete read-grant source.',
  );
}

function removalIntent(
  removal: string | undefined,
  challenge: RotationOperation['pure']['challenge_remove_device_with_p256'],
): RotationIntent {
  if (removal === undefined) return { kind: 'rotate' };
  if (!/^[0-9a-f]{64}$/i.test(removal))
    throw new PassportConnectorError(
      'RemovalTargetNotFound',
      'The target must be a 32-byte device commitment.',
    );
  if (!challenge) return rotationUnsupported();
  return { kind: 'remove', target: fromHex(removal.toLowerCase()), challenge };
}

export async function planP256Rotation(
  host: P256RotationHost,
  record: P256Hint,
  flow: Flow,
  removal: string | undefined,
  excludedGrant: string | undefined,
  controls: RotationControls,
): Promise<RotationOperation> {
  const keyring = host.viewingKey;
  const reencrypt = keyring?.reencryptInbox;
  const decodeJubjub = keyring?.decodeDevicePublicKey;
  const decodeP256 = keyring?.decodeP256DevicePublicKey;
  const { binding, authoriser, ports } = host;
  const pure = (await binding()).pureCircuits;
  const deriveJubjub = pure.derive_device_entry_with_jubjub;
  if (
    !isSealedP256(record) ||
    !keyring ||
    !reencrypt ||
    !decodeJubjub ||
    !decodeP256 ||
    !deriveJubjub ||
    !pure.challenge_append_inbox_with_p256 ||
    (removal !== undefined && !pure.challenge_remove_device_with_p256) ||
    !ports.holdings ||
    !ports.readGrants ||
    !authoriser.withKeySession ||
    !authoriser.deviceBinding ||
    !authoriser.devicePublicKeyHex
  )
    return rotationUnsupported();
  const intent = removalIntent(removal, pure.challenge_remove_device_with_p256);
  return {
    host,
    record,
    flow,
    pure,
    intent,
    excludedGrant,
    controls,
    capabilities: { keyring, reencrypt, decodeJubjub, decodeP256, deriveJubjub },
  };
}

export function rotationDescriptor({ record, intent }: RotationOperation): FlowDescriptor {
  return intent.kind === 'remove'
    ? { kind: 'remove-device', account: record.address, commitmentHex: toHex(intent.target) }
    : { kind: 'rotate-encryption-key', account: record.address };
}

export function withP256RotationSession<T>(
  operation: RotationOperation,
  work: () => Promise<T>,
): Promise<T> {
  if (operation.controls.inOwnerSession) return work();
  const { authoriser } = operation.host;
  const current = authoriser.withKeySession;
  if (!current) return rotationUnsupported();
  return current.bind(authoriser)(work, rotationDescriptor(operation));
}

function completeView(view: AccLedgerView): view is DeviceInboxLedgerView {
  return Boolean(view.encKey && view.inboxEntries && view.deviceEntries);
}

export async function readRotationView({
  host,
  flow,
  record,
}: RotationOperation): Promise<DeviceInboxLedgerView> {
  const { chain } = host;
  const view = await flow.step('chain.read', async () =>
    (await chain()).readAccount(record.address, { includeInbox: true, includeDevices: true }),
  );
  if (!view) throw new PassportConnectorError('AccountNotFound', 'The ACC is absent.');
  if (!completeView(view))
    throw new PassportConnectorError(
      'BindingUnsupported',
      'The chain port omits the ACC key, inbox or live devices.',
    );
  return view;
}

async function verifyRotationOwner({ host, record }: RotationOperation) {
  const { authoriser } = host;
  const selected = await authoriser.devicePublicKey();
  const binding = authoriser.deviceBinding;
  if (!binding) return rotationUnsupported();
  const selectedBinding = await binding.call(authoriser);
  if (
    selected.x !== record.publicKey.x ||
    selected.y !== record.publicKey.y ||
    !equal(selectedBinding.credentialId, record.credentialId) ||
    !equal(selectedBinding.policy.rp_id_hash, record.policy.rp_id_hash) ||
    !equal(selectedBinding.policy.origin, record.policy.origin)
  )
    throw new PassportConnectorError(
      'NotAuthorised',
      'The selected passkey does not own this ACC.',
    );
}

function checkRemovalTarget(
  operation: RotationOperation,
  view: DeviceInboxLedgerView,
  counter: bigint,
) {
  const { intent, pure, record } = operation;
  if (intent.kind !== 'remove') return;
  const own = pure.derive_device_entry_with_p256(
    { bytes: fromHex(record.address) },
    p256(record.publicKey),
    record.policy,
    view.deviceEpoch,
    counter,
  );
  if (equal(intent.target, own))
    throw new PassportConnectorError('LastDevice', 'A device cannot remove itself.');
  if (!view.deviceEntries.some((entry) => equal(entry, intent.target)))
    throw new PassportConnectorError('RemovalTargetNotFound', 'The target is not live.');
}

async function initialRotationView(operation: RotationOperation) {
  const { host, flow, record } = operation;
  await verifyRotationOwner(operation);
  const view = await readRotationView(operation);
  if (!view.booted || record.status !== 'active')
    throw new PassportConnectorError('AccountNotFound', 'The P-256 ACC is not active.');
  if (view.specVersion !== 3)
    throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
  const { findCounter, notHeld } = host;
  const counter = await findCounter(flow, record, view);
  if (counter === undefined) throw notHeld(record);
  checkRemovalTarget(operation, view, counter);
  return { view, counter };
}

function resolveRotationRoster(
  operation: RotationOperation,
  opened: OpenedRotation['opened'],
  view: DeviceInboxLedgerView,
  ownerReader: string,
  ownerDevice: string,
) {
  const { record, pure, intent, capabilities } = operation;
  const target = intent.kind === 'remove' ? intent.target : undefined;
  const roster = resolveRegisteredReaders({
    account: record.address,
    epoch: view.deviceEpoch,
    registered: opened.flatMap((item) => (item?.kind === 'device' ? [item.device] : [])),
    liveEntries: view.deviceEntries,
    ...(target && { allowedEntries: view.deviceEntries.filter((entry) => !equal(entry, target)) }),
    pure: { derive_device_entry_with_jubjub: capabilities.deriveJubjub },
    p256Pure: pure,
    decodeDevicePublicKey: capabilities.decodeJubjub,
    decodeP256DevicePublicKey: capabilities.decodeP256,
  });
  if (
    roster.dropped.length ||
    !roster.readers.some(
      (reader) =>
        reader.readerPublicKey === ownerReader &&
        reader.devicePublicKey === ownerDevice &&
        reader.scheme === 'p256-webauthn' &&
        reader.policy &&
        equal(reader.policy.rp_id_hash, record.policy.rp_id_hash) &&
        equal(reader.policy.origin, record.policy.origin),
    )
  )
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'Every live device needs one unique registered reader before rotation.',
    );
  return roster;
}

export async function openP256Rotation(operation: RotationOperation): Promise<OpenedRotation> {
  const { host, record, capabilities, intent } = operation;
  const { sealedKeyring, authoriser, networkId } = host;
  const { view, counter } = await initialRotationView(operation);
  await sealedKeyring(record, view, false, true);
  const oldEntries = [...view.inboxEntries];
  const oldKeyring = {
    account: record.address,
    encKey: view.encKey,
    envelopes: [...oldEntries].reverse(),
  };
  const opened = await capabilities.keyring.openInbox(networkId, oldKeyring, oldEntries);
  if (opened.length !== oldEntries.length)
    throw new PassportConnectorError('InternalError', 'The keyring returned an incomplete inbox.');
  const ownerReader = toHex(await capabilities.keyring.readerPublicKey(networkId));
  const deviceKey = authoriser.devicePublicKeyHex;
  if (!deviceKey) return rotationUnsupported();
  const ownerDevice = await deviceKey.call(authoriser);
  const roster = resolveRotationRoster(operation, opened, view, ownerReader, ownerDevice);
  const removedReader = intent.kind === 'remove' ? await resolveRemovalReader(roster) : undefined;
  return {
    view,
    counter,
    oldEntries,
    oldKeyring,
    opened,
    ownerReader,
    ownerDevice,
    roster,
    removedReader,
  };
}
