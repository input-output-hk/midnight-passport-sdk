import type { P256AccountContext } from './p256-account-context.js';
import { createP256ViewingRotation } from './p256-viewing-rotation.js';
import { createP256DeviceEnrollment } from './p256-device-enrollment.js';
import { PassportConnectorError } from './errors.js';
export function composeP256Operations(
  host: Omit<P256AccountContext, 'addP256Device' | 'rotateP256ViewingKey'> &
    Pick<Parameters<typeof createP256ViewingRotation>[0], 'appendP256' | 'awaitSealedView'>,
) {
  const {
    ports,
    binding,
    chain,
    run,
    authoriser,
    network,
    readView,
    findCounter,
    notHeld,
    sealedKeyring,
    appendP256,
    awaitSealedView,
    random,
    sleep,
  } = host;
  const addP256Device = createP256DeviceEnrollment({
    ports,
    binding,
    chain,
    run,
    withOwnerSession(operation, descriptor) {
      const current = authoriser.withKeySession;
      if (!current)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'P-256 enrollment needs a sealed keyring, joining-device decoder, key session and live read-grant source.',
        );
      return current.bind(authoriser)(operation, descriptor);
    },
    ownerBinding() {
      const current = authoriser.deviceBinding;
      if (!current)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'The selected authorisation arm needs a compatible authoriser and binding.',
        );
      return current.call(authoriser);
    },
    findCounter,
    notHeld,
    sealedKeyring,
    append: appendP256,
    rotate: (record, options) =>
      rotateP256ViewingKey(record, options, undefined, undefined, undefined, {
        inOwnerSession: true,
        rotateRosterForEnrollment: true,
      }),
    sleep,
  });

  const rotateP256ViewingKey = createP256ViewingRotation({
    ports,
    binding,
    chain,
    run,
    findCounter,
    notHeld,
    sealedKeyring,
    appendP256,
    awaitSealedView,
    random,
    sleep,
  });

  const revocation = {
    ports,
    authoriser,
    network,
    binding,
    chain,
    readView,
    findCounter,
    notHeld,
    rotate: rotateP256ViewingKey,
    sleep,
  };

  return { addP256Device, rotateP256ViewingKey, revocation };
}
