import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type {
  Authoriser,
  CredentialPort,
  PrfKeySource,
} from '@input-output-hk/mn-passport-account/ports';
import { p256 as p256Curve } from '@noble/curves/nist.js';
import { browserPasskey, type PasskeyOptions } from './passkey.js';
import { passkeyPrf } from './prf.js';
import { identifyPasskeyWithPrf } from './login.js';
import { createPasskeySessions, type PasskeyLoginKeys } from './sessions.js';
import { createPasskeySelection } from './selection.js';
import { pinnedPasskeyOptions } from './pinned-options.js';

export type { PasskeyLoginKeys } from './sessions.js';

/** Browser implementation of the account's credential, PRF and P-256 authoriser ports. */
export function webauthnPasskey(opts: PasskeyOptions): {
  credentials: CredentialPort;
  prf: PrfKeySource;
  p256: Authoriser;
  /** Available only during a combined login for this exact selected credential. */
  readLoginKeys(credentialId: Uint8Array | undefined): PasskeyLoginKeys;
  /** Wallet-only handoff during an active post-registration key scope; never owner material. */
  readCreationKeys(credentialId: Uint8Array | undefined): PasskeyLoginKeys;
} {
  let selection: ReturnType<typeof createPasskeySelection>;
  const sessions = createPasskeySessions(
    () => passkeyPrf({ ...options, ...selection.prfSelection() }),
    () => selection.checkAvailable(),
  );
  selection = createPasskeySelection(
    () => sessions.busy(),
    () => sessions.canBind(),
  );
  const options = pinnedPasskeyOptions(opts, () => {
    const selected = selection.checkpoint();
    const owned = sessions.checkpoint();
    return () => {
      selected();
      owned();
    };
  });
  const seam = browserPasskey(options);
  const credentials: CredentialPort = {
    async withLoginSession(work) {
      selection.checkAvailable();
      return sessions.withLoginSession(work);
    },
    async create({ name }) {
      if (sessions.active())
        throw new PassportConnectorError('NotAuthorised', 'Another login is active.');
      const ticket = selection.begin();
      try {
        const created = await seam.create(name);
        selection.commit(ticket, created.credentialId, created);
        return { credentialId: Uint8Array.from(created.credentialId) };
      } finally {
        selection.finish(ticket);
      }
    },
    async identify() {
      const login = sessions.loginEpoch();
      const ticket = selection.begin(login?.phase === 'ready');
      try {
        const identity = login
          ? await sessions.identify(() => identifyPasskeyWithPrf(options))
          : await seam.identify();
        sessions.checkLoginEpoch(login);
        selection.commit(ticket, identity.credentialId);
        return {
          credentialId: Uint8Array.from(identity.credentialId),
          owns: (key, policy) => selection.adopt(ticket, identity, key, policy),
        };
      } finally {
        selection.finish(ticket);
      }
    },
  };
  const p256: Authoriser = {
    scheme: 'p256-webauthn',
    devicePublicKey: async () => selection.snapshot().publicKey,
    devicePublicKeyHex: async () =>
      Array.from(p256Curve.Point.fromAffine(selection.snapshot().publicKey).toBytes(true), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
    withKeySession: (operation, flow) =>
      flow?.kind === 'withdraw-unshielded'
        ? sessions.withScope(async () => {
            selection.snapshot();
            return operation();
          })
        : sessions.prf.withSession(operation),
    deviceBinding: async () => {
      const credential = selection.snapshot();
      return { policy: credential.policy, credentialId: credential.credentialId };
    },
    authorise: (request) =>
      sessions.withScope(async () => {
        const pinned = selection.pin(request.credentialId);
        const checkScope = sessions.checkpoint();
        if (!(request.challenge instanceof Uint8Array))
          throw new PassportConnectorError('InternalError', 'No challenge to sign this call with.');
        const challenge = Uint8Array.from(request.challenge);
        const useCounter = request.useCounter;
        const signed = await seam.sign(pinned.credential, challenge);
        pinned.check();
        checkScope();
        return {
          scheme: 'p256-webauthn',
          pk: pinned.credential.publicKey,
          useCounter,
          authenticatorData: signed.authenticator_data,
          sig: signed.sig,
        };
      }),
  };
  const refusedP256 = async (): Promise<never> => {
    throw new PassportConnectorError(
      'BindingUnsupported',
      'PRF-only registration cannot sign as a P-256 owner.',
    );
  };
  return {
    credentials,
    prf: sessions.prf,
    p256:
      options.registrationProfile === 'jubjub-prf'
        ? {
            scheme: 'p256-webauthn',
            devicePublicKey: refusedP256,
            devicePublicKeyHex: refusedP256,
            deviceCommitments: refusedP256,
            deviceBinding: refusedP256,
            authorise: refusedP256,
            withKeySession: refusedP256,
          }
        : p256,
    readLoginKeys(credentialId) {
      const expected = credentialId && Uint8Array.from(credentialId);
      return sessions.readLoginKeys(() => selection.checkCredential(expected));
    },
    readCreationKeys(credentialId) {
      const expected = credentialId && Uint8Array.from(credentialId);
      return sessions.readCreationKeys(() => selection.checkCredential(expected));
    },
  };
}
