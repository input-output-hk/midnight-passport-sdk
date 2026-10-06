export interface ServiceConfig {
  readonly port: number;
  /**
   * The interface the server binds. Loopback by default: the service spends the sponsor's funds
   * for anyone who can reach it, so a non-loopback host exposes the sponsor.
   */
  readonly host: string;
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
  /** How many /deploy requests this process accepts (failures count), bounding sponsor spend. */
  readonly maxDeploys: number;
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

const parseMaxDeploys = (raw: string): number => {
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < 1) {
    throw new Error(
      `passport-service: PASSPORT_MAX_DEPLOYS must be a positive integer, got "${raw}"`,
    );
  }
  return n;
};

/**
 * The localnet endpoints the reference client uses (`CONFIG.local` in the contract tree's
 * `src/node/wallet.ts`, made port-configurable by experiments/acc-0.35/patch-endpoints.sh). The
 * sponsor wallet and the wave deploy always use these, so `/config` advertises exactly these too;
 * `loadReferenceBackend` checks them against the reference at start-up. Host ports come from
 * MN_NODE_PORT / MN_INDEXER_PORT / MN_PROOF_PORT (infra/localnet/ports.env), with the same defaults
 * as the patched reference, so the Passport localnet runs beside another one.
 */
export const referenceLocalnet = (env: NodeJS.ProcessEnv) => {
  const indexer = env.MN_INDEXER_PORT ?? '18088';
  return {
    networkId: 'undeployed',
    indexerUri: `http://localhost:${indexer}/api/v4/graphql`,
    indexerWsUri: `ws://localhost:${indexer}/api/v4/graphql/ws`,
    nodeUri: `http://localhost:${env.MN_NODE_PORT ?? '19944'}`,
    proofServerUri: `http://127.0.0.1:${env.MN_PROOF_PORT ?? '16300'}`,
  } as const;
};

/** The reference endpoints for the default ports. */
export const REFERENCE_LOCALNET = referenceLocalnet({});

/** The legacy environment knobs, which may only restate the reference value. */
const FIXED: Record<keyof ReturnType<typeof referenceLocalnet>, string> = {
  networkId: 'PASSPORT_NETWORK_ID',
  indexerUri: 'PASSPORT_INDEXER_URI',
  indexerWsUri: 'PASSPORT_INDEXER_WS_URI',
  nodeUri: 'PASSPORT_NODE_URI',
  proofServerUri: 'PASSPORT_PROOF_SERVER_URI',
};

const refuseOverrides = (env: NodeJS.ProcessEnv): void => {
  const reference = referenceLocalnet(env);
  for (const [field, key] of Object.entries(FIXED) as [keyof typeof FIXED, string][]) {
    const value = env[key];
    if (value !== undefined && value !== reference[field]) {
      throw new Error(
        `passport-service: ${key} is fixed to "${reference[field]}" in the prototype, got "${value}". ` +
          'The reference client hard-codes it, so /config would advertise an endpoint the sponsor never uses.',
      );
    }
  }
};

export function loadConfig(env: NodeJS.ProcessEnv): ServiceConfig {
  const contractDir = need(env, 'PASSPORT_CONTRACT_DIR');
  refuseOverrides(env);
  const localnet = referenceLocalnet(env);
  return {
    port: parsePort(env.PASSPORT_SERVICE_PORT ?? '8787'),
    host: env.PASSPORT_SERVICE_HOST || '127.0.0.1',
    corsOrigin: env.PASSPORT_DAPP_ORIGIN ?? 'http://localhost:5173',
    networkId: localnet.networkId,
    bindingId: env.PASSPORT_BINDING_ID ?? 'acc-45721e1',
    contractDir,
    artefactDir: `${contractDir}/contracts/managed/account`,
    manifestSha256: need(env, 'PASSPORT_MANIFEST_SHA256'),
    indexerUri: localnet.indexerUri,
    indexerWsUri: localnet.indexerWsUri,
    nodeUri: localnet.nodeUri,
    proofServerUri: localnet.proofServerUri,
    registryFile: env.PASSPORT_REGISTRY_FILE ?? `${contractDir}/../passport-registry.json`,
    // The standalone network's genesis-funded dev seed; testnet replaces this with a real sponsor.
    sponsorSeed:
      env.PASSPORT_SPONSOR_SEED ??
      '0000000000000000000000000000000000000000000000000000000000000001',
    maxDeploys: parseMaxDeploys(env.PASSPORT_MAX_DEPLOYS ?? '20'),
  };
}
