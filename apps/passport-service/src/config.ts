export interface ServiceConfig {
  readonly port: number;
  readonly corsOrigin: string;
  readonly networkId: string;
  readonly bindingId: string;
  /** The fetched contract tree (fetch-acc.sh output): reference client and node_modules. */
  readonly contractDir: string;
  /** contracts/managed/account inside contractDir. */
  readonly artefactDir: string;
  readonly manifestSha256: string;
  readonly indexerUri: string;
  readonly indexerWsUri: string;
  readonly nodeUri: string;
  readonly proofServerUri: string;
  readonly registryFile: string;
  /** Hex wallet seed of the fee sponsor; never sent to a client. */
  readonly sponsorSeed: string;
}

const need = (env: NodeJS.ProcessEnv, key: string): string => {
  const v = env[key];
  if (!v) throw new Error(`passport-service: set ${key}`);
  return v;
};

const parsePort = (raw: string): number => {
  const port = Number(raw);
  if (!/^\d+$/.test(raw) || port < 1 || port > 65535) {
    throw new Error(
      `passport-service: PASSPORT_SERVICE_PORT must be an integer from 1 to 65535, got "${raw}"`,
    );
  }
  return port;
};

const parseNetworkId = (raw: string): string => {
  if (!/^[a-z0-9-]{1,32}$/.test(raw)) {
    throw new Error(
      `passport-service: PASSPORT_NETWORK_ID must match [a-z0-9-]{1,32}, got "${raw}"`,
    );
  }
  return raw;
};

export function loadConfig(env: NodeJS.ProcessEnv): ServiceConfig {
  const contractDir = need(env, 'PASSPORT_CONTRACT_DIR');
  return {
    port: parsePort(env.PASSPORT_SERVICE_PORT ?? '8787'),
    corsOrigin: env.PASSPORT_DAPP_ORIGIN ?? 'http://localhost:5173',
    networkId: parseNetworkId(env.PASSPORT_NETWORK_ID ?? 'undeployed'),
    bindingId: env.PASSPORT_BINDING_ID ?? 'acc-45721e1',
    contractDir,
    artefactDir: `${contractDir}/contracts/managed/account`,
    manifestSha256: need(env, 'PASSPORT_MANIFEST_SHA256'),
    indexerUri: env.PASSPORT_INDEXER_URI ?? 'http://localhost:8088/api/v4/graphql',
    indexerWsUri: env.PASSPORT_INDEXER_WS_URI ?? 'ws://localhost:8088/api/v4/graphql/ws',
    nodeUri: env.PASSPORT_NODE_URI ?? 'http://localhost:9944',
    proofServerUri: env.PASSPORT_PROOF_SERVER_URI ?? 'http://127.0.0.1:6300',
    registryFile: env.PASSPORT_REGISTRY_FILE ?? `${contractDir}/../passport-registry.json`,
    // The standalone network's genesis-funded dev seed; testnet replaces this with a real sponsor.
    sponsorSeed:
      env.PASSPORT_SPONSOR_SEED ??
      '0000000000000000000000000000000000000000000000000000000000000001',
  };
}
