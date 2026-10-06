import { createPassportConnector, createRegistryClient } from '@midnight-ntwrk/mn-passport-account';
import {
  browserPasskey,
  createServiceChain,
  defaultFetch,
  fetchServiceConfig,
  injectPassportConnector,
} from '@midnight-ntwrk/mn-passport-adapter-browser';
import {
  PASSPORT_CONNECTOR_VERSION,
  type PassportConnectorAPI,
} from '@midnight-ntwrk/mn-passport-protocol';
import { accModule } from './acc-module.js';

export const SERVICE_URL = import.meta.env.VITE_PASSPORT_SERVICE_URL ?? 'http://localhost:8787';
/** The artefact manifest hash this build pins (R18); the service's /config is checked against it. */
export const MANIFEST_SHA256 = __PASSPORT_MANIFEST_SHA256__;
const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:5173';

export async function connect(networkId: string): Promise<PassportConnectorAPI> {
  const config = await fetchServiceConfig(SERVICE_URL, defaultFetch, networkId);
  return createPassportConnector({
    networkId,
    bindingId: config.bindingId,
    pureCircuits: accModule.pureCircuits,
    passkey: browserPasskey({ rpId: RP_ID, origin: ORIGIN }),
    chain: createServiceChain({
      serviceUrl: SERVICE_URL,
      config,
      expectedManifestSha256: MANIFEST_SHA256,
      module: accModule,
    }),
    registry: createRegistryClient(SERVICE_URL, defaultFetch),
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    encryptionKey: () => crypto.getRandomValues(new Uint8Array(32)),
  });
}

/** What lace-sdk would inject; the harness discovers it like any dApp would. */
export function installShim(): void {
  injectPassportConnector(window as unknown as { midnight?: Record<string, unknown> }, {
    name: 'Midnight Passport (prototype)',
    apiVersion: PASSPORT_CONNECTOR_VERSION,
    connect,
  });
}
