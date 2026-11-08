/** Admitted joiner, live account baseline and explicit enrollment concurrency fences. */
import type { PassportDeviceReader } from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { hasInbox } from './inbox-view.js';
import type { DeviceInboxLedgerView } from './inbox-view.js';
import { isSealedP256, p256, type P256Hint } from './p256-device.js';
import { snapshotDeviceReader } from './request-snapshots.js';
import { enrollmentEqual as equal } from './p256-enrollment-types.js';
import type {
  EnrollmentBaseline,
  EnrollmentJoiner,
  EnrollmentOperation,
  EnrollmentPlan,
  P256EnrollmentContext,
} from './p256-enrollment-types.js';
import type { Flow } from './flow.js';
import type {
  AccLedgerView,
  AccountViewingKey,
  ActiveReadGrantTarget,
  DeviceReader,
} from './ports/index.js';

function checkReader(reader: PassportDeviceReader) {
  const joiningP256 = 'scheme' in reader && reader.scheme === 'p256-webauthn';
  if (
    !/^[0-9a-f]{64}$/.test(reader.readerPublicKey) ||
    (!joiningP256 && 'scheme' in reader) ||
    (joiningP256 &&
      (!reader.policy ||
        !(reader.policy.rp_id_hash instanceof Uint8Array) ||
        reader.policy.rp_id_hash.length !== 32 ||
        !(reader.policy.origin instanceof Uint8Array) ||
        reader.policy.origin.length !== 21)) ||
    (!joiningP256 && 'policy' in reader)
  )
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'The joining reader or authoriser policy is malformed.',
    );
}

function decodeJoiner(
  reader: PassportDeviceReader,
  record: P256Hint,
  decodeP256: NonNullable<AccountViewingKey['decodeP256DevicePublicKey']>,
  decodeJubjub: NonNullable<AccountViewingKey['decodeDevicePublicKey']>,
): EnrollmentJoiner {
  if ('scheme' in reader) {
    const point = decodeP256(reader.devicePublicKey);
    if (!point || (point.x === record.publicKey.x && point.y === record.publicKey.y))
      throw new PassportConnectorError(
        'DeviceRosterInvalid',
        'The joining key must identify another valid device.',
      );
    return { kind: 'p256', reader, point };
  }
  const point = decodeJubjub(reader.devicePublicKey);
  if (!point)
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'The joining key must identify another valid device.',
    );
  return { kind: 'jubjub', reader, point };
}

async function admitEnrollment(
  context: P256EnrollmentContext,
  record: P256Hint,
  reader: PassportDeviceReader,
  flow: Flow,
): Promise<EnrollmentOperation> {
  const keyring = context.ports.viewingKey;
  const decodeP256 = keyring?.decodeP256DevicePublicKey;
  const decodeJubjub = keyring?.decodeDevicePublicKey;
  const pure = (await context.binding()).pureCircuits;
  const addChallenge = pure.challenge_add_device_with_p256;
  const deriveJubjub = pure.derive_device_entry_with_jubjub;
  const readGrants = context.ports.readGrants;
  if (
    !isSealedP256(record) ||
    !keyring ||
    !decodeP256 ||
    !decodeJubjub ||
    !addChallenge ||
    !deriveJubjub ||
    !readGrants ||
    !context.ports.authoriser.withKeySession
  )
    throw new PassportConnectorError(
      'BindingUnsupported',
      'P-256 enrollment needs a sealed keyring, joining-device decoder, key session and live read-grant source.',
    );
  checkReader(reader);
  return {
    context,
    record,
    flow,
    pure,
    capabilities: { keyring, readGrants, addChallenge, deriveJubjub },
    joiner: decodeJoiner(reader, record, decodeP256, decodeJubjub),
  };
}

function hasDeviceInbox(view: AccLedgerView): view is DeviceInboxLedgerView {
  return hasInbox(view) && Boolean(view.deviceEntries);
}

export async function readEnrollmentView({
  context,
  record,
  flow,
}: EnrollmentOperation): Promise<DeviceInboxLedgerView> {
  const view = await flow.step('chain.read', async () =>
    (await context.chain()).readAccount(record.address, {
      includeInbox: true,
      includeDevices: true,
    }),
  );
  if (!view) throw new PassportConnectorError('AccountNotFound', 'The ACC is absent.');
  if (!hasDeviceInbox(view))
    throw new PassportConnectorError(
      'BindingUnsupported',
      'The chain port omits ACC roster or inbox data.',
    );
  return view;
}

export function enrollmentOwnerEntry(
  operation: EnrollmentOperation,
  view: DeviceInboxLedgerView,
  counter: bigint,
) {
  return operation.pure.derive_device_entry_with_p256(
    { bytes: fromHex(operation.record.address) },
    p256(operation.record.publicKey),
    operation.record.policy,
    view.deviceEpoch,
    counter,
  );
}

export const otherDeviceEntries = (entries: readonly Uint8Array[], own: Uint8Array) =>
  entries
    .filter((entry) => !equal(entry, own))
    .map(toHex)
    .sort();

export const sameEnrollmentRoster = (before: readonly string[], after: readonly string[]) =>
  before.length === after.length && before.every((entry, index) => entry === after[index]);

export const enrollmentGrantFingerprint = (targets: readonly ActiveReadGrantTarget[]) =>
  JSON.stringify(
    targets.map(({ grantId, readPublicKey }) => `${grantId}:${readPublicKey ?? ''}`).sort(),
  );

export async function readEnrollmentGrants({ flow, capabilities, record }: EnrollmentOperation) {
  return flow.step('grant.roster', () =>
    capabilities.readGrants.readActiveReadGrantTargets(record.address),
  );
}

export async function planP256Enrollment(
  context: P256EnrollmentContext,
  record: P256Hint,
  input: PassportDeviceReader,
  flow: Flow,
): Promise<EnrollmentPlan> {
  // Readonly input annotations cannot isolate caller-owned Buffer policy bytes across the binding await.
  const reader = snapshotDeviceReader(input);
  const operation = await admitEnrollment(context, record, reader, flow);
  const view = await readEnrollmentView(operation);
  if (!view.booted || record.status !== 'active')
    throw new PassportConnectorError('AccountNotFound', 'The P-256 ACC is not active.');
  if (view.specVersion !== 3)
    throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
  const counter = await context.findCounter(flow, record, view);
  if (counter === undefined) throw context.notHeld(record);
  const { joiner, pure, capabilities } = operation;
  const self = { bytes: fromHex(record.address) };
  const otherDevices = otherDeviceEntries(
    view.deviceEntries,
    enrollmentOwnerEntry(operation, view, counter),
  );
  const target =
    joiner.kind === 'p256'
      ? pure.derive_device_entry_with_p256(
          self,
          joiner.point,
          joiner.reader.policy,
          view.deviceEpoch,
          0n,
        )
      : capabilities.deriveJubjub.call(pure, self, joiner.point, view.deviceEpoch, 0n);
  if (view.deviceEntries.some((held) => equal(held, target)))
    throw new PassportConnectorError('DeviceRosterInvalid', 'The joining device is already live.');
  const grants = await readEnrollmentGrants(operation);
  if (grants.authNonce !== view.authNonce)
    throw new PassportConnectorError('GrantRosterUnsettled', 'The read-grant roster is stale.');
  return { operation, target, baseline: { view, counter, otherDevices, grants } };
}

export function checkBeforeEnrollmentRotation(
  { operation, target }: EnrollmentPlan,
  baseline: EnrollmentBaseline,
  view: DeviceInboxLedgerView,
  grants: EnrollmentBaseline['grants'],
) {
  const roster = otherDeviceEntries(
    view.deviceEntries,
    enrollmentOwnerEntry(operation, baseline.view, baseline.counter),
  );
  if (
    view.authNonce !== baseline.view.authNonce ||
    view.deviceEpoch !== baseline.view.deviceEpoch ||
    !equal(view.encKey, baseline.view.encKey) ||
    !sameEnrollmentRoster(baseline.otherDevices, roster) ||
    view.deviceEntries.some((held) => equal(held, target)) ||
    grants.authNonce !== baseline.view.authNonce ||
    enrollmentGrantFingerprint(grants.targets) !==
      enrollmentGrantFingerprint(baseline.grants.targets)
  )
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'The ACC or read-grant roster changed before enrollment rotation.',
    );
}

export function checkAfterEnrollmentRotation(
  before: DeviceInboxLedgerView,
  after: DeviceInboxLedgerView,
) {
  if (
    after.deviceEpoch !== before.deviceEpoch ||
    after.authNonce <= before.authNonce ||
    equal(after.encKey, before.encKey)
  )
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'The ACC did not settle the expected enrollment rotation.',
    );
}

function registrationPolicyConflicts(joiner: EnrollmentJoiner, device: DeviceReader): boolean {
  if (joiner.kind === 'jubjub') return device.scheme === 'p256-webauthn' || Boolean(device.policy);
  return (
    device.scheme !== 'p256-webauthn' ||
    !device.policy ||
    !equal(device.policy.rp_id_hash, joiner.reader.policy.rp_id_hash) ||
    !equal(device.policy.origin, joiner.reader.policy.origin)
  );
}

export function enrollmentRegistrationConflicts(
  joiner: EnrollmentJoiner,
  device: DeviceReader,
): boolean {
  const { reader } = joiner;
  return (
    (device.readerPublicKey === reader.readerPublicKey ||
      device.devicePublicKey === reader.devicePublicKey) &&
    (device.readerPublicKey !== reader.readerPublicKey ||
      device.devicePublicKey !== reader.devicePublicKey ||
      registrationPolicyConflicts(joiner, device))
  );
}
