/** Fresh material publication and the final live-state fence before a key switch. */
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { sealActiveReadGrants } from './read-grant-deliveries.js';
import { rotationEqual as equal } from './jubjub-rotation-types.js';
import type { OpenRotation, RotationMaterial, RotationOperation } from './jubjub-rotation-types.js';
import type { DeviceInboxLedgerView, InboxLedgerView } from './inbox-view.js';
import type { ActiveReadGrantTarget } from './ports/index.js';

function verifiedEntries(opened: OpenRotation, indices: readonly number[]): Uint8Array[] {
  const seen = new Set<number>();
  const entries: Uint8Array[] = [];
  for (const index of indices) {
    const entry = opened.oldEntries[index];
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= opened.oldEntries.length ||
      seen.has(index) ||
      opened.opened[index]?.kind !== 'coin' ||
      !entry
    )
      throw new PassportConnectorError('InternalError', 'Invalid verified holding index.');
    seen.add(index);
    entries.push(entry);
  }
  return entries;
}

function completeReencryption(entries: (Uint8Array | null)[], expected: number): Uint8Array[] {
  if (
    entries.length !== expected ||
    !entries.every((entry): entry is Uint8Array => entry instanceof Uint8Array)
  )
    throw new PassportConnectorError('InternalError', 'A verified holding could not be sealed.');
  return entries;
}

const orderedGrants = (targets: readonly ActiveReadGrantTarget[]) =>
  targets.map(({ grantId, readPublicKey }) => `${grantId}:${readPublicKey ?? ''}`).sort();

function checkDeliveries(
  { intent }: RotationOperation,
  { removedReader }: OpenRotation,
  deliveries: RotationMaterial['deliveries'],
) {
  if (deliveries.unsealedGrantIds.length)
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'Every surviving read grantee must receive the fresh viewing secret.',
    );
  if (
    removedReader &&
    deliveries.targets.some(({ readPublicKey }) => readPublicKey === removedReader.readerPublicKey)
  )
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'An active read grant would return the fresh key to the removed reader.',
    );
  if (
    intent.kind === 'revoke' &&
    !deliveries.targets.some(({ grantId }) => grantId === intent.revocation.grantId)
  )
    throw new PassportConnectorError('GrantRosterUnsettled', 'The read grant disappeared.');
  if (
    intent.kind === 'enroll' &&
    (deliveries.unsealedGrantIds.length ||
      JSON.stringify(orderedGrants(deliveries.targets)) !==
        JSON.stringify(orderedGrants(intent.enrollment.grants)))
  )
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'Enrollment cannot preserve every active read grant.',
    );
}

export async function prepareJubjubRotationMaterial(
  operation: RotationOperation,
  opened: OpenRotation,
): Promise<RotationMaterial> {
  const { context, capabilities, record, intent, flow } = operation;
  const {
    viewingKey,
    ports: {
      network: { networkId },
    },
  } = context;
  const indices = await capabilities.holdings.selectHeldEntries(
    record.address,
    opened.oldEntries,
    opened.opened,
  );
  const holdingEntries = verifiedEntries(opened, indices);
  const registrations = opened.oldEntries.filter(
    (entry) =>
      entry.length === 192 &&
      (entry[1] === 1 || entry[1] === 2) &&
      (entry[0] === 0xd2 || entry[0] === 0xd4 || entry[0] === 0xd5),
  );
  const keys = await viewingKey.createKeys(networkId, {
    devicePublicKey: opened.device,
    keyring: opened.oldKeyring,
    registrations,
    readers: opened.roster.readers.filter((item) => item.readerPublicKey !== opened.reader),
    ...((intent.kind === 'remove' || intent.kind === 'enroll') && { rotateRoster: true }),
    ...(opened.removedReader && {
      removed: {
        devicePublicKey: opened.removedReader.devicePublicKey,
        epoch: opened.removedReader.epoch,
        counter: opened.removedReader.counter,
      },
    }),
  });
  const reencrypted = completeReencryption(
    await capabilities.reencrypt(
      networkId,
      { keyring: opened.oldKeyring, to: keys.encKey },
      holdingEntries,
    ),
    holdingEntries.length,
  );
  const deliveries = await sealActiveReadGrants(
    {
      networkId,
      keyring: { account: record.address, encKey: keys.encKey, envelopes: keys.envelopes },
      authNonce: opened.view.authNonce,
      ...(intent.kind === 'revoke' && { exceptGrantId: intent.revocation.grantId }),
      ...(intent.kind === 'revoke-all' && { exceptAll: true }),
      ...flow.ports,
    },
    { targets: capabilities.readGrants, viewingKey, random: context.random },
  );
  checkDeliveries(operation, opened, deliveries);
  return {
    keys,
    reencrypted,
    deliveries,
    deliveryEntries: deliveries.sealed.map(({ entry }) => entry),
  };
}

/** Count ciphertext occurrences: duplicate entries must not disappear in a Set comparison. */
function checkInbox(expectedEntries: readonly Uint8Array[], actual: readonly Uint8Array[]) {
  const expected = new Map<string, number>();
  for (const entry of expectedEntries) {
    const value = toHex(entry);
    expected.set(value, (expected.get(value) ?? 0) + 1);
  }
  for (const entry of actual) {
    const value = toHex(entry);
    const remaining = expected.get(value) ?? 0;
    if (!remaining)
      throw new PassportConnectorError('InternalError', 'The ACC inbox changed during rotation.');
    expected.set(value, remaining - 1);
  }
  if ([...expected.values()].some((remaining) => remaining !== 0))
    throw new PassportConnectorError('InternalError', 'The ACC inbox lost an expected entry.');
}

function checkPublishedDevices(
  { record, pure }: RotationOperation,
  opened: OpenRotation,
  view: DeviceInboxLedgerView,
  counter: bigint,
) {
  const latestOwn = pure.derive_device_entry_with_jubjub(
    { bytes: fromHex(record.address) },
    record.publicKey,
    view.deviceEpoch,
    counter,
  );
  const baseline = opened.view.deviceEntries
    .filter((entry) => !equal(entry, opened.ownEntry))
    .map(toHex)
    .sort();
  const current = view.deviceEntries
    .filter((entry) => !equal(entry, latestOwn))
    .map(toHex)
    .sort();
  if (baseline.length !== current.length || baseline.some((item, i) => item !== current[i]))
    throw new PassportConnectorError('InternalError', 'The live device roster changed.');
}

export async function publishJubjubRotationMaterial(
  operation: RotationOperation,
  opened: OpenRotation,
  material: RotationMaterial,
): Promise<{ readonly view: DeviceInboxLedgerView; readonly counter: bigint }> {
  const { context, record, flow, capabilities } = operation;
  const freshEntries = [
    ...material.keys.envelopes,
    ...material.keys.registrations,
    ...material.deliveryEntries,
  ];
  let published: InboxLedgerView = opened.view;
  for (const entry of freshEntries)
    published = await context.append(flow, record, entry, published);
  const view = await context.read(record);
  if (!equal(view.encKey, opened.oldKeyring.encKey))
    throw new PassportConnectorError(
      'EncryptionKeyMismatch',
      'The ACC key changed during rotation.',
    );
  const counter = context.findCounter(record, view);
  if (counter === undefined)
    throw new PassportConnectorError('AccountNotFound', 'This device is no longer live.');
  checkPublishedDevices(operation, opened, view, counter);
  checkInbox([...opened.oldEntries, ...freshEntries], view.inboxEntries);
  const latestGrants = await flow.step('grant.roster', () =>
    capabilities.readGrants.readActiveReadGrantTargets(record.address),
  );
  if (
    latestGrants.authNonce !== view.authNonce ||
    JSON.stringify(orderedGrants(material.deliveries.targets)) !==
      JSON.stringify(orderedGrants(latestGrants.targets))
  )
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'The active read-grant roster changed during rotation.',
    );
  return { view, counter };
}
