/** JubJub key transition: publish, fence, switch, observe, then finish approved authority work. */
import type {
  DeviceEnrollmentResult,
  DeviceRemovalResult,
  FlowOptions,
  PassportGrantRevokeResult,
  ViewingKeyRotationResult,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import type { Flow } from './flow.js';
import type { DeviceInboxLedgerView } from './inbox-view.js';
import type {
  RotationIntent,
  RotationOperation,
  RotationMaterial,
  OpenRotation,
  JubjubHint,
  JubjubRotationContext,
  EnrollmentContext,
  RotationRevocation,
} from './jubjub-rotation-types.js';
import { rotationEqual as equal } from './jubjub-rotation-types.js';
import {
  openJubjubRotation,
  planJubjubRotation,
  rotationDescriptor,
} from './jubjub-rotation-plan.js';
import {
  prepareJubjubRotationMaterial,
  publishJubjubRotationMaterial,
} from './jubjub-rotation-material.js';

const RETRIES = 30;
type RotationResult =
  | ViewingKeyRotationResult
  | DeviceRemovalResult
  | DeviceEnrollmentResult
  | PassportGrantRevokeResult;

async function switchViewingKey(
  operation: RotationOperation,
  opened: OpenRotation,
  material: RotationMaterial,
  view: DeviceInboxLedgerView,
  counter: bigint,
): Promise<ViewingKeyRotationResult> {
  const { context, record, flow, pure } = operation;
  const { keys, reencrypted, deliveries } = material;
  const nonce = view.authNonce;
  const circuit = 'rotate_enc_key_with_jubjub';
  const signed = await flow.step('passkey.sign', () =>
    context.authoriser.authorise({
      account: record.address,
      circuit,
      args: [keys.encKey],
      witnessValues: [],
      authNonce: nonce,
      useCounter: counter,
      challenge: (sigR, grindNonce) =>
        pure.challenge_rotate_enc_key_with_jubjub(
          { bytes: fromHex(record.address) },
          sigR,
          record.publicKey,
          keys.encKey,
          nonce,
          grindNonce,
        ),
    }),
  );
  if (signed.scheme !== 'jubjub-schnorr')
    throw new PassportConnectorError('InternalError', 'The authoriser returned another arm.');
  flow.checkpoint();
  const tx = await (
    await context.chain()
  ).call({
    address: record.address,
    circuit,
    args: [keys.encKey, record.publicKey, counter, signed.sigR, signed.sigS, signed.grindNonce],
    ...flow.ports,
  });
  let observed = await context.advanced(record, nonce);
  if (!equal(observed.encKey, keys.encKey))
    throw new PassportConnectorError('EncryptionKeyMismatch', 'The rotated ACC key did not land.');
  for (const entry of reencrypted) observed = await context.append(flow, record, entry, observed);
  return {
    ...tx,
    droppedDeviceEntries: opened.roster.dropped
      .filter((entry) => !equal(entry, opened.ownEntry))
      .map(toHex),
    sealedReadGrants: deliveries.sealed.map(({ grantId, readPublicKey, seal, sealedEncKey }) => ({
      grantId,
      readPublicKey,
      seal,
      sealedEncKey,
    })),
    unsealedGrantIds: deliveries.unsealedGrantIds,
  };
}

async function finishEnrollment(
  operation: RotationOperation,
  enrollment: EnrollmentContext,
  material: RotationMaterial,
  rotation: ViewingKeyRotationResult,
): Promise<DeviceEnrollmentResult> {
  const { context, record, flow, pure } = operation;
  const view = await context.read(record);
  if (view.deviceEntries.some((held) => equal(held, enrollment.entry)))
    throw new PassportConnectorError('DeviceRosterInvalid', 'The joining device is live.');
  const enrolled = await context.completeEnrollment(
    flow,
    record,
    pure,
    view,
    enrollment.reader,
    enrollment.entry,
    material.deliveries.targets,
  );
  return {
    ...enrolled,
    rotationTxHash: rotation.txHash,
    sealedReadGrants: rotation.sealedReadGrants,
  };
}

async function confirmRevocation(
  { context, record, flow }: RotationOperation,
  revocation: RotationRevocation,
) {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    flow.checkpoint();
    const settled = await flow.step('grant.roster', () =>
      revocation.grants.readGrant(record.address, revocation.grantId),
    );
    if (settled && !settled.active) return;
    if (attempt + 1 < RETRIES) await context.sleep(1000);
  }
  throw new PassportConnectorError(
    'GrantRosterUnsettled',
    'The read grant revocation did not settle.',
  );
}

async function finishRevocation(
  operation: RotationOperation,
  revocation: RotationRevocation,
  rotation: ViewingKeyRotationResult,
): Promise<PassportGrantRevokeResult> {
  const { context, record, flow } = operation;
  const view = await context.read(record);
  const grant = await flow.step('grant.roster', () =>
    revocation.grants.readGrant(record.address, revocation.grantId),
  );
  if (!grant?.active || !grant.read || grant.authNonce !== view.authNonce)
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'The read grant changed during rotation.',
    );
  const counter = context.findCounter(record, view);
  if (counter === undefined)
    throw new PassportConnectorError('NotAuthorised', 'This device is no longer live.');
  const id = fromHex(revocation.grantId);
  const nonce = view.authNonce;
  const pure = await context.revocationPure();
  const circuit = 'revoke_grant_with_jubjub';
  const signed = await flow.step('passkey.sign', () =>
    context.authoriser.authorise({
      account: record.address,
      circuit,
      args: [id],
      witnessValues: [],
      authNonce: nonce,
      useCounter: counter,
      challenge: (sigR, grindNonce) =>
        pure.challenge_revoke_grant_with_jubjub(
          { bytes: fromHex(record.address) },
          sigR,
          record.publicKey,
          id,
          nonce,
          grindNonce,
        ),
    }),
  );
  if (
    signed.scheme !== 'jubjub-schnorr' ||
    signed.useCounter !== counter ||
    signed.pk.x !== record.publicKey.x ||
    signed.pk.y !== record.publicKey.y
  )
    throw new PassportConnectorError(
      'NotAuthorised',
      'The revocation signature names another device.',
    );
  flow.checkpoint();
  const revoked = await (
    await context.chain()
  ).call({
    address: record.address,
    circuit,
    args: [id, record.publicKey, counter, signed.sigR, signed.sigS, signed.grindNonce],
    ...flow.ports,
  });
  await context.advanced(record, nonce);
  const stored = await revocation.records.read();
  if (!stored || stored.address !== record.address)
    throw new PassportConnectorError('AccountNotFound', 'No local account record exists.');
  await revocation.records.write({ ...stored, localUseCounter: counter + 1n });
  await confirmRevocation(operation, revocation);
  return {
    ...revoked,
    grantId: revocation.grantId,
    status: 'revoked',
    nextUseCounter: counter + 1n,
    rotation,
  };
}

async function finishRemoval(
  operation: RotationOperation,
  target: Uint8Array,
  rotation: ViewingKeyRotationResult,
): Promise<DeviceRemovalResult> {
  const { context, record, flow, pure } = operation;
  const view = await context.read(record);
  if (!view.deviceEntries.some((entry) => equal(entry, target)))
    throw new PassportConnectorError(
      'RemovalTargetNotFound',
      'The target disappeared before the removal call.',
    );
  const counter = context.findCounter(record, view);
  if (counter === undefined)
    throw new PassportConnectorError('NotAuthorised', 'This device is no longer live.');
  const nonce = view.authNonce;
  const circuit = 'remove_device_with_jubjub';
  const signed = await flow.step('passkey.sign', () =>
    context.authoriser.authorise({
      account: record.address,
      circuit,
      args: [target],
      witnessValues: [],
      authNonce: nonce,
      useCounter: counter,
      challenge: (sigR, grindNonce) =>
        pure.challenge_remove_device_with_jubjub(
          { bytes: fromHex(record.address) },
          sigR,
          record.publicKey,
          target,
          nonce,
          grindNonce,
        ),
    }),
  );
  if (
    signed.scheme !== 'jubjub-schnorr' ||
    signed.useCounter !== counter ||
    signed.pk.x !== record.publicKey.x ||
    signed.pk.y !== record.publicKey.y
  )
    throw new PassportConnectorError('NotAuthorised', 'The signature names another device.');
  flow.checkpoint();
  const removed = await (
    await context.chain()
  ).call({
    address: record.address,
    circuit,
    args: [target, record.publicKey, counter, signed.sigR, signed.sigS, signed.grindNonce],
    ...flow.ports,
  });
  await context.advanced(record, nonce);
  const settled = await context.read(record);
  if (settled.deviceEntries.some((entry) => equal(entry, target)))
    throw new PassportConnectorError('DeviceRosterInvalid', 'The device removal did not land.');
  return {
    ...rotation,
    ...removed,
    removedCommitmentHex: toHex(target),
    rotationTxHash: rotation.txHash,
  };
}

function finishRotation(
  operation: RotationOperation,
  intent: RotationIntent,
  material: RotationMaterial,
  rotation: ViewingKeyRotationResult,
): Promise<RotationResult> | ViewingKeyRotationResult {
  switch (intent.kind) {
    case 'enroll':
      return finishEnrollment(operation, intent.enrollment, material, rotation);
    case 'revoke':
      return finishRevocation(operation, intent.revocation, rotation);
    case 'remove':
      return finishRemoval(operation, intent.target, rotation);
    case 'rotate':
    case 'revoke-all':
      return rotation;
  }
}

export function createJubjubViewingRotation(context: JubjubRotationContext) {
  return (
    record: JubjubHint,
    options: FlowOptions = {},
    removal?: string,
    enrollment?: EnrollmentContext,
    existingFlow?: Flow,
    revocation?: string,
    revokeAll = false,
    inOwnerSession = false,
  ): Promise<RotationResult> => {
    const body = async (flow: Flow): Promise<RotationResult> => {
      const operation = await planJubjubRotation(
        context,
        record,
        flow,
        removal,
        enrollment,
        revocation,
        revokeAll,
      );
      const work = async () => {
        const opened = await openJubjubRotation(operation);
        const material = await prepareJubjubRotationMaterial(operation, opened);
        const { view, counter } = await publishJubjubRotationMaterial(operation, opened, material);
        const rotation = await switchViewingKey(operation, opened, material, view, counter);
        return finishRotation(operation, operation.intent, material, rotation);
      };
      return inOwnerSession
        ? work()
        : context.withOwnerSession(work, rotationDescriptor(operation));
    };
    return existingFlow ? body(existingFlow) : context.run(options, body);
  };
}
