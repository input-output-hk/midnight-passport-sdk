// Read-only online admission check. The operator supplies an independently
// observed name/ACC pair; this script does not make that observation independent.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolvePassportName } from '../../packages/account/src/names.ts';
import {
  createMidnamesIndexer,
  createMidnamesLedgerReads,
} from '../../apps/passport-dapp/src/midnames/ledger-reader.ts';
import { createMidnamesNameService } from '../../apps/passport-dapp/src/midnames/resolver.ts';
import { waitForFinalizedIndexerBlock } from '../midnames-local/finalized-indexer.mjs';

const address = /^[a-f0-9]{64}$/;
const name = /^(?:[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\.)+night$/;
const chainName = Object.freeze({
  preview: 'Midnight Preview',
  preprod: 'Midnight Preprod',
  mainnet: 'Midnight Mainnet',
});

function validObservationDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validEndpoint(value, path, ws = false) {
  if (typeof value !== 'string') throw new Error('Configure complete tokenless endpoints.');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Configure complete tokenless endpoints.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const protocol = ws ? 'wss:' : 'https:';
  const local = ws ? 'ws:' : 'http:';
  if (
    (url.protocol !== protocol && !(loopback && url.protocol === local)) ||
    url.pathname !== path ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Configure complete tokenless endpoints.');
  return url;
}

function indexerPair(input) {
  const http = validEndpoint(input?.http, '/api/v4/graphql');
  const ws = validEndpoint(input?.ws, '/api/v4/graphql/ws', true);
  if (
    http.host !== ws.host ||
    !(
      (http.protocol === 'https:' && ws.protocol === 'wss:') ||
      (http.protocol === 'http:' && ws.protocol === 'ws:')
    )
  )
    throw new Error('Indexer HTTP and WebSocket endpoints must be paired.');
  return { http: http.href, ws: ws.href, origin: http.origin, wsOrigin: ws.origin };
}

/** Validate public pins before making any network request. */
export function onlineProfile(input) {
  if (!input || typeof input !== 'object' || input.schemaVersion !== 1)
    throw new Error('Expected online profile schema 1.');
  const networkId = input.networkId;
  if (!Object.hasOwn(chainName, networkId)) throw new Error('Choose a supported public network.');
  if (
    input.registryProfile !== 'midnames-2.1.0' ||
    !address.test(input.registryAddress) ||
    input.bindingId !== 'acc-s3r1.1' ||
    typeof input.namespace !== 'string' ||
    (input.namespace !== 'night' && !name.test(input.namespace)) ||
    !name.test(input.knownName) ||
    !input.knownName.endsWith(`.${input.namespace}`) ||
    !address.test(input.knownAcc) ||
    !validObservationDate(input.observationDate)
  )
    throw new Error('Pin the registry, binding, namespace and independently observed mapping.');
  const node = validEndpoint(input.nodeRpcUrl, '/');
  const primary = indexerPair(input.primaryIndexer);
  const witness = indexerPair(input.witnessIndexer);
  if (primary.origin === witness.origin || primary.wsOrigin === witness.wsOrigin)
    throw new Error('The two indexers need distinct origins.');
  return Object.freeze({
    networkId,
    nodeRpcUrl: node.href,
    registryProfile: input.registryProfile,
    registryAddress: input.registryAddress,
    bindingId: input.bindingId,
    namespace: input.namespace,
    knownName: input.knownName,
    knownAcc: input.knownAcc,
    observationDate: input.observationDate,
    primary,
    witness,
  });
}

/** Never forward a project credential to an operator-supplied node host. */
export function nodeProjectId(profile, env = process.env) {
  if (profile.networkId === 'preview') return undefined;
  const officialHost = `rpc.midnight-${profile.networkId}.blockfrost.io`;
  if (new URL(profile.nodeRpcUrl).origin !== `https://${officialHost}`) return undefined;
  const projectId = env.BLOCKFROST_PROJECT_ID;
  if (!new RegExp(`^night${profile.networkId}[A-Za-z0-9_-]+$`).test(projectId ?? ''))
    throw new Error('Set the matching Blockfrost project ID on the host.');
  return projectId;
}

/**
 * Require one canonical finalized node block and two indexers at exactly that
 * block before decoding the known name and deployed ACC on each path.
 * Distinct origins are operator inputs, not proof of distinct backend owners.
 */
export async function checkKnownMapping(profile, { rpc, primary, witness, readAt }) {
  const chain = await rpc('system_chain', []);
  if (chain !== chainName[profile.networkId]) throw new Error('Wrong node chain.');
  const finalized = await rpc('chain_getFinalizedHead', []);
  if (typeof finalized !== 'string' || !/^0x[a-f0-9]{64}$/.test(finalized))
    throw new Error('Invalid finalized node hash.');
  const header = await rpc('chain_getHeader', [finalized]);
  if (typeof header?.number !== 'string' || !/^0x[a-f0-9]+$/.test(header.number))
    throw new Error('Invalid finalized node height.');
  const height = Number(BigInt(header.number));
  if (!Number.isSafeInteger(height) || height < 0)
    throw new Error('Invalid finalized node height.');
  const blockHash = finalized.slice(2);
  const firstBlock = await waitForFinalizedIndexerBlock(primary, blockHash, height);
  const secondBlock = await waitForFinalizedIndexerBlock(witness, blockHash, height);
  const first = await readAt(primary, firstBlock, profile);
  const second = await readAt(witness, secondBlock, profile);
  if (first !== profile.knownAcc || second !== profile.knownAcc)
    throw new Error('The known name does not resolve to the pinned ACC on both readers.');
  if ((await rpc('chain_getBlockHash', [height])) !== finalized)
    throw new Error('The observed block is no longer canonical on the node.');
  return Object.freeze({
    schemaVersion: 1,
    kind: 'midnames-online-known-mapping-read',
    networkId: profile.networkId,
    registryProfile: profile.registryProfile,
    registryAddress: profile.registryAddress,
    name: profile.knownName,
    accountAddress: profile.knownAcc,
    operatorObservationDate: profile.observationDate,
    finalizedBlock: { hash: blockHash, height },
    indexerOrigins: [profile.primary.origin, profile.witness.origin],
    limits: [
      'Distinct origins do not prove independent backend owners or authenticated contract state.',
      'This one read does not qualify ongoing online resolution, claims, deposits or NIGHT sends.',
    ],
  });
}

async function nodeRpc(profile, projectId, method, params) {
  const response = await fetch(profile.nodeRpcUrl, {
    method: 'POST',
    redirect: 'error',
    headers: {
      'content-type': 'application/json',
      ...(projectId && { project_id: projectId }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Node RPC read failed.');
  const payload = await response.json();
  if (payload?.error || !Object.hasOwn(payload ?? {}, 'result'))
    throw new Error('Node RPC refused the read.');
  return payload.result;
}

async function readKnownAt(provider, block, profile) {
  const pinned = {
    ...provider,
    queryBlock: (offset) => (offset ? provider.queryBlock(offset) : block),
    queryContractState: (contract) =>
      provider.queryContractState(contract, { type: 'blockHash', blockHash: block.hash }),
  };
  const reads = createMidnamesLedgerReads(
    pinned,
    profile.networkId,
    profile.bindingId,
    profile.registryProfile,
  );
  const service = createMidnamesNameService(
    {
      networkId: profile.networkId,
      namespace: profile.namespace,
      registryAddress: profile.registryAddress,
    },
    reads,
  );
  return (
    await resolvePassportName(service, { name: profile.knownName, networkId: profile.networkId })
  )?.accountAddress;
}

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) throw new Error('Pass an online profile and new receipt path.');
  const profile = onlineProfile(JSON.parse(readFileSync(inputPath, 'utf8')));
  const projectId = nodeProjectId(profile);
  const primary = createMidnamesIndexer(
    profile.networkId,
    profile.primary.http,
    profile.primary.ws,
  );
  const witness = createMidnamesIndexer(
    profile.networkId,
    profile.witness.http,
    profile.witness.ws,
  );
  try {
    const receipt = await checkKnownMapping(profile, {
      rpc: (method, params) => nodeRpc(profile, projectId, method, params),
      primary,
      witness,
      readAt: readKnownAt,
    });
    writeFileSync(outputPath, JSON.stringify(receipt, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    console.log('Known mapping matched both readers at the node-finalized block.');
  } finally {
    await Promise.allSettled([primary.dispose?.(), witness.dispose?.()]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : 'Online mapping check failed.';
    const token = process.env.BLOCKFROST_PROJECT_ID;
    console.error(token ? message.replaceAll(token, '[redacted]') : message);
    process.exitCode = 1;
  });
}
