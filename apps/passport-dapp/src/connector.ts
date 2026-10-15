import type { AccountDirectory, NetworkConfig } from '@input-output-hk/mn-passport-account/ports';
import {
  createBrowserPassport,
  injectPassportConnector,
} from '@input-output-hk/mn-passport-adapter-browser';
import {
  createRegistryClient,
  defaultFetch,
  fetchCheckedV1Config,
  remoteDirectory,
  remoteV1Deployer,
  remoteV1Prover,
  remoteV1Sponsor,
} from '@input-output-hk/mn-passport-adapter-service';
import {
  PASSPORT_API_VERSION,
  type PassportConnectorAPI,
} from '@input-output-hk/mn-passport-protocol';

export const SERVICE_URL = import.meta.env.VITE_PASSPORT_SERVICE_URL ?? 'http://localhost:8787';
/** The artefact manifest hash this build pins (R18); the service's /v1/config is checked against it. */
export const MANIFEST_SHA256 = __PASSPORT_MANIFEST_SHA256__;
/** The network this build is bound to, fixed at build time next to the manifest pin. */
export const NETWORK_ID = __PASSPORT_NETWORK_ID__;
export const RP_ID = 'localhost';
/** The grants ACC binding this page deploys: the artefact build the manifest pin above names. */
export const BINDING_ID = 'acc-s3r1.1';
const configuredArm = import.meta.env.VITE_PASSPORT_ARM ?? 'p256';
if (configuredArm !== 'p256' && configuredArm !== 'jubjub')
  throw new Error('VITE_PASSPORT_ARM must be p256 or jubjub');
export const ARM: 'p256' | 'jubjub' = configuredArm;
const ORIGIN = 'http://localhost:5173';

/** Existing demo accounts remain readable while new hints are written to the v1 directory. */
function demoDirectory(): AccountDirectory {
  const directory = remoteDirectory(SERVICE_URL);
  const legacy = createRegistryClient(SERVICE_URL, defaultFetch);
  return {
    async get(networkId, key) {
      const hint = await directory.get(networkId, key);
      if (hint) return hint;
      const record = await legacy.get(networkId, key.credentialId);
      return record && { ...record, scheme: 'p256-webauthn' };
    },
    put: directory.put,
  };
}

export async function connect(networkId: string): Promise<PassportConnectorAPI> {
  const config = await fetchCheckedV1Config(SERVICE_URL, {
    networkId,
    bindingId: BINDING_ID,
    manifestSha256: MANIFEST_SHA256,
    artefactUrl: `${SERVICE_URL.replace(/\/+$/, '')}/v1/zk/${BINDING_ID}`,
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
  const sponsor = remoteV1Sponsor(SERVICE_URL);
  return createBrowserPassport({
    arm: ARM,
    network,
    binding: async () => (await import('./acc-module.js')).accModule,
    passkey: { rpId: RP_ID, origin: ORIGIN },
    prover: remoteV1Prover(SERVICE_URL),
    sponsor,
    sponsorKeys: config,
    submitter: sponsor,
    deployer: remoteV1Deployer(SERVICE_URL),
    directory: demoDirectory(),
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
