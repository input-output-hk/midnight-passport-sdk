// Deploy only the pinned Midnames registry to an already running standalone stack.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statfsSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dedicatedIndexerReadiness } from '../../scripts/qualification/indexer-readiness.mjs';
import { nativeLeasePath } from '../../scripts/qualification/native-lease.mjs';
import { verifyPreparedRegistry } from './verify-prepared.mjs';

const [output, prepared, reference, rootTarget] = process.argv.slice(2);
assert.ok(process.env.IN_NIX_SHELL && process.env.COMPACT_DIRECTORY, 'Use the pinned Nix shell.');
assert.equal(process.env.PASSPORT_MIDNAMES_BOOTSTRAP, '1');
assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
assert.equal(process.env.MIDNIGHT_NETWORK, 'local');
assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
assert.ok(output && prepared && reference);
for (const path of [output, prepared, reference])
  assert.ok(isAbsolute(path) && resolve(path) === path, 'Use absolute input paths.');
assert.match(rootTarget ?? '', /^[a-f0-9]{64}$/, 'Supply an activated ACC contract address.');
assert.ok(!existsSync(output), 'Choose a new receipt directory; never overwrite a deployment.');
assert.ok(
  !existsSync(nativeLeasePath()),
  'Reconcile the retained native run before bootstrapping.',
);
const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
const disk = statfsSync(sourceRoot);
assert.ok(BigInt(disk.bavail) * BigInt(disk.bsize) >= 15n * 1024n ** 3n);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: sourceRoot,
  encoding: 'utf8',
}).trim();
const sourceDirty =
  execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }).trim() !==
  '';
assert.ok(!sourceDirty, 'Commit the bootstrap source before a native deployment.');

function localEndpoint(value, protocol) {
  assert.ok(value, 'Configure every standalone endpoint explicitly.');
  const parsed = new URL(value);
  assert.equal(parsed.protocol, protocol + ':');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname));
  assert.ok(!parsed.username && !parsed.password && !parsed.search && !parsed.hash);
  return parsed.href;
}

const endpoints = {
  nodeUrl: localEndpoint(process.env.MN_NODE_URL, 'http'),
  indexerUrl: localEndpoint(process.env.MN_INDEXER_URL, 'http'),
  indexerWsUrl: localEndpoint(process.env.MN_INDEXER_WS_URL, 'ws'),
  proverUrl: localEndpoint(process.env.MN_PROOF_SERVER_URL, 'http'),
};
assert.equal(new URL(endpoints.indexerUrl).pathname, '/api/v4/graphql');
assert.equal(new URL(endpoints.indexerWsUrl).pathname, '/api/v4/graphql/ws');
assert.equal(new URL(endpoints.nodeUrl).pathname, '/');
assert.equal(new URL(endpoints.proverUrl).pathname, '/');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const post = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  assert.ok(response.ok, 'Local stack request failed.');
  const data = await response.json();
  assert.equal(data.error, undefined);
  return data.result;
};

const pins = await verifyPreparedRegistry(prepared);
const ready = await dedicatedIndexerReadiness(endpoints);
assert.ok(ready.ready, 'The local indexer does not match the live finalized node.');
assert.match(
  await post(endpoints.nodeUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'system_chain',
    params: [],
  }),
  /^undeployed\d*$/,
  'This is not an undeployed standalone chain.',
);
const proofHealth = await fetch(new URL('/health', endpoints.proverUrl), {
  signal: AbortSignal.timeout(5_000),
});
assert.ok(proofHealth.ok, 'The local prover is unavailable.');

mkdirSync(output, { mode: 0o700 });
const receipt = {
  status: 'RUNNING',
  sourceCommit,
  sourceDirty,
  sourceTag: pins.midnamesSourceTag,
  sourceSha256: pins.sourceSha256,
  preparedManifestSha256: sha256(readFileSync(join(prepared, 'prepared.json'))),
  networkId: 'undeployed',
  registryProfile: 'standalone-0.35',
  endpoints,
  finalizedBefore: ready.finalizedHash,
  rootTarget,
  transactions: [],
  steps: [],
};
const save = () =>
  writeFileSync(join(output, 'bootstrap.json'), JSON.stringify(receipt, null, 2) + '\n', {
    mode: 0o600,
  });
const step = (name, fields = {}) => {
  receipt.steps.push({ name, ...fields });
  save();
  console.log(name);
};
save();

let wallet;
let rootSecret;
try {
  const runtimeRoot = join(output, 'registry-runtime');
  mkdirSync(runtimeRoot, { mode: 0o700 });
  symlinkSync(join(reference, 'node_modules'), join(runtimeRoot, 'node_modules'));
  const modulePath = join(runtimeRoot, 'registry.mjs');
  writeFileSync(modulePath, readFileSync(join(prepared, 'managed/contract/index.js')), {
    flag: 'wx',
    mode: 0o600,
  });
  assert.equal(sha256(readFileSync(modulePath)), pins.compiled['contract/index.js']);
  const get = async (name) =>
    import(import.meta.resolve(name, pathToFileURL(join(reference, 'package.json')).href));
  const [walletModule, registry, { CompiledContract }, contracts, ledger, zk, proof, reader] =
    await Promise.all([
      import(pathToFileURL(join(reference, 'src/node/wallet.ts')).href),
      import(pathToFileURL(modulePath).href),
      get('@midnight-ntwrk/compact-js'),
      get('@midnight-ntwrk/midnight-js-contracts'),
      get('@midnightntwrk/ledger-v9'),
      get('@midnight-ntwrk/midnight-js-node-zk-config-provider'),
      get('@midnight-ntwrk/midnight-js-http-client-proof-provider'),
      import('../../apps/passport-dapp/src/midnames/ledger-reader.ts'),
    ]);
  process.chdir(output);
  step('sync-bootstrap-wallet');
  wallet = await walletModule.createWallet('0'.repeat(63) + '1');
  await walletModule.syncWallet(wallet, 'local registry bootstrap');
  const providers = await walletModule.createProviders(wallet);
  const account = reader.createMidnamesLedgerReads(
    reader.createMidnamesIndexer('undeployed', endpoints.indexerUrl, endpoints.indexerWsUrl),
    'undeployed',
    'acc-s3r1.1',
    'standalone-0.35',
  );
  assert.ok(
    await account.isSupportedAccount(rootTarget, 'undeployed'),
    'The root target is not an activated ACC with the pinned binding.',
  );
  step('verified-root-target');
  const submit = providers.midnightProvider.submitTx.bind(providers.midnightProvider);
  providers.midnightProvider.submitTx = async (tx) => {
    assert.equal(tx.version, 'v9');
    const raw = tx.tx.serialize();
    const ordinal = receipt.transactions.length + 1;
    writeFileSync(join(output, `tx-${ordinal}.private.bin`), raw, {
      flag: 'wx',
      mode: 0o600,
    });
    // Once the original bytes exist, a thrown submit may still mean the node
    // accepted them. Keep the outcome unknown until an identifier is returned.
    const row = { ordinal, hash: sha256(raw), status: 'submission-unknown' };
    receipt.transactions.push(row);
    save();
    const id = await submit(tx);
    row.id = String(id);
    row.status = 'submitted';
    save();
    return id;
  };
  const assets = join(prepared, 'managed');
  const registryProviders = {
    ...providers,
    zkConfigProvider: new zk.NodeZkConfigProvider(assets, {
      expectedManifestHash: pins.compiled['compiler/contract-manifest.json'],
    }),
    proofProvider: proof.httpClientProofProvider(
      endpoints.proverUrl,
      await zk.nodeZkConfigRegistry(assets),
    ),
  };
  rootSecret = new Uint8Array(randomBytes(32));
  writeFileSync(join(output, 'root-secret.private.hex'), Buffer.from(rootSecret).toString('hex'), {
    flag: 'wx',
    mode: 0o600,
  });
  const compiled = CompiledContract.make('registry', registry.Contract).pipe(
    CompiledContract.withWitnesses({ domainSecretKey: () => [{}, rootSecret] }),
    CompiledContract.withCompiledFileAssets(assets),
  );
  const owner = { bytes: walletModule.userAddressBytes(wallet) };
  const price = {
    cost_short: 1n,
    cost_med: 1n,
    cost_long: 1n,
    coin_color: new Uint8Array(32),
    buy_enabled: true,
  };
  const fields = Array.from({ length: 10 }, () => ({ is_some: false, value: ['', ''] }));
  step('prepare-registry');
  const data = await contracts.createUnprovenDeployTx(registryProviders, {
    compiledContract: compiled,
    privateStateId: 'midnames-registry',
    initialPrivateState: {},
    args: [
      'night',
      Uint8Array.from(Buffer.from(rootTarget, 'hex')),
      registry.AddressType.ContractAddr,
      { is_some: false, value: '' },
      price,
      owner,
      fields,
      { is_some: false, value: 0n },
      true,
    ],
  });
  const ContractState = ledger.ContractState;
  const full = ContractState.deserialize(data.public.initialContractState.serialize());
  const waves = [[]];
  let waveSize = 0;
  for (const name of Object.keys(pins.circuits)) {
    const operation = full.operation(name);
    assert.ok(operation, `Missing prepared registry verifier: ${name}`);
    assert.equal(sha256(operation.verifierKey), pins.circuits[name].verifier);
    if (waveSize + operation.verifierKey.length > 15_000) {
      waves.push([]);
      waveSize = 0;
    }
    waves.at(-1).push(name);
    waveSize += operation.verifierKey.length;
  }
  assert.ok(waves.length > 1);
  const initial = new ContractState();
  initial.data = full.data;
  initial.maintenanceAuthority = full.maintenanceAuthority;
  for (const name of waves[0]) initial.setOperation(name, full.operation(name));
  const deploy = new ledger.ContractDeploy(initial);
  const registryAddress = String(deploy.address);
  const tx = (build) =>
    ledger.Transaction.fromParts(
      'undeployed',
      undefined,
      undefined,
      build(ledger.Intent.new(new Date(Date.now() + 60_000))),
    );
  const send = (unprovenTx) => contracts.submitTx(registryProviders, { unprovenTx });
  step('deploy-registry', { registryAddress, waves: waves.length });
  await send(tx((intent) => intent.addDeploy(deploy)));
  for (const [i, names] of waves.slice(1).entries()) {
    const before = await providers.publicDataProvider.queryContractState(registryAddress);
    assert.ok(before, 'The original registry deployment is not visible.');
    const counter = ContractState.deserialize(before.serialize()).maintenanceAuthority.counter;
    const changes = names.map(
      (name) =>
        new ledger.VerifierKeyInsert(
          name,
          new ledger.ContractOperationVersionedVerifierKey('v4', full.operation(name).verifierKey),
        ),
    );
    if (i === waves.length - 2)
      changes.push(
        new ledger.ReplaceAuthority(new ledger.ContractMaintenanceAuthority([], 1, counter + 1n)),
      );
    const bare = new ledger.MaintenanceUpdate(registryAddress, changes, counter);
    const signed = bare.addSignature(0n, ledger.signData(data.private.signingKey, bare.dataToSign));
    step('registry-wave-' + (i + 2));
    await send(tx((intent) => intent.addMaintenanceUpdate(signed)));
  }
  const onChain = await providers.publicDataProvider.queryContractState(registryAddress);
  assert.ok(onChain, 'The deployed registry is not visible.');
  const state = ContractState.deserialize(onChain.serialize());
  assert.equal(state.operations().length, Object.keys(pins.circuits).length);
  for (const [name, pin] of Object.entries(pins.circuits)) {
    const operation = state.operation(name);
    assert.ok(operation, `Missing deployed registry verifier: ${name}`);
    assert.equal(sha256(operation.verifierKey), pin.verifier);
  }
  assert.deepEqual(state.maintenanceAuthority.committee, []);
  const root = registry.ledger(state.data);
  assert.equal(root.TLD, 'night');
  const rootRecord = root.id_to_data.lookup(root.ROOT_ZONE_ID);
  assert.deepEqual(rootRecord.target, Uint8Array.from(Buffer.from(rootTarget, 'hex')));
  assert.equal(rootRecord.target_type, registry.AddressType.ContractAddr);
  const rootOwnerCommitment = Buffer.from(rootRecord.owner_public_key).toString('hex');
  const tag = Buffer.alloc(32);
  tag.write('midnight.domains');
  assert.equal(rootOwnerCommitment, sha256(Buffer.concat([tag, rootSecret])));
  const waveCount = waves.length;
  Object.assign(receipt, { status: 'PASS', registryAddress, waveCount, rootOwnerCommitment });
  save();
  console.log(JSON.stringify({ registryAddress, networkId: 'undeployed', waveCount }));
} catch (error) {
  receipt.status = 'FAIL';
  receipt.error = String(error);
  save();
  throw error;
} finally {
  rootSecret?.fill(0);
  if (wallet) await wallet.wallet.stop();
}
