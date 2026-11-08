/** Switch and observe the viewing key, deliver holdings, then finish optional removal. */
import type {
  DeviceRemovalResult,
  PassportTxResult,
  ViewingKeyRotationResult,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import type { DeviceInboxLedgerView } from './inbox-view.js';
import { p256 } from './p256-device.js';
import { readRotationView } from './p256-rotation-plan.js';
import { rotationEqual as equal } from './p256-rotation-types.js';
import type {
  PublishedRotation,
  RotationCallback,
  RotationMaterial,
  RotationIntent,
  RotationOperation,
} from './p256-rotation-types.js';
import type { Authorisation, P256Authorisation } from './ports/index.js';

function checkedSignature(
  operation: RotationOperation,
  signed: Authorisation,
  counter: bigint,
): P256Authorisation {
  const { record } = operation;
  if (
    signed.scheme !== 'p256-webauthn' ||
    signed.useCounter !== counter ||
    signed.pk.x !== record.publicKey.x ||
    signed.pk.y !== record.publicKey.y
  )
    throw new PassportConnectorError('NotAuthorised', 'The signature names another device.');
  return signed;
}

function proof(operation: RotationOperation, signed: P256Authorisation, counter: bigint) {
  return {
    pk: p256(operation.record.publicKey),
    policy: operation.record.policy,
    authenticator_data: signed.authenticatorData,
    sig: signed.sig,
    use_counter: counter,
  };
}

async function submitRotation(
  operation: RotationOperation,
  material: RotationMaterial,
  published: PublishedRotation,
): Promise<PassportTxResult> {
  const { host, record, pure, flow } = operation;
  const { view, counter } = published;
  const circuit = 'rotate_enc_key_with_p256';
  const challenge = pure.challenge_rotate_enc_key_with_p256(
    { bytes: fromHex(record.address) },
    p256(record.publicKey),
    material.keys.encKey,
    view.authNonce,
  );
  const signed = checkedSignature(
    operation,
    await flow.step('passkey.sign', () =>
      host.authoriser.authorise({
        account: record.address,
        circuit,
        args: [material.keys.encKey],
        witnessValues: [],
        authNonce: view.authNonce,
        useCounter: counter,
        challenge,
        credentialId: record.credentialId,
      }),
    ),
    counter,
  );
  flow.checkpoint();
  const { chain } = host;
  return (await chain()).call({
    address: record.address,
    circuit,
    args: [material.keys.encKey, proof(operation, signed, counter)],
    ...flow.ports,
  });
}

export async function switchP256ViewingKey(
  operation: RotationOperation,
  material: RotationMaterial,
  published: PublishedRotation,
  onRotated: RotationCallback | undefined,
): Promise<ViewingKeyRotationResult> {
  const { host, record, flow } = operation;
  const { keys, reencrypted, deliveries } = material;
  const tx = await submitRotation(operation, material, published);
  const { awaitSealedView, appendP256 } = host;
  let rotatedView = await awaitSealedView(
    record,
    (candidate) =>
      candidate.authNonce > published.grantNonce &&
      candidate.encKey !== undefined &&
      equal(candidate.encKey, keys.encKey),
  );
  for (const entry of reencrypted) rotatedView = await appendP256(flow, record, entry, rotatedView);
  onRotated?.({ encKey: keys.encKey, authNonce: rotatedView.authNonce });
  return {
    ...tx,
    droppedDeviceEntries: [],
    sealedReadGrants: deliveries.sealed.map(({ grantId, readPublicKey, seal, sealedEncKey }) => ({
      grantId,
      readPublicKey,
      seal,
      sealedEncKey,
    })),
    unsealedGrantIds: deliveries.unsealedGrantIds,
  };
}

async function submitRemoval(
  operation: RotationOperation,
  intent: Extract<RotationIntent, { readonly kind: 'remove' }>,
  before: DeviceInboxLedgerView,
): Promise<PassportTxResult> {
  const { host, record, pure, flow } = operation;
  const { target } = intent;
  const { findCounter, notHeld, chain } = host;
  const counter = await findCounter(flow, record, before);
  if (counter === undefined) throw notHeld(record);
  const circuit = 'remove_device_with_p256';
  const challenge = intent.challenge.call(
    pure,
    { bytes: fromHex(record.address) },
    p256(record.publicKey),
    target,
    before.authNonce,
  );
  const signed = checkedSignature(
    operation,
    await flow.step('passkey.sign', () =>
      host.authoriser.authorise({
        account: record.address,
        circuit,
        args: [target],
        witnessValues: [],
        authNonce: before.authNonce,
        useCounter: counter,
        challenge,
        credentialId: record.credentialId,
      }),
    ),
    counter,
  );
  flow.checkpoint();
  return (await chain()).call({
    address: record.address,
    circuit,
    args: [target, proof(operation, signed, counter)],
    ...flow.ports,
  });
}

async function settleRemoval(operation: RotationOperation, target: Uint8Array, nonce: bigint) {
  const { flow, host } = operation;
  const { sleep } = host;
  for (let attempt = 0; attempt < 30; attempt++) {
    flow.checkpoint();
    const settled = await readRotationView(operation);
    if (settled.authNonce > nonce && !settled.deviceEntries.some((entry) => equal(entry, target)))
      return;
    if (attempt < 29) await sleep(1000);
  }
  throw new PassportConnectorError(
    'DeviceRosterInvalid',
    'The removed device is still in the live ACC set.',
  );
}

export async function finishP256Removal(
  operation: RotationOperation,
  material: RotationMaterial,
  rotation: ViewingKeyRotationResult,
): Promise<ViewingKeyRotationResult | DeviceRemovalResult> {
  const { intent } = operation;
  if (intent.kind !== 'remove') return rotation;
  const beforeRemoval = await readRotationView(operation);
  if (
    !beforeRemoval.deviceEntries.some((entry) => equal(entry, intent.target)) ||
    !equal(beforeRemoval.encKey, material.keys.encKey)
  )
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'The removal target or ACC key changed.',
    );
  const removed = await submitRemoval(operation, intent, beforeRemoval);
  await settleRemoval(operation, intent.target, beforeRemoval.authNonce);
  return {
    ...rotation,
    ...removed,
    removedCommitmentHex: toHex(intent.target),
    rotationTxHash: rotation.txHash,
  };
}
