import { PassportConnectorError } from '@midnight-ntwrk/mn-passport-account/errors';
import type { AccountDirectory, NetworkConfig } from '@midnight-ntwrk/mn-passport-account/ports';
import {
  createBrowserPassport,
  injectPassportConnector,
} from '@midnight-ntwrk/mn-passport-adapter-browser';
import {
  createRegistryClient,
  defaultFetch,
  fetchCheckedConfig,
  remoteDeployer,
  remoteProver,
  remoteSponsor,
} from '@midnight-ntwrk/mn-passport-adapter-service';
import {
  PASSPORT_API_VERSION,
  type PassportConnectorAPI,
} from '@midnight-ntwrk/mn-passport-protocol';

export const SERVICE_URL = import.meta.env.VITE_PASSPORT_SERVICE_URL ?? 'http://localhost:8787';
/** The artefact manifest hash this build pins (R18); the service's /config is checked against it. */
export const MANIFEST_SHA256 = __PASSPORT_MANIFEST_SHA256__;
/** The network this build is bound to, fixed at build time next to the manifest pin. */
export const NETWORK_ID = __PASSPORT_NETWORK_ID__;
export const RP_ID = 'localhost';
/** The binding the prototype deploys: the artefact build the manifest pin above names. */
export const BINDING_ID = 'acc-45721e1';
const ORIGIN = 'http://localhost:5173';

/** Adapt the prototype's registry wire format until the versioned service directory replaces it. */
function prototypeDirectory(): AccountDirectory {
  const registry = createRegistryClient(SERVICE_URL, defaultFetch);
  return {
    async get(networkId, key) {
      const record = await registry.get(networkId, key.credentialId);
      return record && { ...record, scheme: 'p256-webauthn' };
    },
    put(networkId, hint) {
      if (!hint.credentialId || !hint.policy || !hint.salt || hint.scheme !== 'p256-webauthn') {
        throw new PassportConnectorError(
          'InternalError',
          'The prototype registry needs a P-256 passkey hint.',
        );
      }
      return registry.put(networkId, {
        address: hint.address,
        credentialId: hint.credentialId,
        publicKey: { ...hint.publicKey, identity: false },
        policy: hint.policy,
        salt: hint.salt,
        status: hint.status,
      });
    },
  };
}

export async function connect(networkId: string): Promise<PassportConnectorAPI> {
  const config = await fetchCheckedConfig(SERVICE_URL, {
    networkId,
    bindingId: BINDING_ID,
    manifestSha256: MANIFEST_SHA256,
  });
  const network: NetworkConfig = {
    networkId,
    bindingId: BINDING_ID,
    manifestSha256: MANIFEST_SHA256,
    indexerUrl: config.indexerUri,
    indexerWsUrl: config.indexerWsUri,
    nodeUrl: config.nodeUri,
    artefactUrl: config.zkBaseUrl,
  };
  const sponsor = remoteSponsor(SERVICE_URL);
  return createBrowserPassport({
    network,
    binding: async () => (await import('./acc-module.js')).accModule,
    passkey: { rpId: RP_ID, origin: ORIGIN },
    prover: remoteProver(SERVICE_URL),
    sponsor,
    sponsorKeys: config,
    submitter: sponsor,
    deployer: remoteDeployer(SERVICE_URL),
    directory: prototypeDirectory(),
    random: (length) => crypto.getRandomValues(new Uint8Array(length)),
  });
}

/** What lace-sdk would inject; the harness discovers it like any dApp would. */
export function installShim(): void {
  injectPassportConnector(window as unknown as { midnight?: Record<string, unknown> }, {
    rdns: 'network.midnight.passport.prototype',
    name: 'Midnight Passport (prototype)',
    apiVersion: PASSPORT_API_VERSION,
    bindings: [BINDING_ID],
    connect,
  });
}
