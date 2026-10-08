import type { PassportConnectorAPI } from '@midnight-ntwrk/mn-passport-protocol';
import { toHex } from './codec.js';
import { createPassportAccounts } from './connector.js';
import { PassportConnectorError } from './errors.js';
import type { Chain, PassportPorts } from './ports/index.js';
import type {
  AccountRecord,
  MvpCircuit,
  P256PublicKey,
  PasskeyCredential,
  PassportSeams,
} from './seams.js';

/**
 * The prototype's seams as ports. The passkey seam signs for a credential it is handed, so the
 * authoriser keeps the credentials this bridge saw created or proven by `identify`, and signs for
 * the one the request names. The encryption key is asked for the credential just created, the same
 * object, so the create-time PRF hold still finds it.
 */
export function portsFromSeams(seams: PassportSeams): PassportPorts {
  const known = new Map<string, PasskeyCredential>();
  let created: PasskeyCredential | undefined;
  const current = () => {
    if (!created) throw new PassportConnectorError('InternalError', 'No passkey was created yet.');
    return created;
  };
  return {
    // The seams carry no endpoints; the core reads only the network id and the binding id.
    network: {
      networkId: seams.networkId,
      bindingId: seams.bindingId,
      indexerUrl: '',
      indexerWsUrl: '',
      nodeUrl: '',
      artefactUrl: '',
      manifestSha256: '',
    },
    binding: { pureCircuits: seams.pureCircuits },
    credentials: {
      async create({ name }) {
        created = await seams.passkey.create(name);
        known.set(toHex(created.credentialId), created);
        return { credentialId: created.credentialId };
      },
      async identify() {
        const identity = await seams.passkey.identify();
        return {
          credentialId: identity.credentialId,
          owns(key, policy) {
            // The core hands back the key it read from this bridge's registry: a P-256 key.
            const publicKey = key as P256PublicKey;
            if (!policy || !identity.owns(publicKey, policy)) return false;
            known.set(toHex(identity.credentialId), {
              credentialId: identity.credentialId,
              publicKey,
              policy,
            });
            return true;
          },
        };
      },
    },
    authoriser: {
      scheme: 'p256-webauthn',
      devicePublicKey: async () => current().publicKey,
      deviceBinding: async () => ({
        policy: current().policy,
        credentialId: current().credentialId,
      }),
      async authorise(request) {
        const credential = request.credentialId && known.get(toHex(request.credentialId));
        if (!credential || !(request.challenge instanceof Uint8Array)) {
          throw new PassportConnectorError('InternalError', 'No passkey to sign this call with.');
        }
        const signed = await seams.passkey.sign(credential, request.challenge);
        return {
          scheme: 'p256-webauthn',
          pk: credential.publicKey,
          useCounter: request.useCounter,
          authenticatorData: signed.authenticator_data,
          sig: signed.sig,
        };
      },
    },
    encryptionKey: { publicKey: async () => seams.encryptionKey(current()) },
    chain: {
      call: ({ address, circuit, args }) => seams.chain.call(address, circuit as MvpCircuit, args),
      readAccount: (address) => seams.chain.readLedger(address),
    } satisfies Chain,
    deployer: {
      async deploy({ boot, encKey }) {
        const { address, txHashes } = await seams.chain.deploy({ boot, encKey });
        return { address, txIds: txHashes };
      },
    },
    directory: {
      async get(networkId, key) {
        const record = await seams.registry.get(networkId, key.credentialId);
        return record && { scheme: 'p256-webauthn', ...record };
      },
      put(networkId, hint) {
        // The core writes P-256 hints only, every field present.
        const { scheme: _scheme, ...record } = hint;
        return seams.registry.put(networkId, record as AccountRecord);
      },
    },
    random: (length) => seams.random(length),
  };
}

/**
 * @deprecated since 1.0.0: use `createPassportAccounts(ports)`. The prototype's seams, mapped onto
 * the ports by {@link portsFromSeams}. Removed in 2.0.0.
 */
export function createPassportConnector(seams: PassportSeams): PassportConnectorAPI {
  return createPassportAccounts(portsFromSeams(seams));
}
