/** Admission and live reader facts for one JubJub viewing-key transition. */
import type { FlowDescriptor } from './ports/index.js';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { validGrantId } from './grant-publication-state.js';
import { resolveJubjubReaders, resolveRegisteredReaders } from './jubjub-readers.js';
import { resolveRemovalReader } from './removal-reader.js';
import { rotationEqual as equal } from './jubjub-rotation-types.js';
import type {
  EnrollmentContext,
  JubjubHint,
  JubjubRotationContext,
  OpenRotation,
  RotationCapabilities,
  RotationIntent,
  RotationOperation,
  RotationRevocation,
} from './jubjub-rotation-types.js';
import type { Flow } from './flow.js';
import type { DeviceInboxLedgerView } from './inbox-view.js';
import type { JubjubPureCircuits } from './ports/index.js';

function capabilities(context: JubjubRotationContext): RotationCapabilities {
  const { holdings, readGrants } = context.ports;
  const { reencryptInbox: reencrypt, decodeDevicePublicKey: decode } = context.viewingKey;
  if (!holdings || !reencrypt || !decode || !readGrants)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'JubJub rotation needs verified holdings, an active read-grant source and the full viewing-key port.',
    );
  return { holdings, reencrypt, decode, readGrants };
}

async function revocationAccess(context: JubjubRotationContext, grantId: string | undefined) {
  if (!grantId) return undefined;
  if (!validGrantId(grantId))
    throw new PassportConnectorError('GrantScopeInvalid', 'The grant id must be 32-byte hex.');
  const { records, grantDetails: grants } = context.ports;
  if (!records || !grants)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'Read grant revocation needs live grant details and local account records.',
    );
  if (!(await records.exists()))
    throw new PassportConnectorError('AccountNotFound', 'No local account record exists.');
  return { grantId, records, grants };
}

function checkInitialDevice(
  context: JubjubRotationContext,
  record: JubjubHint,
  pure: JubjubPureCircuits,
  initial: DeviceInboxLedgerView,
  target: Uint8Array | undefined,
) {
  if (!initial.booted || record.status !== 'active')
    throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
  if (initial.specVersion !== 3)
    throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
  const counter = context.findCounter(record, initial);
  if (counter === undefined)
    throw new PassportConnectorError('NotAuthorised', 'This device has no live ACC entry.');
  const ownEntry = pure.derive_device_entry_with_jubjub(
    { bytes: fromHex(record.address) },
    record.publicKey,
    initial.deviceEpoch,
    counter,
  );
  if (!target) return;
  if (equal(target, ownEntry))
    throw new PassportConnectorError('LastDevice', 'A device cannot remove itself.');
  if (!initial.deviceEntries.some((entry) => equal(entry, target)))
    throw new PassportConnectorError(
      'RemovalTargetNotFound',
      'The target is absent from the live ACC device set.',
    );
}

async function checkInitialReadGrant(
  record: JubjubHint,
  flow: Flow,
  initial: DeviceInboxLedgerView,
  revocation: RotationRevocation,
  capabilities: RotationCapabilities,
) {
  const grant = await flow.step('grant.roster', () =>
    revocation.grants.readGrant(record.address, revocation.grantId),
  );
  if (!grant) throw new PassportConnectorError('GrantNotFound', 'The grant is missing.');
  if (!grant.active)
    throw new PassportConnectorError('GrantRevoked', 'The grant is already revoked.');
  if (!grant.read)
    throw new PassportConnectorError('GrantScopeInvalid', 'The grant has no read access.');
  if (grant.authNonce !== initial.authNonce)
    throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster is stale.');
  const targets = await flow.step('grant.roster', () =>
    capabilities.readGrants.readActiveReadGrantTargets(record.address),
  );
  if (
    targets.authNonce !== initial.authNonce ||
    !targets.targets.some(({ grantId }) => grantId === revocation.grantId)
  )
    throw new PassportConnectorError('GrantRosterUnsettled', 'The read grant is absent.');
}

export async function planJubjubRotation(
  context: JubjubRotationContext,
  record: JubjubHint,
  flow: Flow,
  removal: string | undefined,
  enrollment: EnrollmentContext | undefined,
  revocationId: string | undefined,
  revokeAll: boolean,
): Promise<RotationOperation> {
  const checkedCapabilities = capabilities(context);
  const revocation = await revocationAccess(context, revocationId);
  const { binding, pure } = await context.resolveBinding(record);
  if (removal !== undefined && !/^[0-9a-f]{64}$/i.test(removal))
    throw new PassportConnectorError(
      'RemovalTargetNotFound',
      'The target must be a 32-byte device commitment.',
    );
  const target = removal === undefined ? undefined : fromHex(removal.toLowerCase());
  const initial =
    enrollment?.initial ??
    (target || revocation || revokeAll
      ? await flow.step('chain.read', () => context.read(record))
      : undefined);
  let intent: RotationIntent = { kind: 'rotate' };
  if (initial) {
    checkInitialDevice(context, record, pure, initial, target);
    if (revocation)
      await checkInitialReadGrant(record, flow, initial, revocation, checkedCapabilities);
    if (target) intent = { kind: 'remove', target, initial };
    else if (enrollment) intent = { kind: 'enroll', enrollment, initial };
    else if (revokeAll) intent = { kind: 'revoke-all', initial };
    else if (revocation) intent = { kind: 'revoke', revocation, initial };
  }
  return { context, record, flow, capabilities: checkedCapabilities, binding, pure, intent };
}

export function rotationDescriptor({ intent, record }: RotationOperation): FlowDescriptor {
  switch (intent.kind) {
    case 'remove':
      return {
        kind: 'remove-device',
        account: record.address,
        commitmentHex: toHex(intent.target),
        devices: intent.initial.deviceEntries
          .filter((entry) => !equal(entry, intent.target))
          .map(toHex),
      };
    case 'enroll':
      return {
        kind: 'add-device',
        account: record.address,
        commitmentHex: toHex(intent.enrollment.entry),
        reader: intent.enrollment.reader,
        devices: intent.initial.deviceEntries.map(toHex),
      };
    case 'revoke-all':
      return {
        kind: 'revoke-all-grants',
        account: record.address,
        read: true,
        devices: intent.initial.deviceEntries.map(toHex),
      };
    case 'revoke':
      return {
        kind: 'revoke-grant',
        account: record.address,
        grantId: intent.revocation.grantId,
        read: true,
        devices: intent.initial.deviceEntries.map(toHex),
      };
    case 'rotate':
      return { kind: 'rotate-encryption-key' };
  }
}

async function checkLocalRevocationRecord(operation: RotationOperation) {
  const { intent, record, context } = operation;
  if (intent.kind !== 'revoke') return;
  const stored = await intent.revocation.records.read();
  if (
    stored?.scheme !== 'jubjub-schnorr' ||
    stored.address !== record.address ||
    stored.bindingId !== context.ports.network.bindingId ||
    !stored.credentialId ||
    !equal(stored.credentialId, record.credentialId)
  )
    throw new PassportConnectorError(
      'NotAuthorised',
      'The local record does not match this device.',
    );
}

function checkApprovedView(
  { intent }: RotationOperation,
  view: DeviceInboxLedgerView,
  ownEntry: Uint8Array,
) {
  if (!view.deviceEntries.some((entry) => equal(entry, ownEntry)))
    throw new PassportConnectorError('InternalError', 'The ledger device set is inconsistent.');
  if (
    intent.kind !== 'rotate' &&
    (view.authNonce !== intent.initial.authNonce ||
      view.deviceEpoch !== intent.initial.deviceEpoch ||
      !equal(view.encKey, intent.initial.encKey))
  )
    throw new PassportConnectorError(
      intent.kind === 'revoke' ? 'GrantRosterUnsettled' : 'DeviceRosterInvalid',
      'The ACC changed after the owner flow was approved.',
    );
  if (intent.kind === 'remove' && !view.deviceEntries.some((entry) => equal(entry, intent.target)))
    throw new PassportConnectorError(
      'RemovalTargetNotFound',
      'The target is absent from the live ACC device set.',
    );
  if (
    intent.kind === 'enroll' &&
    view.deviceEntries.some((entry) => equal(entry, intent.enrollment.entry))
  )
    throw new PassportConnectorError('DeviceRosterInvalid', 'The joining device is live.');
}

function resolveRotationReaders(
  operation: RotationOperation,
  view: DeviceInboxLedgerView,
  opened: OpenRotation['opened'],
  ownEntry: Uint8Array,
) {
  const { context, record, intent, capabilities, pure, binding } = operation;
  const registered = opened.flatMap((entry) => (entry?.kind === 'device' ? [entry.device] : []));
  const input = {
    account: record.address,
    epoch: view.deviceEpoch,
    registered,
    liveEntries: view.deviceEntries,
    ...(intent.kind === 'remove' && {
      allowedEntries: view.deviceEntries.filter((entry) => !equal(entry, intent.target)),
    }),
    pure,
    decodeDevicePublicKey: capabilities.decode,
  };
  const decodeP256 = context.viewingKey.decodeP256DevicePublicKey;
  if (registered.some((entry) => entry.scheme === 'p256-webauthn') && !decodeP256)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'A mixed roster needs a P-256 registration decoder.',
    );
  const roster = decodeP256
    ? resolveRegisteredReaders({
        ...input,
        p256Pure: binding.pureCircuits,
        decodeP256DevicePublicKey: decodeP256,
      })
    : resolveJubjubReaders(input);
  if (intent.kind === 'enroll') checkEnrollmentRoster(operation, intent.enrollment, opened, roster);
  if (
    roster.dropped.some(
      (entry) => !equal(entry, ownEntry) || (intent.kind !== 'remove' && intent.kind !== 'enroll'),
    )
  )
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'A live device has no unique, usable reader registration.',
    );
  return roster;
}

function checkEnrollmentRoster(
  { context }: RotationOperation,
  enrollment: EnrollmentContext,
  opened: OpenRotation['opened'],
  roster: OpenRotation['roster'],
) {
  if (
    opened.some(
      (item) =>
        item?.kind === 'device' && context.conflictsWithReader(item.device, enrollment.reader),
    )
  )
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'The joining reader or signing key already has a roster registration.',
    );
  if (
    roster.readers.some(
      (item) =>
        item.readerPublicKey === enrollment.reader.readerPublicKey &&
        item.devicePublicKey === enrollment.reader.devicePublicKey,
    )
  )
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'The joining device already has a live entry.',
    );
}

export async function openJubjubRotation(operation: RotationOperation): Promise<OpenRotation> {
  const { context, record, flow, pure, intent } = operation;
  const view = await flow.step('chain.read', () => context.read(record));
  if (!view.booted || record.status !== 'active')
    throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
  if (view.specVersion !== 3)
    throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
  const ownCounter = context.findCounter(record, view);
  if (ownCounter === undefined)
    throw new PassportConnectorError('AccountNotFound', 'This device is not live on the ACC.');
  await checkLocalRevocationRecord(operation);
  await context.keyring(record, view, false);
  const oldEntries = [...view.inboxEntries];
  const oldKeyring = {
    account: record.address,
    encKey: view.encKey,
    envelopes: [...oldEntries].reverse(),
  };
  const opened = await context.viewingKey.openInbox(
    context.ports.network.networkId,
    oldKeyring,
    oldEntries,
  );
  if (opened.length !== oldEntries.length)
    throw new PassportConnectorError('InternalError', 'The viewing key skipped inbox entries.');
  const ownEntry = pure.derive_device_entry_with_jubjub(
    { bytes: fromHex(record.address) },
    record.publicKey,
    view.deviceEpoch,
    ownCounter,
  );
  checkApprovedView(operation, view, ownEntry);
  const reader = toHex(await context.viewingKey.readerPublicKey(context.ports.network.networkId));
  const device = await context.ownerPublicKeyHex();
  const roster = resolveRotationReaders(operation, view, opened, ownEntry);
  const removedReader = intent.kind === 'remove' ? await resolveRemovalReader(roster) : undefined;
  return { view, oldEntries, oldKeyring, opened, ownEntry, reader, device, roster, removedReader };
}
