import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type {
  Authoriser,
  CredentialPort,
  PasskeyCredential,
  PrfKeySource,
} from '@input-output-hk/mn-passport-account/ports';
import { p256 as p256Curve } from '@noble/curves/nist.js';
import { browserPasskey } from './passkey.js';
import { passkeyPrf } from './prf.js';
import { identifyPasskeyWithPrf } from './login.js';
import { createPasskeySessions, type PasskeyLoginKeys } from './sessions.js';
import type { PasskeyCeremonyOptions } from './ceremony.js';
import { equalBytes } from './webauthn.js';

export type { PasskeyLoginKeys } from './sessions.js';

/** Browser implementation of the account's credential, PRF and P-256 authoriser ports. */
export function webauthnPasskey(
  opts: PasskeyCeremonyOptions & {
    rpId: string;
    origin: string;
    credentials?: CredentialsContainer;
  },
): {
  credentials: CredentialPort;
  prf: PrfKeySource;
  p256: Authoriser;
  /** Available only during a combined login for this exact selected credential. */
  readLoginKeys(credentialId: Uint8Array | undefined): PasskeyLoginKeys;
} {
  const seam = browserPasskey(opts);
  const known = new Map<string, PasskeyCredential>();
  let current: PasskeyCredential | undefined;
  let selectedCredentialId: Uint8Array | undefined;
  let selecting = false;
  const sessions = createPasskeySessions(async () => {
    if (!selectedCredentialId)
      throw new PassportConnectorError('InternalError', 'No passkey was selected.');
    return passkeyPrf({
      credentialId: selectedCredentialId,
      rpId: opts.rpId,
      beforeCeremony: opts.beforeCeremony,
      ...(opts.credentials && { credentials: opts.credentials }),
      ...(current && { created: current }),
    });
  });
  const idHex = (id: Uint8Array): string =>
    Array.from(id, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const selected = (): PasskeyCredential => {
    if (!current) throw new PassportConnectorError('InternalError', 'No passkey was selected.');
    return current;
  };
  const credentials: CredentialPort = {
    async withLoginSession(work) {
      if (selecting)
        throw new PassportConnectorError(
          'NotAuthorised',
          'Another credential selection is active.',
        );
      return sessions.withLoginSession(work);
    },
    async create({ name }) {
      if (selecting || sessions.active())
        throw new PassportConnectorError(
          'NotAuthorised',
          'Another credential selection is active.',
        );
      selecting = true;
      try {
        const created = await seam.create(name);
        current = created;
        selectedCredentialId = created.credentialId.slice();
        known.set(idHex(created.credentialId), created);
        return { credentialId: created.credentialId };
      } finally {
        selecting = false;
      }
    },
    async identify() {
      if (selecting)
        throw new PassportConnectorError(
          'NotAuthorised',
          'Another credential selection is active.',
        );
      selecting = true;
      try {
        const identity = sessions.active()
          ? await sessions.identify(() => identifyPasskeyWithPrf(opts))
          : await seam.identify();
        selectedCredentialId = identity.credentialId.slice();
        current = known.get(idHex(identity.credentialId));
        return {
          credentialId: identity.credentialId,
          owns(key, policy) {
            if (
              !policy ||
              !selectedCredentialId ||
              !equalBytes(identity.credentialId, selectedCredentialId) ||
              !identity.owns({ ...key, identity: false }, policy)
            )
              return false;
            current = {
              credentialId: identity.credentialId,
              publicKey: { ...key, identity: false },
              policy,
            };
            known.set(idHex(identity.credentialId), current);
            return true;
          },
        };
      } finally {
        selecting = false;
      }
    },
  };
  const prf = sessions.prf;
  const p256: Authoriser = {
    scheme: 'p256-webauthn',
    devicePublicKey: async () => selected().publicKey,
    devicePublicKeyHex: async () =>
      Array.from(p256Curve.Point.fromAffine(selected().publicKey).toBytes(true), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
    withKeySession: (operation) => prf.withSession(operation),
    deviceBinding: async () => {
      const credential = selected();
      return { policy: credential.policy, credentialId: credential.credentialId };
    },
    async authorise(request) {
      const credential = request.credentialId && known.get(idHex(request.credentialId));
      if (!credential || !(request.challenge instanceof Uint8Array)) {
        throw new PassportConnectorError('InternalError', 'No passkey to sign this call with.');
      }
      const signed = await seam.sign(credential, request.challenge);
      return {
        scheme: 'p256-webauthn',
        pk: credential.publicKey,
        useCounter: request.useCounter,
        authenticatorData: signed.authenticator_data,
        sig: signed.sig,
      };
    },
  };
  return {
    credentials,
    prf,
    p256,
    readLoginKeys(credentialId) {
      const expected = credentialId?.slice();
      return sessions.readLoginKeys(() => {
        if (!expected || !selectedCredentialId || !equalBytes(expected, selectedCredentialId))
          throw new PassportConnectorError('NotAuthorised', 'The login credential does not match.');
      });
    },
  };
}
