// First native gate for the complete provisional ACC key profile. This worker
// runs only under qualify-deposit.mjs's isolated stack, lease and input fences.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  isolationEnvironment,
  isolationProfile,
} from '../../scripts/qualification/native-isolation-profile.mjs';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';
import {
  detectDeployedVersionByCircuit,
  resolveBinding,
  resolvePinnedBinding,
} from '../../packages/contract/dist/index.js';

const [output, , ref] = process.argv.slice(2);
assert.equal(process.env.PASSPORT_MIDNAMES_FIXTURE_MODE, 'acc-candidate');
assert.equal(process.env.PASSPORT_MIDNAMES_NATIVE, '1');
assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
const assets = process.env.PASSPORT_MIDNAMES_CANDIDATE_ASSETS;
assert.ok(assets);
for (const [name, value] of Object.entries(
  isolationEnvironment(isolationProfile(process.env.PASSPORT_NATIVE_ISOLATION_RUN_ID, output)),
))
  assert.equal(process.env[name], value, `Unexpected fixture setting ${name}`);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const bindingId = 'acc-s3r1.1-zkir036';
const binding = resolvePinnedBinding(bindingId);
assert.equal(binding.provisional, true);
assert.equal(
  binding.manifestSha256,
  '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f',
);
assert.throws(() => resolveBinding(bindingId), { code: 'UNSUPPORTED_BINDING' });
const receipt = {
  schemaVersion: 1,
  bindingId,
  manifestSha256: binding.manifestSha256,
  transactions: [],
  steps: [],
  passed: false,
};
const save = () => saveIsolationReceipt(join(output, 'worker.json'), receipt);
const step = (name) => {
  receipt.steps.push(name);
  save();
  console.log(name);
};
const get = (name) =>
  import(import.meta.resolve(name, pathToFileURL(join(ref, 'package.json')).href));

// Resolve the generated module against the same physical Compact runtime as
// the pinned reference client, while executing bytes from the candidate tree.
const moduleRoot = join(output, 'candidate-runtime');
mkdirSync(moduleRoot);
symlinkSync(join(ref, 'node_modules'), join(moduleRoot, 'node_modules'));
const modulePath = join(moduleRoot, 'account.mjs');
writeFileSync(modulePath, readFileSync(join(assets, 'contract/index.js')), {
  mode: 0o600,
  flag: 'wx',
});
assert.equal(sha256(readFileSync(modulePath)), binding.moduleHashes['contract/index.js']);

const [walletModule, waves, acc, { CompiledContract }, contracts, ledger, zk, proof, inbox] =
  await Promise.all([
    import(pathToFileURL(join(ref, 'src/node/wallet.ts')).href),
    import(pathToFileURL(join(ref, 'src/wallet/wave-deploy.ts')).href),
    import(pathToFileURL(modulePath).href),
    get('@midnight-ntwrk/compact-js'),
    get('@midnight-ntwrk/midnight-js-contracts'),
    get('@midnightntwrk/ledger-v9'),
    get('@midnight-ntwrk/midnight-js-node-zk-config-provider'),
    get('@midnight-ntwrk/midnight-js-http-client-proof-provider'),
    import(pathToFileURL(join(ref, 'src/wallet/inbox.ts')).href),
  ]);

let wallet;
try {
  step('sync-isolated-genesis-wallet');
  wallet = await walletModule.createWallet('0'.repeat(63) + '1');
  await walletModule.syncWallet(wallet, 'isolated genesis sponsor');
  const providers = await walletModule.createProviders(wallet);
  const registry = await zk.nodeZkConfigRegistry(assets);
  providers.zkConfigProvider = new zk.NodeZkConfigProvider(assets, {
    expectedManifestHash: binding.manifestSha256,
  });
  providers.proofProvider = proof.httpClientProofProvider(
    process.env.MN_PROOF_SERVER_URL,
    registry,
  );
  const submit = providers.midnightProvider.submitTx.bind(providers.midnightProvider);
  providers.midnightProvider.submitTx = async (tx) => {
    assert.equal(tx.version, 'v9');
    const ordinal = receipt.transactions.length + 1;
    const raw = tx.tx.serialize();
    writeFileSync(join(output, `tx-${ordinal}.private.bin`), raw, { mode: 0o600, flag: 'wx' });
    const original = { ordinal, sha256: sha256(raw) };
    receipt.transactions.push(original);
    save();
    const id = await submit(tx);
    original.id = String(id);
    save();
    return id;
  };
  const compiled = CompiledContract.make('account', acc.Contract).pipe(
    CompiledContract.withWitnesses({
      held_coin: () => {
        throw Error('No shielded spend');
      },
    }),
    CompiledContract.withCompiledFileAssets(assets),
  );
  const pub = acc.pureCircuits.compute_public_point_with_jubjub(
    BigInt('0x' + randomBytes(31).toString('hex')) + 1n,
  );
  const salt = new Uint8Array(randomBytes(32));
  const encKeys = inbox.generateEncKeyPair();
  const boot = acc.pureCircuits.derive_boot_commitment_with_jubjub(salt, pub);
  encKeys.secretKey.fill(0);
  step('deploy-candidate-acc');
  const address = await waves.deployAccountInWaves(providers, compiled, {
    firstArm: 'jubjub',
    retireAuthority: true,
    privateStateId: 'candidate-account',
    initialPrivateState: {},
    args: [boot, encKeys.publicKey, pub, new Uint8Array(64), 60n],
  });
  step('activate-candidate-acc');
  await contracts.submitCallTx(providers, {
    compiledContract: compiled,
    contractAddress: address,
    circuitId: 'activate_initial_device_with_jubjub',
    privateStateId: 'candidate-account',
    args: [pub, salt],
  });
  salt.fill(0);
  const state = ledger.ContractState.deserialize(
    (await providers.publicDataProvider.queryContractState(address)).serialize(),
  );
  const observed = Object.fromEntries(
    Object.entries(binding.circuits).flatMap(([name, pin]) =>
      pin.proof ? [[name, sha256(state.operation(name)?.verifierKey ?? new Uint8Array())]] : [],
    ),
  );
  assert.equal(state.operations().length, 52);
  assert.equal(detectDeployedVersionByCircuit(observed), bindingId);
  for (const [name, hash] of Object.entries(observed))
    assert.equal(hash, binding.circuits[name].hashes.verifierKey, `Candidate verifier ${name}`);
  assert.deepEqual(state.maintenanceAuthority.committee, []);
  const decoded = acc.ledger(state.data);
  assert.equal(decoded.booted, true);
  assert.equal(decoded.spec_version, 3n);
  Object.assign(receipt, {
    accountAddress: address,
    verifierCount: 52,
    activated: true,
    passed: true,
  });
  step('verified-candidate-deployment-and-activation');
} catch (error) {
  receipt.error = String(error);
  save();
  throw error;
} finally {
  if (wallet) await wallet.wallet.stop();
}
