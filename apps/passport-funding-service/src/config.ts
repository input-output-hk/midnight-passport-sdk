import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BINDING_VERSION, resolveBinding } from '@input-output-hk/mn-passport-contract';
import type { FundingAssetPolicy } from '@input-output-hk/mn-passport-service';

const ADDRESS = /^[0-9a-f]{64}$/;
const DECIMAL = /^[1-9][0-9]*$/;
const MAX_AMOUNT = (1n << 128n) - 1n;
const LOCALNET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

export interface FundingConfig {
  readonly host: string;
  readonly port: number;
  readonly corsOrigin: string;
  readonly networkId: string;
  readonly nodeUri: string;
  readonly indexerUri: string;
  readonly indexerWsUri: string;
  readonly proofServerUri: string;
  readonly contractDir: string;
  readonly artefactDir: string;
  readonly bindingId: string;
  readonly manifestSha256: string;
  readonly walletSeed: string;
  readonly token: string;
  readonly assets: readonly FundingAssetPolicy[];
  readonly reservationsFile: string;
  readonly deploymentsFile: string;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`passport-funding-service: set ${key}`);
  return value;
}

function secret(file: string, name: string): string {
  const value = readFileSync(file, 'utf8').trim();
  if (!value) throw new Error(`passport-funding-service: ${name} is empty`);
  return value;
}

function port(raw: string): number {
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error('passport-funding-service: invalid PASSPORT_FUNDING_PORT');
  return value;
}

function url(raw: string, name: string, schemes: readonly string[]): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`passport-funding-service: invalid ${name}`);
  }
  if (!schemes.includes(parsed.protocol))
    throw new Error(`passport-funding-service: invalid ${name}`);
  return raw;
}

function assets(file: string): FundingAssetPolicy[] {
  const body: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(body) || body.length === 0)
    throw new Error('passport-funding-service: asset policy must be a nonempty array');
  const out = body.map((value: unknown): FundingAssetPolicy => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('passport-funding-service: invalid asset policy');
    const item = value as Record<string, unknown>;
    if (
      typeof item.color !== 'string' ||
      !ADDRESS.test(item.color) ||
      typeof item.maxPerRequest !== 'string' ||
      !DECIMAL.test(item.maxPerRequest) ||
      typeof item.maxPerUtcDay !== 'string' ||
      !DECIMAL.test(item.maxPerUtcDay)
    )
      throw new Error('passport-funding-service: invalid asset policy');
    const maxPerRequest = BigInt(item.maxPerRequest);
    const maxPerUtcDay = BigInt(item.maxPerUtcDay);
    if (maxPerRequest > MAX_AMOUNT || maxPerUtcDay > MAX_AMOUNT || maxPerUtcDay < maxPerRequest)
      throw new Error('passport-funding-service: invalid asset limits');
    return { color: item.color, maxPerRequest, maxPerUtcDay };
  });
  if (new Set(out.map((item) => item.color)).size !== out.length)
    throw new Error('passport-funding-service: duplicate asset color');
  return out;
}

export function loadFundingConfig(env: NodeJS.ProcessEnv): FundingConfig {
  const networkId = env.MN_NETWORK_ID ?? 'undeployed';
  if (!/^[a-z0-9][a-z0-9-]*$/.test(networkId))
    throw new Error('passport-funding-service: invalid MN_NETWORK_ID');
  const binding = resolveBinding(BINDING_VERSION);
  if (env.PASSPORT_BINDING_ID && env.PASSPORT_BINDING_ID !== BINDING_VERSION)
    throw new Error('passport-funding-service: binding differs from the package pin');
  if (env.PASSPORT_MANIFEST_SHA256 && env.PASSPORT_MANIFEST_SHA256 !== binding.manifestSha256)
    throw new Error('passport-funding-service: manifest differs from the package pin');
  const contractDir = required(env, 'PASSPORT_CONTRACT_DIR');
  if (networkId !== 'undeployed' && !env.PASSPORT_FUNDING_SEED_FILE)
    throw new Error('passport-funding-service: set PASSPORT_FUNDING_SEED_FILE');
  const walletSeed = env.PASSPORT_FUNDING_SEED_FILE
    ? secret(env.PASSPORT_FUNDING_SEED_FILE, 'wallet seed file')
    : LOCALNET_SEED;
  if (!ADDRESS.test(walletSeed))
    throw new Error('passport-funding-service: wallet seed must be 32-byte lowercase hex');
  const token = secret(required(env, 'PASSPORT_FUNDING_TOKEN_FILE'), 'token file');
  if (token.length < 32)
    throw new Error('passport-funding-service: token must have at least 32 characters');
  const home = join(env.HOME ?? homedir(), '.midnight-passport');
  const registry = env.PASSPORT_REGISTRY_FILE ?? join(home, 'registry.json');
  const deploymentsFile =
    env.PASSPORT_FUNDING_DEPLOYMENTS_FILE ??
    (networkId === 'undeployed'
      ? `${registry.replace(/\.json$/, '')}.deployments.json`
      : required(env, 'PASSPORT_FUNDING_DEPLOYMENTS_FILE'));
  const indexerPort = env.MN_INDEXER_PORT ?? '18088';
  const allowedAssets = assets(required(env, 'PASSPORT_FUNDING_ASSETS_FILE'));
  if (networkId !== 'undeployed' && allowedAssets.some((asset) => asset.color === '00'.repeat(32)))
    throw new Error('passport-funding-service: NIGHT requires a node-backed network qualification');
  return {
    host: env.PASSPORT_FUNDING_HOST ?? '127.0.0.1',
    port: port(env.PASSPORT_FUNDING_PORT ?? '8789'),
    corsOrigin: env.PASSPORT_DAPP_ORIGIN ?? 'http://localhost:5173',
    networkId,
    nodeUri: url(
      env.MN_NODE_URL ?? `http://localhost:${env.MN_NODE_PORT ?? '19944'}`,
      'MN_NODE_URL',
      ['http:', 'https:'],
    ),
    indexerUri: url(
      env.MN_INDEXER_URL ?? `http://localhost:${indexerPort}/api/v4/graphql`,
      'MN_INDEXER_URL',
      ['http:', 'https:'],
    ),
    indexerWsUri: url(
      env.MN_INDEXER_WS_URL ?? `ws://localhost:${indexerPort}/api/v4/graphql/ws`,
      'MN_INDEXER_WS_URL',
      ['ws:', 'wss:'],
    ),
    proofServerUri: url(
      env.MN_PROOF_SERVER_URL ?? `http://127.0.0.1:${env.MN_PROOF_PORT ?? '16300'}`,
      'MN_PROOF_SERVER_URL',
      ['http:', 'https:'],
    ),
    contractDir,
    artefactDir: join(contractDir, 'contracts/managed/account'),
    bindingId: BINDING_VERSION,
    manifestSha256: binding.manifestSha256,
    walletSeed,
    token,
    assets: allowedAssets,
    reservationsFile:
      env.PASSPORT_FUNDING_RESERVATIONS_FILE ?? join(home, 'funding-reservations.json'),
    deploymentsFile,
  };
}
