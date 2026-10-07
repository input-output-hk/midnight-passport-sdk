import { homedir } from 'node:os';
import { join } from 'node:path';
/**
 * The Midnight stack the service, the reference client and the page all talk to: five values, one
 * explicit configuration (the MN_* variables; infra/networks/<stack>.env holds one per stack).
 */
export interface MidnightStack {
  readonly networkId: string;
  readonly nodeUri: string;
  readonly indexerUri: string;
  readonly indexerWsUri: string;
  readonly proofServerUri: string;
}

export interface ServiceConfig extends MidnightStack {
  readonly port: number;
  /**
   * The interface the server binds. Loopback by default: the service spends the sponsor's funds
   * for anyone who can reach it, so a non-loopback host exposes the sponsor.
   */
  readonly host: string;
  readonly corsOrigin: string;
  readonly bindingId: string;
  /** The fetched contract tree (fetch-acc.sh output): reference client and node_modules. */
  readonly contractDir: string;
  /** contracts/managed/account inside contractDir. */
  readonly artefactDir: string;
  readonly manifestSha256: string;
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

/** The network the localnet runs as; the only one whose sponsor seed has a built-in default. */
export const LOCALNET_ID = 'undeployed';

/**
 * The localnet stack built from the host ports in MN_NODE_PORT / MN_INDEXER_PORT / MN_PROOF_PORT
 * (infra/localnet/ports.env), with the same defaults as the patched reference client
 * (experiments/acc-0.35/patch-endpoints.sh). These are what each MN_*_URL falls back to, so a
 * setup that only sets ports keeps working.
 */
export const localnetStack = (env: NodeJS.ProcessEnv): MidnightStack => {
  const indexer = env.MN_INDEXER_PORT ?? '18088';
  return {
    networkId: LOCALNET_ID,
    nodeUri: `http://localhost:${env.MN_NODE_PORT ?? '19944'}`,
    indexerUri: `http://localhost:${indexer}/api/v4/graphql`,
    indexerWsUri: `ws://localhost:${indexer}/api/v4/graphql/ws`,
    proofServerUri: `http://127.0.0.1:${env.MN_PROOF_PORT ?? '16300'}`,
  };
};

const parseNetworkId = (raw: string): string => {
  // The id is a bech32 prefix part and a key-derivation context (`<networkId>/0`).
  if (!/^[a-z0-9][a-z0-9-]*$/.test(raw)) {
    throw new Error(
      `passport-service: MN_NETWORK_ID must be lower-case letters, digits and hyphens, got "${raw}"`,
    );
  }
  return raw;
};

const parseUrl = (key: string, raw: string, protocols: readonly string[]): string => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`passport-service: ${key} must be a URL, got "${raw}"`);
  }
  if (!protocols.includes(url.protocol)) {
    throw new Error(
      `passport-service: ${key} must be a ${protocols.map((p) => p.slice(0, -1)).join(' or ')} URL, got "${raw}"`,
    );
  }
  return raw;
};

/**
 * The Midnight stack: each value from its MN_* variable, else the localnet value. A variable that
 * is set must be valid (an empty one is not "unset"). `loadReferenceBackend` checks the result
 * against the reference client's `CONFIG`, which reads the same variables.
 */
export function loadStack(env: NodeJS.ProcessEnv): MidnightStack {
  const fallback = localnetStack(env);
  const url = (key: string, value: string, protocols: readonly string[]) =>
    parseUrl(key, env[key] ?? value, protocols);
  const http = ['http:', 'https:'];
  return {
    networkId: parseNetworkId(env.MN_NETWORK_ID ?? fallback.networkId),
    nodeUri: url('MN_NODE_URL', fallback.nodeUri, http),
    indexerUri: url('MN_INDEXER_URL', fallback.indexerUri, http),
    indexerWsUri: url('MN_INDEXER_WS_URL', fallback.indexerWsUri, ['ws:', 'wss:']),
    proofServerUri: url('MN_PROOF_SERVER_URL', fallback.proofServerUri, http),
  };
}

/** The genesis-funded dev seed of the standalone network; worthless anywhere else. */
const LOCALNET_SPONSOR_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

/** The sponsor seed: a built-in default on the localnet only; any other network must set it. */
const sponsorSeedFor = (env: NodeJS.ProcessEnv, networkId: string): string => {
  const seed = env.PASSPORT_SPONSOR_SEED;
  if (seed) return seed;
  if (networkId === LOCALNET_ID) return LOCALNET_SPONSOR_SEED;
  throw new Error(
    `passport-service: set PASSPORT_SPONSOR_SEED: the default sponsor seed is the localnet's public ` +
      `genesis seed, and the network is "${networkId}"`,
  );
};

export function loadConfig(env: NodeJS.ProcessEnv): ServiceConfig {
  const contractDir = need(env, 'PASSPORT_CONTRACT_DIR');
  const stack = loadStack(env);
  return {
    port: parsePort(env.PASSPORT_SERVICE_PORT ?? '8787'),
    host: env.PASSPORT_SERVICE_HOST || '127.0.0.1',
    corsOrigin: env.PASSPORT_DAPP_ORIGIN ?? 'http://localhost:5173',
    ...stack,
    bindingId: env.PASSPORT_BINDING_ID ?? 'acc-45721e1',
    contractDir,
    artefactDir: `${contractDir}/contracts/managed/account`,
    manifestSha256: need(env, 'PASSPORT_MANIFEST_SHA256'),
    // Kept outside the repository and the contract tree, so accounts survive a rebuild or a fresh
    // export: ~/.midnight-passport/registry.json unless PASSPORT_REGISTRY_FILE says otherwise.
    registryFile:
      env.PASSPORT_REGISTRY_FILE ??
      join(env.HOME ?? homedir(), '.midnight-passport', 'registry.json'),
    sponsorSeed: sponsorSeedFor(env, stack.networkId),
    maxDeploys: parseMaxDeploys(env.PASSPORT_MAX_DEPLOYS ?? '20'),
  };
}
