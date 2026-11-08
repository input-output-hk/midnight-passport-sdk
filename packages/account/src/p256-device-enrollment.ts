/** Enroll one checked reader: optional fresh-key rotation, delivery, live fence, then authority. */
import type {
  DeviceEnrollmentResult,
  DeviceRemovalResult,
  FlowOptions,
  PassportDeviceReader,
  PassportTxResult,
  ViewingKeyRotationResult,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import type { DeviceInboxLedgerView } from './inbox-view.js';
import { p256, type P256Hint } from './p256-device.js';
import {
  checkAfterEnrollmentRotation,
  checkBeforeEnrollmentRotation,
  enrollmentGrantFingerprint,
  enrollmentOwnerEntry,
  enrollmentRegistrationConflicts,
  otherDeviceEntries,
  planP256Enrollment,
  readEnrollmentGrants,
  readEnrollmentView,
  sameEnrollmentRoster,
} from './p256-enrollment-plan.js';
import { enrollmentEqual as equal } from './p256-enrollment-types.js';
import type {
  EnrollmentBaseline,
  EnrollmentPlan,
  EnrollmentReady,
  P256EnrollmentContext,
} from './p256-enrollment-types.js';
import type { DeviceDelivery } from './ports/index.js';

type EnrollmentRotation = ViewingKeyRotationResult | DeviceRemovalResult | undefined;

async function verifyEnrollmentOwner({ operation }: EnrollmentPlan) {
  const { context, record, joiner, capabilities } = operation;
  const selected = await context.ports.authoriser.devicePublicKey();
  const selectedBinding = await context.ownerBinding();
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
  if (
    joiner.reader.readerPublicKey ===
    toHex(await capabilities.keyring.readerPublicKey(context.ports.network.networkId))
  )
    throw new PassportConnectorError('DeviceRosterInvalid', 'The joining reader is the owner.');
}

async function rotateBeforeEnrollment(
  plan: EnrollmentPlan,
  options: FlowOptions,
): Promise<{ baseline: EnrollmentBaseline; rotation: EnrollmentRotation }> {
  const { operation, baseline } = plan;
  if (!baseline.grants.targets.length) return { baseline, rotation: undefined };
  const { context, record, flow } = operation;
  const before = await readEnrollmentView(operation);
  const approvedGrants = await readEnrollmentGrants(operation);
  checkBeforeEnrollmentRotation(plan, baseline, before, approvedGrants);
  // Existing rotation owns a nested Flow but deliberately joins this owner's add-device session.
  const rotation = await context.rotate(record, options);
  const view = await readEnrollmentView(operation);
  checkAfterEnrollmentRotation(before, view);
  const counter = await context.findCounter(flow, record, view);
  if (counter === undefined) throw context.notHeld(record);
  const otherDevices = otherDeviceEntries(
    view.deviceEntries,
    enrollmentOwnerEntry(operation, view, counter),
  );
  if (!sameEnrollmentRoster(baseline.otherDevices, otherDevices))
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'The live device roster changed during enrollment rotation.',
    );
  const grants = await readEnrollmentGrants(operation);
  if (
    grants.authNonce !== view.authNonce ||
    enrollmentGrantFingerprint(grants.targets) !==
      enrollmentGrantFingerprint(baseline.grants.targets)
  )
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'The read-grant roster changed during enrollment rotation.',
    );
  return { baseline: { view, counter, otherDevices, grants }, rotation };
}

async function sealEnrollmentDelivery(plan: EnrollmentPlan, baseline: EnrollmentBaseline) {
  const { operation } = plan;
  const { context, record, capabilities, joiner } = operation;
  const view = await readEnrollmentView(operation);
  if (
    view.authNonce !== baseline.view.authNonce ||
    view.deviceEpoch !== baseline.view.deviceEpoch ||
    !equal(view.encKey, baseline.view.encKey)
  )
    throw new PassportConnectorError('DeviceRosterInvalid', 'The ACC changed before enrollment.');
  await context.sealedKeyring(record, view, false, true);
  const keyring = {
    account: record.address,
    encKey: view.encKey,
    envelopes: [...view.inboxEntries].reverse(),
  };
  const networkId = context.ports.network.networkId;
  const opened = await capabilities.keyring.openInbox(networkId, keyring, view.inboxEntries);
  if (opened.length !== view.inboxEntries.length)
    throw new PassportConnectorError('InternalError', 'The keyring returned an incomplete inbox.');
  if (
    opened.some(
      (item) => item?.kind === 'device' && enrollmentRegistrationConflicts(joiner, item.device),
    )
  )
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'The joining reader or signing key conflicts with the roster.',
    );
  const delivery = await capabilities.keyring.sealToDevice(networkId, keyring, {
    ...joiner.reader,
    epoch: view.deviceEpoch,
    counter: 0n,
  });
  return { view, delivery };
}

async function checkDeliveredEnrollment(
  { operation, target }: EnrollmentPlan,
  baseline: EnrollmentBaseline,
  view: DeviceInboxLedgerView,
  delivery: DeviceDelivery,
): Promise<EnrollmentReady> {
  const { context, record, flow } = operation;
  if (
    view.deviceEpoch !== baseline.view.deviceEpoch ||
    !equal(view.encKey, baseline.view.encKey) ||
    ![delivery.envelope, delivery.registration].every((sealed) =>
      view.inboxEntries.some((held) => equal(held, sealed)),
    )
  )
    throw new PassportConnectorError('EncryptionKeyMismatch', 'The key delivery did not settle.');
  if (view.deviceEntries.some((held) => equal(held, target)))
    throw new PassportConnectorError('DeviceRosterInvalid', 'The joining device became live.');
  const grants = await readEnrollmentGrants(operation);
  if (
    grants.authNonce !== view.authNonce ||
    enrollmentGrantFingerprint(grants.targets) !==
      enrollmentGrantFingerprint(baseline.grants.targets)
  )
    throw new PassportConnectorError('GrantRosterUnsettled', 'The read-grant roster changed.');
  const counter = await context.findCounter(flow, record, view);
  if (counter === undefined) throw context.notHeld(record);
  const current = otherDeviceEntries(
    view.deviceEntries,
    enrollmentOwnerEntry(operation, baseline.view, counter),
  );
  if (!sameEnrollmentRoster(baseline.otherDevices, current))
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'The live device roster changed during delivery.',
    );
  return { view, counter };
}

async function deliverEnrollmentKeys(plan: EnrollmentPlan, baseline: EnrollmentBaseline) {
  const { context, flow, record } = plan.operation;
  const { view, delivery } = await sealEnrollmentDelivery(plan, baseline);
  await context.append(flow, record, delivery.envelope, view);
  const afterEnvelope = await readEnrollmentView(plan.operation);
  await context.append(flow, record, delivery.registration, afterEnvelope);
  const delivered = await readEnrollmentView(plan.operation);
  return checkDeliveredEnrollment(plan, baseline, delivered, delivery);
}

async function settleEnrollment(
  { operation, target }: EnrollmentPlan,
  ready: EnrollmentReady,
  tx: PassportTxResult,
  rotation: EnrollmentRotation,
): Promise<DeviceEnrollmentResult> {
  const { context, flow } = operation;
  for (let attempt = 0; attempt < 30; attempt++) {
    flow.checkpoint();
    const settled = await readEnrollmentView(operation);
    if (
      settled.authNonce > ready.view.authNonce &&
      settled.deviceEntries.some((held) => equal(held, target))
    )
      return {
        ...tx,
        commitmentHex: toHex(target),
        nextUseCounter: ready.counter + 1n,
        ...(rotation && {
          rotationTxHash: rotation.txHash,
          sealedReadGrants: rotation.sealedReadGrants,
        }),
      };
    if (attempt < 29) await context.sleep(1000);
  }
  throw new PassportConnectorError(
    'DeviceRosterInvalid',
    'The enrollment did not appear in the live ACC set.',
  );
}

async function submitEnrollment(
  plan: EnrollmentPlan,
  ready: EnrollmentReady,
  rotation: EnrollmentRotation,
) {
  const { operation, target } = plan;
  const { context, record, pure, flow, capabilities } = operation;
  const { view, counter } = ready;
  const circuit = 'add_device_with_p256';
  const challenge = capabilities.addChallenge.call(
    pure,
    { bytes: fromHex(record.address) },
    p256(record.publicKey),
    target,
    view.authNonce,
  );
  const signed = await flow.step('passkey.sign', () =>
    context.ports.authoriser.authorise({
      account: record.address,
      circuit,
      args: [target],
      witnessValues: [],
      authNonce: view.authNonce,
      useCounter: counter,
      challenge,
      credentialId: record.credentialId,
    }),
  );
  if (
    signed.scheme !== 'p256-webauthn' ||
    signed.useCounter !== counter ||
    signed.pk.x !== record.publicKey.x ||
    signed.pk.y !== record.publicKey.y
  )
    throw new PassportConnectorError('NotAuthorised', 'The signature names another device.');
  flow.checkpoint();
  const tx = await (
    await context.chain()
  ).call({
    address: record.address,
    circuit,
    args: [
      target,
      {
        pk: p256(record.publicKey),
        policy: record.policy,
        authenticator_data: signed.authenticatorData,
        sig: signed.sig,
        use_counter: counter,
      },
    ],
    ...flow.ports,
  });
  return settleEnrollment(plan, ready, tx, rotation);
}

export function createP256DeviceEnrollment(context: P256EnrollmentContext) {
  return (record: P256Hint, input: PassportDeviceReader, options: FlowOptions = {}) =>
    context.run(options, async (flow): Promise<DeviceEnrollmentResult> => {
      const plan = await planP256Enrollment(context, record, input, flow);
      return context.withOwnerSession(
        async () => {
          await verifyEnrollmentOwner(plan);
          const { baseline, rotation } = await rotateBeforeEnrollment(plan, options);
          const ready = await deliverEnrollmentKeys(plan, baseline);
          return submitEnrollment(plan, ready, rotation);
        },
        {
          kind: 'add-device',
          account: record.address,
          commitmentHex: toHex(plan.target),
          reader: plan.operation.joiner.reader,
        },
      );
    });
}
