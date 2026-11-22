#!/usr/bin/env node
// Read-only shared-chain witness: two separately stored Indexer API v4 paths,
// one canonical finalized node, and one pinned local name-to-ACC observation.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMidnamesNodeFinality } from '../../apps/passport-dapp/src/midnames/chain-finality.ts';
import { configureMidnames } from '../../apps/passport-dapp/src/midnames/config.ts';
import { createMidnamesIndexer } from '../../apps/passport-dapp/src/midnames/ledger-reader.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [
  profilePath,
  primaryHttp,
  primaryWs,
  witnessHttp,
  witnessWs,
  nodeUrl,
  witnessProject,
  witnessEnvFile,
] = process.argv.slice(2);
if (
  !process.env.IN_NIX_SHELL ||
  !profilePath ||
  !primaryHttp ||
  !primaryWs ||
  !witnessHttp ||
  !witnessWs ||
  !nodeUrl ||
  !witnessProject ||
  !witnessEnvFile
)
  throw new Error(
    'Use Nix and pass: claim receipt, primary HTTP/WS, witness HTTP/WS, node URL, witness project, private witness env file.',
  );

const indexerImage =
  'ghcr.io/midnight-ntwrk/indexer-standalone@sha256:119f35db548ba1c390845f215bb1e928e73038bef7c315825aee0461bd54499d';
const privateKeys = [
  'APP__INFRA__STORAGE__PASSWORD',
  'APP__INFRA__PUB_SUB__PASSWORD',
  'APP__INFRA__LEDGER_STATE_STORAGE__PASSWORD',
  'APP__INFRA__SECRET',
];
function inspect(containerId) {
  const rows = JSON.parse(execFileSync('docker', ['inspect', containerId], { encoding: 'utf8' }));
  assert.equal(rows.length, 1, 'Expected exactly one Docker container.');
  return rows[0];
}
function environment(container, key) {
  const entry = container.Config.Env.find((value) => value.startsWith(`${key}=`));
  if (!entry) throw new Error('Indexer credential is missing.');
  return entry.slice(key.length + 1);
}
assert.match(witnessProject, /^midnight-passport-read-witness(?:-[a-z0-9]+)*$/);
const ids = execFileSync(
  'docker',
  [
    'ps',
    '--no-trunc',
    '--filter',
    `label=com.docker.compose.project=${witnessProject}`,
    '--filter',
    'label=com.docker.compose.service=read-witness-indexer',
    '--format',
    '{{.ID}}',
  ],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n');
assert.equal(ids.length, 1, 'Expected one running, separately named witness container.');
assert.match(ids[0], /^[a-f0-9]{64}$/);
const witness = inspect(ids[0]);
const primary = inspect('midnight-network-indexer-1');
assert.equal(witness.State.Running, true);
assert.equal(primary.State.Running, true);
assert.equal(witness.Config.Image, indexerImage);
assert.equal(witness.Config.Labels['com.docker.compose.project'], witnessProject);
assert.equal(witness.Config.Labels['com.docker.compose.service'], 'read-witness-indexer');
assert.equal(primary.Config.Labels['com.docker.compose.project'], 'midnight-network');
const witnessNetwork = witness.NetworkSettings.Networks['midnight-network_default'];
assert.ok(witnessNetwork?.Aliases?.includes('read-witness-indexer'));
assert.ok(
  !witnessNetwork.Aliases.includes('indexer'),
  'Witness must not shadow the shared indexer DNS name.',
);
assert.ok(
  primary.NetworkSettings.Networks['midnight-network_default']?.Aliases?.includes('indexer'),
);
const witnessPort = new URL(witnessHttp).port;
assert.ok(
  witness.NetworkSettings.Ports['8088/tcp']?.some(
    (binding) => binding.HostIp === '127.0.0.1' && binding.HostPort === witnessPort,
  ),
);
const primaryPort = new URL(primaryHttp).port;
assert.ok(
  primary.NetworkSettings.Ports['8088/tcp']?.some(
    (binding) => binding.HostIp === '127.0.0.1' && binding.HostPort === primaryPort,
  ),
);
const witnessVolume = witness.Mounts.find((mount) => mount.Destination === '/data');
const primaryVolume = primary.Mounts.find((mount) => mount.Destination === '/data');
assert.equal(witnessVolume?.Type, 'volume');
assert.equal(primaryVolume?.Type, 'volume');
assert.match(witnessVolume.Name, /^midnight-passport-read-witness.*_indexer-data$/);
assert.notEqual(witnessVolume.Name, primaryVolume.Name);
assert.ok(isAbsolute(witnessEnvFile));
const envPath = resolve(witnessEnvFile);
assert.equal(realpathSync(envPath), envPath);
const envStat = lstatSync(envPath);
const parentStat = statSync(dirname(envPath));
assert.ok(envStat.isFile() && !envStat.isSymbolicLink() && envStat.nlink === 1);
assert.equal(envStat.mode & 0o777, 0o600);
assert.ok(parentStat.isDirectory() && (parentStat.mode & 0o777) === 0o700);
if (process.getuid) {
  assert.equal(envStat.uid, process.getuid());
  assert.equal(parentStat.uid, process.getuid());
}
const fileValues = new Map(
  readFileSync(envPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => {
      const equal = line.indexOf('=');
      assert.ok(equal > 0);
      return [line.slice(0, equal), line.slice(equal + 1)];
    }),
);
for (const key of privateKeys) {
  const value = fileValues.get(key);
  if (!value || value !== environment(witness, key) || value === environment(primary, key))
    throw new Error('Witness credential provenance is invalid.');
}

const receipt = JSON.parse(readFileSync(resolve(profilePath), 'utf8'));
const { chain, registry, recipient } = receipt;
assert.equal(chain?.networkId, 'undeployed');
assert.equal(registry?.profile, 'standalone-0.35');
assert.equal(recipient?.bindingId, 'acc-s3r1.1');
assert.match(registry?.address ?? '', /^[a-f0-9]{64}$/);
assert.match(recipient?.address ?? '', /^[a-f0-9]{64}$/);
assert.match(registry?.name ?? '', /^[a-z0-9-]+\.night$/);
assert.ok(Number.isSafeInteger(registry?.claimBlock?.height) && registry.claimBlock.height > 0);
assert.match(registry?.claimBlock?.hash ?? '', /^[a-f0-9]{64}$/);
assert.match(chain?.genesisHash ?? '', /^0x[a-f0-9]{64}$/);

const genesisResponse = await fetch(nodeUrl, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getBlockHash', params: [0] }),
  redirect: 'error',
  signal: AbortSignal.timeout(6_000),
});
assert.equal(genesisResponse.ok, true, 'Node genesis RPC is unavailable.');
const genesisReply = await genesisResponse.json();
assert.equal(genesisReply?.jsonrpc, '2.0');
assert.equal(genesisReply?.id, 1);
assert.equal(genesisReply?.error, undefined);
assert.equal(genesisReply?.result, chain.genesisHash, 'Receipt genesis differs from the node.');

const pin = {
  nodeUrl,
  anchorHeight: registry.claimBlock.height,
  anchorHash: registry.claimBlock.hash,
};
const verifyFinalizedBlock = createMidnamesNodeFinality(pin);
const endpoints = [
  { id: 'primary', http: primaryHttp, ws: primaryWs },
  { id: 'witness', http: witnessHttp, ws: witnessWs },
];
const providers = endpoints.map((endpoint) =>
  createMidnamesIndexer('undeployed', endpoint.http, endpoint.ws),
);
let selectedBlocks;
for (let attempt = 0; attempt < 20; attempt++) {
  selectedBlocks = await Promise.all(providers.map((provider) => provider.queryBlock()));
  if (
    selectedBlocks[0].height === selectedBlocks[1].height &&
    selectedBlocks[0].hash === selectedBlocks[1].hash
  )
    break;
  await new Promise((done) => setTimeout(done, 1_000));
}
assert.equal(
  selectedBlocks[0].height,
  selectedBlocks[1].height,
  'Indexer selected heights differ.',
);
assert.equal(selectedBlocks[0].hash, selectedBlocks[1].hash, 'Indexer selected hashes differ.');
const states = new Map();
const blocks = [];
for (const [index, endpoint] of endpoints.entries()) {
  const provider = providers[index];
  const block = selectedBlocks[index];
  assert.equal(
    block.protocolVersion,
    2001100,
    'Expected the observed Ledger 9 transaction protocol.',
  );
  await verifyFinalizedBlock(block);
  blocks.push({ id: endpoint.id, height: block.height, hash: block.hash });
  const hashes = [];
  for (const [kind, address] of [
    ['registry', registry.address],
    ['account', recipient.address],
  ]) {
    const state = await provider.queryContractState(address, {
      type: 'blockHash',
      blockHash: registry.claimBlock.hash,
    });
    assert.equal(state?.protocolVersion, 2001100);
    const bytes = state?.contractState?.serialize();
    assert.ok(bytes instanceof Uint8Array && bytes.length > 0, `${kind} state is unavailable.`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    hashes.push({ kind, bytes: bytes.length, sha256: hash });
  }
  states.set(endpoint.id, hashes);
}
assert.deepEqual(states.get('primary'), states.get('witness'), 'Pinned contract state differs.');

const names = configureMidnames(
  {
    registryProfile: registry.profile,
    registryAddress: registry.address,
    namespace: 'night',
    networkId: chain.networkId,
    indexerUrl: primaryHttp,
    indexerWsUrl: primaryWs,
    verificationIndexerUrl: witnessHttp,
    verificationIndexerWsUrl: witnessWs,
    nodeUrl,
    anchorBlockHeight: String(pin.anchorHeight),
    anchorBlockHash: pin.anchorHash,
    knownName: registry.name,
    knownAccountAddress: recipient.address,
  },
  chain.networkId,
  recipient.bindingId,
);
assert.ok(names, 'The explicit Midnames profile must be configured.');
const resolved = await names.resolve({ name: registry.name, networkId: chain.networkId });
assert.equal(resolved?.accountAddress, recipient.address);
assert.equal(resolved?.name, registry.name);

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      result: 'PASS_LOCAL_READ_ONLY',
      sourceCommit,
      observedAt: new Date().toISOString(),
      chain: { networkId: chain.networkId, genesisHash: chain.genesisHash },
      anchor: registry.claimBlock,
      indexers: blocks.map((block, index) => ({
        ...block,
        http: endpoints[index].http,
        ws: endpoints[index].ws,
      })),
      witness: {
        project: witnessProject,
        containerId: witness.Id,
        image: witness.Config.Image,
        volume: witnessVolume.Name,
        network: 'midnight-network_default',
        alias: 'read-witness-indexer',
        credentialFileMode: '0600',
        credentialDirectoryMode: '0700',
        credentialValuesDistinctFromPrimary: true,
      },
      stateSha256: states.get('primary'),
      name: registry.name,
      registryAddress: registry.address,
      accountAddress: resolved.accountAddress,
      bindingId: recipient.bindingId,
      limits: [
        'Both indexers attach to one shared node; this is not independent node consensus.',
        'Matching indexer state bytes do not establish a cryptographic contract-state proof.',
        'The local transitional .night registry is not public passport.night or MIP-0007 delegation.',
      ],
    },
    null,
    2,
  ),
);
