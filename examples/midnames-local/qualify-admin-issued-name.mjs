// Root-assisted local issuance when a paid claim is unavailable on the shared Ledger 9 chain.
// The root owner creates the name for free, then transfers it to a separate naming authority.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  statfsSync,
  writeFileSync,
  symlinkSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createMidnamesIndexer,
  createMidnamesLedgerReads,
} from '../../apps/passport-dapp/src/midnames/ledger-reader.ts';
import { dedicatedIndexerReadiness } from '../../scripts/qualification/indexer-readiness.mjs';
import {
  claimIsolationLease,
  releaseIsolationLease,
  saveIsolationReceipt,
} from '../../scripts/qualification/native-isolation-files.mjs';
import { isolatedInputs } from '../../scripts/qualification/native-isolation-inputs.mjs';
import { nativeLeasePath } from '../../scripts/qualification/native-lease.mjs';
import { proveInOwnerProcess } from './claim-owner-process.mjs';
import { verifyPreparedRegistry } from './verify-prepared.mjs';

const [
  output,
  prepared,
  reference,
  registryAddress,
  accountAddress,
  label,
  rootSecretFile,
  ownerSecretFile,
  sponsorSeedFile,
] = process.argv.slice(2);
assert.ok(process.env.IN_NIX_SHELL && process.env.COMPACT_DIRECTORY);
assert.equal(process.env.PASSPORT_MIDNAMES_ADMIN_ISSUE, '1');
assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
assert.equal(process.env.MIDNIGHT_NETWORK, 'local');
assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
assert.equal(process.env.MN_NODE_URL, 'http://127.0.0.1:9944');
assert.equal(process.env.MN_INDEXER_URL, 'http://127.0.0.1:8088/api/v4/graphql');
assert.equal(process.env.MN_INDEXER_WS_URL, 'ws://127.0.0.1:8088/api/v4/graphql/ws');
assert.equal(process.env.MN_PROOF_SERVER_URL, 'http://127.0.0.1:16320');
const root = fileURLToPath(new URL('../..', import.meta.url));
const review = join(root, 'review');
mkdirSync(review, { recursive: true, mode: 0o700 });
for (const path of [output, prepared, reference, rootSecretFile, ownerSecretFile, sponsorSeedFile])
  assert.ok(path && isAbsolute(path) && resolve(path) === path);
assert.equal(dirname(output), review);
assert.match(basename(output), /^midnames-admin-name-[a-z0-9-]{1,40}$/);
assert.ok(!existsSync(output));
assert.match(registryAddress ?? '', /^[0-9a-f]{64}$/);
assert.match(accountAddress ?? '', /^[0-9a-f]{64}$/);
assert.match(label ?? '', /^[a-z0-9-]{3,32}$/);
assert.equal(process.env.PASSPORT_MIDNAMES_APPROVED_NAME, label + '.night');
assert.ok(!existsSync(nativeLeasePath()));
const disk = statfsSync(root);
assert.ok(BigInt(disk.bavail) * BigInt(disk.bsize) >= 15n * 1024n ** 3n);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim();
assert.equal(
  execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  '',
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readPrivate = (path, length) => {
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && stat.nlink === 1 && (stat.mode & 0o077) === 0);
  if (process.getuid) assert.equal(stat.uid, process.getuid());
  const bytes = readFileSync(path);
  assert.equal(bytes.length, length);
  return bytes;
};
const rootSecretHash = sha256(readPrivate(rootSecretFile, 32));
const ownerSecretHash = sha256(readPrivate(ownerSecretFile, 32));
const sponsorSeed = readPrivate(sponsorSeedFile, 64).toString('utf8');
assert.match(sponsorSeed, /^[0-9a-f]{64}$/);
const sponsorSeedHash = sha256(Buffer.from(sponsorSeed));
const commitment = (path) =>
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./owner-commitment.mjs', import.meta.url)), path],
    { encoding: 'utf8', timeout: 10_000 },
  ).trim();
const rootCommitment = commitment(rootSecretFile);
const ownerCommitment = commitment(ownerSecretFile);
assert.notEqual(rootCommitment, ownerCommitment);
const nodeUrl = process.env.MN_NODE_URL;
const indexerUrl = process.env.MN_INDEXER_URL;
const post = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  assert.ok(response.ok);
  const value = await response.json();
  assert.equal(value.errors, undefined);
  assert.equal(value.error, undefined);
  return value;
};
const rpc = async (method, params = []) =>
  (await post(nodeUrl, { jsonrpc: '2.0', id: 1, method, params })).result;
assert.equal(
  await rpc('chain_getBlockHash', [0]),
  '0x823383ec0302be8417cfcbcc62f21df08f4047bca37aaea89e3f54b550ebae1d',
);
const initial = await dedicatedIndexerReadiness({ nodeUrl, indexerUrl });
assert.ok(initial.ready);
const pins = await verifyPreparedRegistry(prepared);
const indexer = createMidnamesIndexer('undeployed', indexerUrl, process.env.MN_INDEXER_WS_URL);
const reads = createMidnamesLedgerReads(indexer, 'undeployed', 'acc-s3r1.1', 'standalone-0.35');
const profile = { networkId: 'undeployed', namespace: 'night', registryAddress };
assert.ok(await reads.isSupportedAccount(accountAddress, 'undeployed'));
assert.equal(await reads.readClaim(label + '.night', profile), undefined);
mkdirSync(output, { mode: 0o700 });
const leaseOwner = {
  runId: randomBytes(8).toString('hex'),
  pid: process.pid,
  project: 'shared-ledger9-midnames-admin-name',
  root: output,
};
const receipt = {
  status: 'RUNNING',
  sourceCommit,
  registryAddress,
  accountAddress,
  name: label + '.night',
  rootCommitment,
  ownerCommitment,
  finalizedBefore: initial.finalizedHash,
  preparedManifestSha256: sha256(readFileSync(join(prepared, 'prepared.json'))),
  secretHashes: { root: rootSecretHash, owner: ownerSecretHash, sponsorSeed: sponsorSeedHash },
  transactions: [],
  steps: [],
  leaseOwner,
};
const save = () => saveIsolationReceipt(join(output, 'admin-name.json'), receipt);
const step = (name) => {
  receipt.steps.push(name);
  save();
  console.log(name);
};
const privateFile = (path, bytes) => {
  const fd = openSync(path, 'wx', 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const directory = openSync(dirname(path), 'r');
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
};
save();
let wallet;
let walletCreationAttempted = false;
let pin;
let inputs;
let claimed = false;
let passed = false;
let failure;
try {
  claimIsolationLease(nativeLeasePath(), leaseOwner);
  claimed = true;
  const stat = lstatSync(nativeLeasePath());
  pin = { dev: stat.dev, ino: stat.ino, sha256: sha256(readFileSync(nativeLeasePath())) };
  receipt.leasePin = pin;
  save();
  inputs = await isolatedInputs(root, reference, () => {});
  const runtimeRoot = join(output, 'registry-runtime');
  mkdirSync(runtimeRoot, { mode: 0o700 });
  symlinkSync(join(reference, 'node_modules'), join(runtimeRoot, 'node_modules'));
  const modulePath = join(runtimeRoot, 'registry.mjs');
  privateFile(modulePath, readFileSync(join(prepared, 'managed/contract/index.js')));
  assert.equal(sha256(readFileSync(modulePath)), pins.compiled['contract/index.js']);
  const get = (name) =>
    import(import.meta.resolve(name, pathToFileURL(join(reference, 'package.json')).href));
  const [walletModule, registry, ledger, runtime] = await Promise.all([
    import(pathToFileURL(join(reference, 'src/node/wallet.ts')).href),
    import(pathToFileURL(modulePath).href),
    get('@midnightntwrk/ledger-v9'),
    get('@midnight-ntwrk/compact-runtime'),
  ]);
  process.chdir(output);
  step('sync-existing-sponsor');
  walletCreationAttempted = true;
  wallet = await walletModule.createWallet(sponsorSeed);
  await walletModule.syncWallet(wallet, 'admin name sponsor');
  const providers = await walletModule.createProviders(wallet);
  const current = await providers.publicDataProvider.queryContractState(registryAddress);
  assert.ok(current);
  const state = ledger.ContractState.deserialize(current.serialize());
  assert.equal(state.operations().length, Object.keys(pins.circuits).length);
  for (const [name, expected] of Object.entries(pins.circuits))
    assert.equal(sha256(state.operation(name).verifierKey), expected.verifier);
  assert.deepEqual(state.maintenanceAuthority.committee, []);
  const onChain = registry.ledger(runtime.ContractState.deserialize(current.serialize()).data);
  const parent = onChain.id_to_data.lookup(onChain.ROOT_ZONE_ID);
  assert.equal(Buffer.from(parent.owner_public_key).toString('hex'), rootCommitment);
  assert.equal(Buffer.from(parent.target).toString('hex'), accountAddress);
  assert.equal(parent.target_type, registry.AddressType.ContractAddr);
  const childPrice = { ...parent.payment_config, buy_enabled: false };
  const sponsorAddress = walletModule.userAddressBytes(wallet);
  const workerInput = {
    ref: reference,
    modulePath,
    assets: join(prepared, 'managed'),
    registryManifestHash: pins.compiled['compiler/contract-manifest.json'],
    registryAddress,
    accountAddress,
    indexerUrl,
    indexerWsUrl: process.env.MN_INDEXER_WS_URL,
    proverUrl: process.env.MN_PROOF_SERVER_URL,
    walletKeys: {
      coin: await providers.walletProvider.getCoinPublicKey(),
      encryption: await providers.walletProvider.getEncryptionPublicKey(),
    },
    childOwnerAddress: sponsorAddress,
    rootId: onChain.ROOT_ZONE_ID,
    label,
    price: parent.payment_config,
    childPrice,
    ownerSecretFile: rootSecretFile,
    ownerSecretMustExist: true,
  };
  const submit = async (operation, expectedOwner) => {
    step('prove-' + operation);
    const proved = await proveInOwnerProcess({
      ...workerInput,
      operation,
      ...(operation === 'transfer_domain' && { newOwnerCommitment: ownerCommitment }),
    });
    assert.equal(proved.ownerCommitment, rootCommitment);
    const prebound = ledger.Transaction.deserialize(
      'signature',
      'proof',
      'pre-binding',
      proved.bytes,
    );
    const balanced = await providers.walletProvider.balanceTx({ version: 'v9', tx: prebound });
    assert.equal(balanced.version, 'v9');
    const bytes = balanced.tx.serialize();
    const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes);
    const ordinal = receipt.transactions.length + 1;
    const row = {
      ordinal,
      operation,
      hash: tx.transactionHash(),
      sha256: sha256(bytes),
      identifiers: tx.identifiers(),
      status: 'prepared',
    };
    privateFile(join(output, `admin-tx-${ordinal}.private.bin`), bytes);
    receipt.transactions.push(row);
    save();
    const dustSpends = [...tx.intents.values()].reduce(
      (count, intent) => count + (intent.dustActions?.spends.length ?? 0),
      0,
    );
    assert.equal(dustSpends, 2, 'Ledger 9 qualification requires two DUST spends.');
    row.status = 'submission-unknown';
    save();
    try {
      row.id = String(await providers.midnightProvider.submitTx({ version: 'v9', tx }));
      row.status = 'submitted';
      save();
    } catch (error) {
      row.submitError = String(error);
      save();
    }
    const query =
      'query($offset:TransactionOffset!){transactions(offset:$offset){__typename raw hash protocolVersion ... on RegularTransaction {identifiers transactionResult{status} block{hash height}}}}';
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const result = await post(indexerUrl, {
        query,
        variables: { offset: { identifier: row.identifiers[0] } },
      });
      const rows = result.data.transactions;
      if (rows.length === 1) {
        const indexed = rows[0];
        assert.equal(indexed.__typename, 'RegularTransaction');
        assert.equal(indexed.protocolVersion, 2001100);
        assert.equal(indexed.hash, row.hash);
        assert.equal(sha256(Buffer.from(indexed.raw, 'hex')), row.sha256);
        assert.deepEqual(indexed.identifiers, row.identifiers);
        if (indexed.transactionResult.status !== 'SUCCESS')
          throw new Error(`Original ${operation} indexed ${indexed.transactionResult.status}.`);
        const finality = await dedicatedIndexerReadiness({ nodeUrl, indexerUrl });
        if (finality.ready && indexed.block.height <= finality.finalizedHeight) {
          assert.equal(
            await rpc('chain_getBlockHash', [indexed.block.height]),
            '0x' + indexed.block.hash,
          );
          row.status = 'finalized-success';
          row.block = indexed.block;
          save();
          break;
        }
      } else assert.equal(rows.length, 0);
      await delay(1500);
    }
    assert.equal(row.status, 'finalized-success', `Original ${operation} is unresolved.`);
    const named = await reads.readClaim(label + '.night', profile);
    assert.deepEqual(named, {
      ownerCommitment: expectedOwner,
      target: { kind: 'contract', address: accountAddress },
    });
  };
  await submit('create_domain', rootCommitment);
  await submit('transfer_domain', ownerCommitment);
  assert.ok(await reads.isSupportedAccount(accountAddress, 'undeployed'));
  const finality = await dedicatedIndexerReadiness({ nodeUrl, indexerUrl });
  assert.ok(finality.ready);
  receipt.finalizedAfter = finality.finalizedHash;
  passed = true;
  step('verified-owner-held-name');
} catch (error) {
  failure = error;
  receipt.error = String(error);
  save();
} finally {
  try {
    if (wallet) await wallet.wallet.stop();
    receipt.walletStopped = !!wallet || !walletCreationAttempted;
  } catch (error) {
    failure ??= error;
    receipt.walletStopError = String(error);
  }
  try {
    if (inputs) {
      await inputs.verify(() => {});
      await inputs.verify(() => {});
      await verifyPreparedRegistry(prepared);
      assert.equal(sha256(readPrivate(rootSecretFile, 32)), rootSecretHash);
      assert.equal(sha256(readPrivate(ownerSecretFile, 32)), ownerSecretHash);
      assert.equal(sha256(readPrivate(sponsorSeedFile, 64)), sponsorSeedHash);
      receipt.inputsUnchanged = true;
    }
  } catch (error) {
    failure ??= error;
    receipt.verificationError = String(error);
  }
  if (claimed) {
    const safe =
      !!pin &&
      receipt.walletStopped &&
      receipt.inputsUnchanged &&
      (receipt.transactions.every((row) => row.status === 'prepared') || passed);
    if (safe) {
      try {
        releaseIsolationLease(nativeLeasePath(), leaseOwner, true, pin);
        receipt.leaseReleased = true;
      } catch (error) {
        failure ??= error;
        receipt.leaseError = String(error);
        receipt.leaseRetained = true;
      }
    } else receipt.leaseRetained = true;
  }
  receipt.status = !failure && passed && receipt.leaseReleased ? 'PASS' : 'FAIL';
  save();
}
if (failure) throw failure;
assert.equal(receipt.status, 'PASS');
console.log(JSON.stringify({ name: label + '.night', registryAddress, accountAddress }));
