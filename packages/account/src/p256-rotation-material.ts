/** Verified holding material, ordered publication and the final live-state fence. */
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import type { DeviceInboxLedgerView } from './inbox-view.js';
import { p256 } from './p256-device.js';
import { readRotationView, rotationUnsupported } from './p256-rotation-plan.js';
import { rotationEqual as equal } from './p256-rotation-types.js';
import type {
  OpenedRotation,
  PublishedRotation,
  RotationMaterial,
  RotationOperation,
} from './p256-rotation-types.js';
import type { ActiveReadGrantTarget } from './ports/index.js';
import { sealActiveReadGrants } from './read-grant-deliveries.js';

function verifiedHoldingEntries(opened: OpenedRotation, indices: readonly number[]): Uint8Array[] {
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
    throw new PassportConnectorError('InternalError', 'A verified holding could not be resealed.');
  return entries;
}

function checkReadDeliveries(
  operation: RotationOperation,
  opened: OpenedRotation,
  deliveries: RotationMaterial['deliveries'],
) {
  const { excludedGrant } = operation;
  if (
    excludedGrant &&
    excludedGrant !== 'all' &&
    !deliveries.targets.some(({ grantId }) => grantId === excludedGrant)
  )
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'The read grant disappeared before key rotation.',
    );
  if (deliveries.unsealedGrantIds.length)
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'A surviving read grantee cannot receive the fresh key.',
    );
  const { removedReader } = opened;
  if (
    removedReader &&
    deliveries.targets.some(({ readPublicKey }) => readPublicKey === removedReader.readerPublicKey)
  )
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'An active read grant would return the fresh key to the removed reader.',
    );
}

export async function prepareP256RotationMaterial(
  operation: RotationOperation,
  opened: OpenedRotation,
): Promise<RotationMaterial> {
  const { host, capabilities, record, intent, excludedGrant, flow, controls } = operation;
  const { networkId, ports, random } = host;
  const holdings = ports.holdings;
  if (!holdings) return rotationUnsupported();
  const indices = await holdings.selectHeldEntries(
    record.address,
    opened.oldEntries,
    opened.opened,
  );
  const holdingEntries = verifiedHoldingEntries(opened, indices);
  const registrations = opened.oldEntries.filter(
    (entry) =>
      entry.length === 192 &&
      (entry[1] === 1 || entry[1] === 2) &&
      (entry[0] === 0xd2 || entry[0] === 0xd4 || entry[0] === 0xd5),
  );
  const keys = await capabilities.keyring.createKeys(networkId, {
    scheme: 'p256-webauthn',
    devicePublicKey: opened.ownerDevice,
    policy: record.policy,
    keyring: opened.oldKeyring,
    registrations,
    readers: opened.roster.readers.filter(
      (reader) => reader.readerPublicKey !== opened.ownerReader,
    ),
    ...((intent.kind === 'remove' || controls.rotateRosterForEnrollment) && { rotateRoster: true }),
    ...(opened.removedReader && {
      removed: {
        devicePublicKey: opened.removedReader.devicePublicKey,
        epoch: opened.removedReader.epoch,
        counter: opened.removedReader.counter,
      },
    }),
  });
  const { reencrypt } = capabilities;
  const reencrypted = completeReencryption(
    await reencrypt(networkId, { keyring: opened.oldKeyring, to: keys.encKey }, holdingEntries),
    holdingEntries.length,
  );
  const readGrants = ports.readGrants;
  if (!readGrants) return rotationUnsupported();
  const deliveries = await sealActiveReadGrants(
    {
      networkId,
      keyring: { account: record.address, encKey: keys.encKey, envelopes: keys.envelopes },
      authNonce: opened.view.authNonce,
      ...(excludedGrant === 'all' && { exceptAll: true }),
      ...(excludedGrant && excludedGrant !== 'all' && { exceptGrantId: excludedGrant }),
      ...flow.ports,
    },
    { targets: readGrants, viewingKey: capabilities.keyring, random },
  );
  checkReadDeliveries(operation, opened, deliveries);
  return {
    keys,
    reencrypted,
    deliveries,
    appended: [
      ...keys.envelopes,
      ...keys.registrations,
      ...deliveries.sealed.map(({ entry }) => entry),
    ],
  };
}

function checkPublishedState(
  opened: OpenedRotation,
  material: RotationMaterial,
  view: DeviceInboxLedgerView,
) {
  if (
    !equal(view.encKey, opened.view.encKey) ||
    view.deviceEpoch !== opened.view.deviceEpoch ||
    view.authNonce !== opened.view.authNonce + BigInt(material.appended.length)
  )
    throw new PassportConnectorError('DeviceRosterInvalid', 'The ACC changed during key delivery.');
}

function checkPublishedDevices(
  operation: RotationOperation,
  opened: OpenedRotation,
  view: DeviceInboxLedgerView,
  counter: bigint,
) {
  const { pure, record } = operation;
  const ownerEntry = (value: bigint) =>
    pure.derive_device_entry_with_p256(
      { bytes: fromHex(record.address) },
      p256(record.publicKey),
      record.policy,
      view.deviceEpoch,
      value,
    );
  const other = (entries: readonly Uint8Array[], own: Uint8Array) =>
    entries
      .filter((entry) => !equal(entry, own))
      .map(toHex)
      .sort();
  const baseline = other(opened.view.deviceEntries, ownerEntry(opened.counter));
  const current = other(view.deviceEntries, ownerEntry(counter));
  if (
    baseline.length !== current.length ||
    current.some((entry, index) => entry !== baseline[index])
  )
    throw new PassportConnectorError('DeviceRosterInvalid', 'The live device roster changed.');
}

/** Duplicate ciphertext occurrences are ledger facts, not interchangeable set membership. */
function checkPublishedInbox(
  expectedEntries: readonly Uint8Array[],
  actual: readonly Uint8Array[],
) {
  const expected = new Map<string, number>();
  for (const entry of expectedEntries) {
    const value = toHex(entry);
    expected.set(value, (expected.get(value) ?? 0) + 1);
  }
  for (const entry of actual) {
    const value = toHex(entry);
    const count = expected.get(value) ?? 0;
    if (!count)
      throw new PassportConnectorError('InternalError', 'The ACC inbox changed during delivery.');
    expected.set(value, count - 1);
  }
  if ([...expected.values()].some((count) => count !== 0))
    throw new PassportConnectorError('InternalError', 'The ACC inbox lost a sealed delivery.');
}

const targetKey = (targets: readonly ActiveReadGrantTarget[]) =>
  targets.map(({ grantId, readPublicKey }) => `${grantId}:${readPublicKey ?? ''}`).sort();

async function checkPublishedGrants(
  operation: RotationOperation,
  material: RotationMaterial,
  view: DeviceInboxLedgerView,
): Promise<bigint> {
  const { host, flow, record } = operation;
  const latestGrants = await flow.step('grant.roster', () => {
    const readGrants = host.ports.readGrants;
    if (!readGrants) return rotationUnsupported();
    return readGrants.readActiveReadGrantTargets(record.address);
  });
  if (
    latestGrants.authNonce !== view.authNonce ||
    JSON.stringify(targetKey(latestGrants.targets)) !==
      JSON.stringify(targetKey(material.deliveries.targets))
  )
    throw new PassportConnectorError('GrantRosterUnsettled', 'The read-grant roster changed.');
  return latestGrants.authNonce;
}

export async function publishP256RotationMaterial(
  operation: RotationOperation,
  opened: OpenedRotation,
  material: RotationMaterial,
): Promise<PublishedRotation> {
  const { host, record, flow } = operation;
  const { appendP256, findCounter, notHeld } = host;
  let view = opened.view;
  for (const entry of material.appended) {
    await appendP256(flow, record, entry, view);
    view = await readRotationView(operation);
  }
  checkPublishedState(opened, material, view);
  const counter = await findCounter(flow, record, view);
  if (counter === undefined) throw notHeld(record);
  checkPublishedDevices(operation, opened, view, counter);
  checkPublishedInbox([...opened.oldEntries, ...material.appended], view.inboxEntries);
  const grantNonce = await checkPublishedGrants(operation, material, view);
  return { view, counter, grantNonce };
}
