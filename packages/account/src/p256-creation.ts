import type { Flow } from './flow.js';
import { PassportConnectorError } from './errors.js';
import {
  isSealedP256,
  p256,
  validSealedEntries,
  type P256Hint,
  type SealedP256Hint,
} from './p256-device.js';
import type { AccBinding, PassportPorts } from './ports/index.js';

interface CreationControls {
  readonly ports: PassportPorts;
  readonly flow: Flow;
  readonly binding: () => Promise<AccBinding>;
  readonly random: (length: number) => Uint8Array;
  readonly recordDeployed: (flow: Flow, record: P256Hint) => Promise<void>;
  readonly finishSealed: (flow: Flow, record: SealedP256Hint) => Promise<P256Hint>;
  readonly activate: (flow: Flow, record: P256Hint) => Promise<P256Hint>;
}

/** One post-registration PRF scope; every strict P-256 circuit still obtains its own signature. */
export async function createP256Account(
  userName: string,
  retireAuthority: boolean,
  controls: CreationControls,
): Promise<P256Hint> {
  const { ports, flow, binding, random } = controls;
  const { credentials, authoriser, viewingKey, encryptionKey } = ports;
  const { networkId } = ports.network;
  const deviceBinding = authoriser.deviceBinding?.bind(authoriser);
  const devicePublicKeyHex = authoriser.devicePublicKeyHex?.bind(authoriser);
  if (typeof retireAuthority !== 'boolean')
    throw new PassportConnectorError('InternalError', 'retireAuthority must be a boolean.');
  if (!deviceBinding)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'P-256 creation needs a device binding.',
    );
  const { credentialId, publicKey, device } = await flow.step('passkey.create', async () => {
    const { credentialId } = await credentials.create({ name: userName });
    const publicKey = await authoriser.devicePublicKey();
    const device = await deviceBinding();
    return { credentialId, publicKey, device };
  });
  const complete = async () => {
    if (viewingKey && !devicePublicKeyHex)
      throw new PassportConnectorError(
        'BindingUnsupported',
        'P-256 sealed accounts need a compressed device public key.',
      );
    const { pureCircuits } = await binding();
    if (viewingKey && !pureCircuits.challenge_append_inbox_with_p256)
      throw new PassportConnectorError('BindingUnsupported', 'ACC lacks P-256 inbox signing.');
    const keys =
      viewingKey && devicePublicKeyHex
        ? await flow.step('passkey.prf', async () =>
            viewingKey.createKeys(networkId, {
              scheme: 'p256-webauthn',
              devicePublicKey: await devicePublicKeyHex(),
              policy: device.policy,
            }),
          )
        : undefined;
    const encKey = keys
      ? keys.encKey
      : await flow.step('passkey.prf', () => encryptionKey.publicKey(networkId));
    const salt = random(32);
    if (
      keys &&
      (!validSealedEntries([...keys.envelopes, ...keys.registrations]) ||
        keys.registrations[0]?.[0] !== 0xd5)
    )
      throw new PassportConnectorError(
        'InternalError',
        'P-256 keyring did not provide one envelope and one registration.',
      );
    const boot = pureCircuits.derive_boot_commitment_with_p256(
      salt,
      p256(publicKey),
      device.policy,
    );
    const { address } = await flow.step('deploy', () =>
      ports.deployer.deploy({ boot, encKey, retireAuthority, firstArm: 'p256', ...flow.ports }),
    );
    const deployed: P256Hint = {
      scheme: 'p256-webauthn',
      credentialId,
      publicKey,
      policy: device.policy,
      address,
      salt,
      ...(keys && { keyEntries: [...keys.envelopes, ...keys.registrations] }),
      status: 'deployed',
    };
    // Persist the activation salt and original sealed entries before any activation/publication.
    await controls.recordDeployed(flow, deployed);
    return viewingKey && isSealedP256(deployed)
      ? controls.finishSealed(flow, deployed)
      : controls.activate(flow, deployed);
  };
  return authoriser.withKeySession
    ? authoriser.withKeySession(complete, { kind: 'create-account', lockAccount: retireAuthority })
    : complete();
}
