import { PassportConnectorError } from '@midnight-ntwrk/mn-passport-account/errors';
import type {
  Authoriser,
  CredentialPort,
  PasskeyCredential,
  PrfKeySource,
} from '@midnight-ntwrk/mn-passport-account/ports';
import { deriveSymmetricSecret, seedFromRoot } from '@midnight-ntwrk/mn-passport-keys';
import { browserPasskey } from './passkey.js';
import { passkeyPrf, type PasskeyPrfOutputs } from './prf.js';

/** Browser implementation of the account's credential, PRF and P-256 authoriser ports. */
export function webauthnPasskey(opts: {
  rpId: string;
  origin: string;
  credentials?: CredentialsContainer;
}): { credentials: CredentialPort; prf: PrfKeySource; p256: Authoriser } {
  const seam = browserPasskey(opts);
  const known = new Map<string, PasskeyCredential>();
  let current: PasskeyCredential | undefined;
  let session: PasskeyPrfOutputs | undefined;
  const idHex = (id: Uint8Array): string =>
    Array.from(id, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const selected = (): PasskeyCredential => {
    if (!current) throw new PassportConnectorError('InternalError', 'No passkey was selected.');
    return current;
  };
  const credentials: CredentialPort = {
    async create({ name }) {
      const created = await seam.create(name);
      current = created;
      known.set(idHex(created.credentialId), created);
      return { credentialId: created.credentialId };
    },
    async identify() {
      const identity = await seam.identify();
      return {
        credentialId: identity.credentialId,
        owns(key, policy) {
          if (!policy || !identity.owns({ ...key, identity: false }, policy)) return false;
          current = {
            credentialId: identity.credentialId,
            publicKey: { ...key, identity: false },
            policy,
          };
          known.set(idHex(identity.credentialId), current);
          return true;
        },
      };
    },
  };
  const prf: PrfKeySource = {
    async withSession<T>(operation: () => Promise<T>): Promise<T> {
      if (session) return operation();
      const credential = selected();
      const outputs = await passkeyPrf({
        credentialId: credential.credentialId,
        rpId: opts.rpId,
        ...(opts.credentials && { credentials: opts.credentials }),
        created: credential,
      });
      session = outputs;
      try {
        return await operation();
      } finally {
        session = undefined;
        outputs.authoriser.fill(0);
        outputs.root.fill(0);
      }
    },
    async deviceSecret() {
      if (!session) return prf.withSession(() => prf.deviceSecret());
      return session.authoriser.slice();
    },
    async deriveSecret({ domain, context, length }) {
      if (!session)
        return prf.withSession(() =>
          prf.deriveSecret({ domain, context, ...(length === undefined ? {} : { length }) }),
        );
      const seed = seedFromRoot(session.root);
      try {
        return deriveSymmetricSecret(seed, {
          domain,
          context,
          ...(length === undefined ? {} : { length }),
        });
      } finally {
        seed.fill(0);
      }
    },
  };
  const p256: Authoriser = {
    scheme: 'p256-webauthn',
    devicePublicKey: async () => selected().publicKey,
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
  return { credentials, prf, p256 };
}
