import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  isolationEnvironment,
  isolationProfile,
} from '../../scripts/qualification/native-isolation-profile.mjs';
import { saveIsolationReceipt } from '../../scripts/qualification/native-isolation-files.mjs';
import { verifyPreparedRegistry } from './verify-prepared.mjs';

const [output, prepared, ref] = process.argv.slice(2);
assert.equal(process.env.PASSPORT_MIDNAMES_NATIVE, '1');
assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
const expectedEnvironment = isolationEnvironment(
  isolationProfile(process.env.PASSPORT_NATIVE_ISOLATION_RUN_ID, output),
);
for (const [key, value] of Object.entries(expectedEnvironment))
  assert.equal(process.env[key], value, `Unexpected fixture setting ${key}`);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const pins = await verifyPreparedRegistry(prepared);
const assets = join(prepared, 'managed');
const asset = (path) => readFileSync(join(assets, path));
// Keep the generated module and the host SDK on the same physical WASM runtime.
const runtimeRoot = join(output, 'registry-runtime');
mkdirSync(runtimeRoot);
symlinkSync(join(ref, 'node_modules'), join(runtimeRoot, 'node_modules'));
const modulePath = join(runtimeRoot, 'registry.mjs');
writeFileSync(modulePath, asset('contract/index.js'), { mode: 0o600, flag: 'wx' });
assert.equal(sha(readFileSync(modulePath)), pins.compiled['contract/index.js']);
const get = async (name) =>
  import(import.meta.resolve(name, pathToFileURL(join(ref, 'package.json')).href));
const [
  walletModule,
  wave,
  registry,
  acc,
  { CompiledContract },
  contracts,
  ledger,
  zk,
  proof,
  { createMidnamesIndexer, createMidnamesLedgerReads },
  { createMidnamesNameService },
  inbox,
] = await Promise.all([
  import(pathToFileURL(join(ref, 'src/node/wallet.ts')).href),
  import(pathToFileURL(join(ref, 'src/wallet/wave-deploy.ts')).href),
  import(pathToFileURL(modulePath).href),
  import(pathToFileURL(join(ref, 'contracts/managed/account/contract/index.js')).href),
  get('@midnight-ntwrk/compact-js'),
  get('@midnight-ntwrk/midnight-js-contracts'),
  get('@midnightntwrk/ledger-v9'),
  get('@midnight-ntwrk/midnight-js-node-zk-config-provider'),
  get('@midnight-ntwrk/midnight-js-http-client-proof-provider'),
  import('../../apps/passport-dapp/src/midnames/ledger-reader.ts'),
  import('../../apps/passport-dapp/src/midnames/resolver.ts'),
  import(pathToFileURL(join(ref, 'src/wallet/inbox.ts')).href),
]);
const mode = process.env.PASSPORT_MIDNAMES_FIXTURE_MODE;
assert.ok(
  [
    'named-shielded-deposit',
    'named-night-send',
    'claim-handoff',
    'claim-browser',
    'claim-owner-browser',
  ].includes(mode),
);
const browserOwner = mode === 'claim-owner-browser' || mode === 'claim-browser';
const claimFixture = mode === 'claim-handoff' || browserOwner;
const receipt = { transactions: [], steps: [], passed: false, mode };
const save = () => saveIsolationReceipt(join(output, 'worker.json'), receipt);
const step = (label) => {
  receipt.steps.push(label);
  save();
  console.log(label);
};
const write = (name, data) => writeFileSync(join(output, name), data, { mode: 0o600, flag: 'wx' });
process.chdir(output);
let wallet;
try {
  step('sync-wallet');
  wallet = await walletModule.createWallet('0'.repeat(63) + '1');
  await walletModule.syncWallet(wallet, 'isolated genesis sponsor');
  const providers = await walletModule.createProviders(wallet);
  const submit = providers.midnightProvider.submitTx.bind(providers.midnightProvider);
  providers.midnightProvider.submitTx = async (tx) => {
    assert.equal(tx.version, 'v9');
    const raw = tx.tx.serialize(),
      ordinal = receipt.transactions.length + 1;
    write('tx-' + ordinal + '.private.bin', raw);
    const row = { ordinal, sha256: sha(raw) };
    receipt.transactions.push(row);
    save();
    const id = await submit(tx);
    row.id = String(id);
    save();
    return id;
  };
  const key = ledger.ContractState;
  const accountCompiled = CompiledContract.make('account', acc.Contract).pipe(
    CompiledContract.withWitnesses({
      held_coin: () => {
        throw Error('No shielded spend');
      },
    }),
    CompiledContract.withCompiledFileAssets(join(ref, 'contracts/managed/account')),
  );
  const randomJubJubPoint = () =>
    acc.pureCircuits.compute_public_point_with_jubjub(
      BigInt('0x' + randomBytes(31).toString('hex')) + 1n,
    );
  const deployAccount = async (label, pub, encKey) => {
    const salt = new Uint8Array(randomBytes(32));
    const privateStateId = 'midnames-' + label;
    step('deploy-' + label);
    const address = await wave.deployAccountInWaves(providers, accountCompiled, {
      firstArm: 'jubjub',
      retireAuthority: true,
      privateStateId,
      initialPrivateState: {},
      args: [
        acc.pureCircuits.derive_boot_commitment_with_jubjub(salt, pub),
        encKey,
        randomJubJubPoint(),
        new Uint8Array(64),
        60n,
      ],
    });
    step('activate-' + label);
    await contracts.submitCallTx(providers, {
      compiledContract: accountCompiled,
      contractAddress: address,
      circuitId: 'activate_initial_device_with_jubjub',
      privateStateId,
      args: [pub, salt],
    });
    return address;
  };
  const encKeys = inbox.generateEncKeyPair();
  const accountAddress = await deployAccount('account', randomJubJubPoint(), encKeys.publicKey);

  const regProviders = {
    ...providers,
    zkConfigProvider: new zk.NodeZkConfigProvider(assets, {
      expectedManifestHash: pins.compiled['compiler/contract-manifest.json'],
    }),
    proofProvider: proof.httpClientProofProvider(
      process.env.MN_PROOF_SERVER_URL,
      await zk.nodeZkConfigRegistry(assets),
    ),
  };
  // This root-owner fixture exercises lookup independently of paid claimant admission.
  const rootSecret = new Uint8Array(randomBytes(32));
  const compiled = (secret) =>
    CompiledContract.make('registry', registry.Contract).pipe(
      CompiledContract.withWitnesses({ domainSecretKey: () => [{}, secret] }),
      CompiledContract.withCompiledFileAssets(assets),
    );
  const owner = { bytes: walletModule.userAddressBytes(wallet) };
  const registryPayee = claimFixture ? { bytes: new Uint8Array(32).fill(0x22) } : owner;
  const price = {
    cost_short: 1n,
    cost_med: 1n,
    cost_long: 1n,
    coin_color: new Uint8Array(32),
    buy_enabled: true,
  };
  const fields = Array.from({ length: 10 }, () => ({ is_some: false, value: ['', ''] }));
  const noDefault = { is_some: false, value: '' };
  const target = new Uint8Array(Buffer.from(accountAddress, 'hex'));
  assert.equal(target.length, 32);
  const privateStateId = 'midnames-registry';
  step('prepare-registry');
  const data = await contracts.createUnprovenDeployTx(regProviders, {
    compiledContract: compiled(rootSecret),
    privateStateId,
    initialPrivateState: {},
    args: [
      'night',
      target,
      registry.AddressType.ContractAddr,
      noDefault,
      price,
      registryPayee,
      fields,
      { is_some: false, value: 0n },
      true,
    ],
  });
  const full = key.deserialize(data.public.initialContractState.serialize());
  const waves = [[]];
  let waveSize = 0;
  for (const name of Object.keys(pins.circuits)) {
    const operation = full.operation(name);
    assert.equal(sha(operation.verifierKey), pins.circuits[name].verifier);
    if (waveSize + operation.verifierKey.length > 15000) {
      waves.push([]);
      waveSize = 0;
    }
    waves.at(-1).push(name);
    waveSize += operation.verifierKey.length;
  }
  assert.ok(waves.length > 1);
  const initial = new key();
  initial.data = full.data;
  initial.maintenanceAuthority = full.maintenanceAuthority;
  for (const name of waves[0]) initial.setOperation(name, full.operation(name));
  const deploy = new ledger.ContractDeploy(initial),
    registryAddress = String(deploy.address);
  const tx = (build) =>
    ledger.Transaction.fromParts(
      'undeployed',
      undefined,
      undefined,
      build(ledger.Intent.new(new Date(Date.now() + 60000))),
    );
  const send = (unprovenTx) => contracts.submitTx(regProviders, { unprovenTx });
  step('deploy-registry');
  await send(tx((intent) => intent.addDeploy(deploy)));
  for (const [i, names] of waves.slice(1).entries()) {
    const before = await providers.publicDataProvider.queryContractState(registryAddress);
    const counter = key.deserialize(before.serialize()).maintenanceAuthority.counter;
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
  const regState = key.deserialize(onChain.serialize());
  assert.equal(regState.operations().length, 13);
  assert.deepEqual(regState.maintenanceAuthority.committee, []);
  const rootId = registry.ledger(onChain.data).ROOT_ZONE_ID;
  await regProviders.privateStateProvider.setContractAddress(registryAddress);
  await regProviders.privateStateProvider.set(privateStateId, {});
  const defaultField =
    mode === 'named-night-send' ? { is_some: true, value: 'different-profile-default' } : noDefault;
  const nameKey = new Uint8Array(32).fill(255);
  nameKey.set(new TextEncoder().encode('alice'));
  process.env.TX_TTL_MS = '45000';
  step('prove-and-submit-root-owned-fixture');
  await contracts.submitCallTx(regProviders, {
    compiledContract: compiled(rootSecret),
    contractAddress: registryAddress,
    circuitId: 'create_domain',
    privateStateId,
    args: [
      owner,
      nameKey,
      5n,
      rootId,
      target,
      registry.AddressType.ContractAddr,
      defaultField,
      price,
      fields,
    ],
  });
  const observed = registry.ledger(
    (await providers.publicDataProvider.queryContractState(registryAddress)).data,
  );
  const record = observed.id_to_data.lookup(
    observed.name_to_id.lookup({ domain: nameKey, parent_id: rootId }),
  );
  assert.deepEqual(record.target, target);
  if (defaultField.is_some) assert.equal(record.default_field.value, defaultField.value);
  assert.deepEqual(record.owner_public_key, observed.id_to_data.lookup(rootId).owner_public_key);
  const tag = Buffer.alloc(32);
  tag.write('midnight.domains');
  const expectedOwner = createHash('sha256').update(tag).update(rootSecret).digest('hex');
  const indexer = createMidnamesIndexer(
    'undeployed',
    process.env.MN_INDEXER_URL,
    process.env.MN_INDEXER_WS_URL,
  );
  const reads = createMidnamesLedgerReads(indexer, 'undeployed', 'acc-s3r1.1', 'standalone-0.35');
  const profile = { networkId: 'undeployed', namespace: 'night', registryAddress };
  const service = createMidnamesNameService(profile, reads);
  assert.deepEqual(await reads.readClaim('alice.night', profile), {
    ownerCommitment: expectedOwner,
    target: { kind: 'contract', address: accountAddress },
  });
  assert.equal(
    (await service.resolve({ networkId: 'undeployed', name: 'alice.night' }))?.accountAddress,
    accountAddress,
  );
  const claimIdentifier = receipt.transactions.at(-1).id;
  const getReferenceSigner = () => import(pathToFileURL(join(ref, 'src/wallet/signer.ts')).href);
  if (claimFixture) {
    const { qualifyClaimHandoff } = await import('./claim-handoff-fixture.mjs');
    let dispatch;
    if (mode === 'claim-browser') {
      const { delegateClaimDust } = await import('./claim-dust-fixture.mjs');
      const { qualifyBrowserClaim } = await import('./claim-browser-fixture.mjs');
      receipt.availableDust = await delegateClaimDust({
        wallet,
        walletModule,
        providers,
        ledger,
        get,
        step,
      });
      const readLive = async (quote) => {
        const current = registry.ledger(
          (await providers.publicDataProvider.queryContractState(registryAddress)).data,
        );
        assert.equal(current.ROOT_ZONE_ID, rootId);
        const parent = current.id_to_data.lookup(rootId);
        assert.equal(parent.payment_config.cost_long, quote.night);
        assert.ok(
          parent.payment_config.buy_enabled &&
            parent.payment_config.coin_color.every((byte) => byte === 0),
        );
        assert.equal(Buffer.from(parent.owner_address.bytes).toString('hex'), quote.registryPayee);
        assert.equal(await reads.readClaim(quote.name, profile), undefined);
        assert.ok(await reads.isSupportedAccount(accountAddress, profile.networkId));
      };
      dispatch = (quote, original, fixtureQuote, ownerProofSha256) =>
        qualifyBrowserClaim({
          output,
          quote,
          receipt: original,
          fixtureQuote,
          ownerProofSha256,
          ledger,
          submit: providers.midnightProvider.submitTx,
          readLive,
        });
    }
    const handoff = await qualifyClaimHandoff({
      output,
      ref,
      assets,
      modulePath,
      registryManifestHash: pins.compiled['compiler/contract-manifest.json'],
      registryAddress,
      accountAddress,
      sponsorPaymentAddress: Buffer.from(owner.bytes).toString('hex'),
      walletProvider: regProviders.walletProvider,
      ledger,
      rootId,
      parentDomain: observed.id_to_data.lookup(rootId),
      step,
      dispatch,
      browserOwner,
    });
    Object.assign(receipt, { ...handoff, passed: true });
    step(mode === 'claim-browser' ? 'verified-browser-claim' : 'verified-prepared-claim-handoff');
  } else if (mode === 'named-night-send') {
    const { qualifyNightSend } = await import('./night-send-fixture.mjs');
    const { JubjubDevice, jubjubChallenges } = await getReferenceSigner();
    const device = JubjubDevice.generate();
    const source = await deployAccount('source', device.pk, inbox.generateEncKeyPair().publicKey);
    const proofReceipt = await qualifyNightSend({
      output,
      get,
      walletModule,
      wallet,
      providers,
      accountCompiled,
      contracts,
      ledger,
      binding: acc,
      reads,
      source,
      device,
      jubjubChallenges,
      registryAddress,
      target: accountAddress,
      defaultField,
      step,
    });
    Object.assign(receipt, { ...proofReceipt, claimIdentifier, registryAddress, passed: true });
    step('verified-native-named-night-send');
  } else {
    await wallet.wallet.stop();
    wallet = undefined;
    Object.assign(receipt, {
      accountAddress,
      registryAddress,
      claimIdentifier: receipt.transactions.at(-1).id,
    });
    step('start-independent-sender');
    // Pass only the local registry and exact name. The sender resolves the
    // address itself and opens a separate working directory for its wallet.
    const sender = spawn(
      process.execPath,
      [
        '--experimental-import-meta-resolve',
        '--import',
        'tsx',
        join(import.meta.dirname, 'deposit-sender.mjs'),
        output,
        ref,
        registryAddress,
        'alice.night',
      ],
      {
        cwd: join(import.meta.dirname, '../../apps/passport-dapp'),
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );
    await new Promise((resolve, reject) => {
      sender.once('error', reject);
      sender.once('exit', (code, signal) =>
        code === 0 ? resolve() : reject(Error(`Sender exited ${code}/${signal}`)),
      );
    });
    const sent = JSON.parse(readFileSync(join(output, 'sender', 'sender.json')));
    assert.equal(sent.review.accountAddress, accountAddress);
    assert.equal(sent.dispatches, 1);
    const ownerState = acc.ledger(
      (await providers.publicDataProvider.queryContractState(accountAddress)).data,
    );
    const entries = [...ownerState.inbox]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, entry]) => entry);
    const coin = inbox.openInboxEntry(encKeys.secretKey, entries[sent.inboxIndex]);
    assert.ok(coin);
    assert.equal(coin.value, BigInt(sent.review.amount));
    assert.equal(Buffer.from(coin.color).toString('hex'), sent.review.color);
    const appDependency = (name) =>
      import(
        import.meta.resolve(
          name,
          pathToFileURL(join(import.meta.dirname, '../../apps/passport-dapp/package.json')).href,
        )
      );
    const { createGraphqlHoldingIndexer, createMidnightHoldingSource } = await appDependency(
      '@input-output-hk/mn-passport-adapter-midnight-js',
    );
    const holdingIndexer = createGraphqlHoldingIndexer({
      networkId: 'undeployed',
      url: process.env.MN_INDEXER_URL,
      wsUrl: process.env.MN_INDEXER_WS_URL,
    });
    const commitment = ledger.ZswapOutput.newContractOwned(
      {
        type: sent.review.color,
        nonce: Buffer.from(coin.nonce).toString('hex'),
        value: coin.value,
      },
      undefined,
      accountAddress,
    ).commitment;
    const outputs = await holdingIndexer.queryShieldedOutputs(sent.txHash);
    assert.ok(
      outputs.some(
        (output) => output.contractAddress === accountAddress && output.commitment === commitment,
      ),
    );
    const held = await createMidnightHoldingSource(holdingIndexer).selectHeldEntries(
      accountAddress,
      entries,
      entries.map((_, index) => (index === sent.inboxIndex ? { kind: 'coin', coin } : null)),
    );
    assert.deepEqual(held, [sent.inboxIndex]);
    encKeys.secretKey.fill(0);
    Object.assign(receipt, {
      ownerOpenedReceipt: true,
      originalOutputMatched: true,
      verifiedHeld: true,
      commitment,
    });
    step('verified-owner-holding');
    Object.assign(receipt, {
      accountAddress,
      registryAddress,
      rootOwnedFixture: true,
      ownerCommitmentMatched: true,
      resolverMatched: true,
      registryWaves: waves.length,
      passed: true,
    });
    step('verified-native-named-shielded-deposit');
  }
} catch (error) {
  receipt.error = String(error);
  save();
  throw error;
} finally {
  if (wallet) await wallet.wallet.stop();
}
