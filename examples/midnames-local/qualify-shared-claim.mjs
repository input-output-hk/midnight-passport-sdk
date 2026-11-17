// Claim one operator-held .night name on the already deployed shared Ledger 9 registry.
// A fresh output directory is mandatory; uncertain transactions are reconciled, never replayed.
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
import { claimName } from '../../apps/passport-dapp/src/midnames/claim-receipt.ts';
import { readClaimFinality } from '../../apps/passport-dapp/src/midnames/claim-finality.ts';
import { admitNativeClaim } from '../../apps/passport-dapp/src/midnames/claim-native-admission.ts';
import { dedicatedIndexerReadiness } from '../../scripts/qualification/indexer-readiness.mjs';
import {
  claimIsolationLease,
  releaseIsolationLease,
  saveIsolationReceipt,
} from '../../scripts/qualification/native-isolation-files.mjs';
import { isolatedInputs } from '../../scripts/qualification/native-isolation-inputs.mjs';
import { nativeLeasePath } from '../../scripts/qualification/native-lease.mjs';
import { delegateClaimDust } from './claim-dust-fixture.mjs';
import { openClaimDispatch } from './claim-dispatch.mts';
import { qualifyClaimHandoff } from './claim-handoff-fixture.mjs';
import { verifyPreparedRegistry } from './verify-prepared.mjs';

const [output, prepared, reference, registryAddress, accountAddress, label, ownerSecretFile] =
  process.argv.slice(2);
assert.ok(process.env.IN_NIX_SHELL && process.env.COMPACT_DIRECTORY, 'Use the pinned Nix shell.');
assert.equal(process.env.PASSPORT_MIDNAMES_SHARED_CLAIM, '1');
assert.equal(process.env.PASSPORT_RC_LOCALNET, '1');
assert.equal(process.env.MIDNIGHT_NETWORK, 'local');
assert.equal(process.env.MN_NETWORK_ID, 'undeployed');
assert.equal(process.env.MN_NODE_URL, 'http://127.0.0.1:9944');
assert.equal(process.env.MN_INDEXER_URL, 'http://127.0.0.1:8088/api/v4/graphql');
assert.equal(process.env.MN_INDEXER_WS_URL, 'ws://127.0.0.1:8088/api/v4/graphql/ws');
assert.equal(process.env.MN_PROOF_SERVER_URL, 'http://127.0.0.1:16320');
const sourceRoot = fileURLToPath(new URL('../..', import.meta.url));
const reviewRoot = join(sourceRoot, 'review');
mkdirSync(reviewRoot, { recursive: true, mode: 0o700 });
assert.equal(realpathSync(reviewRoot), reviewRoot);
for (const path of [output, prepared, reference, ownerSecretFile])
  assert.ok(path && isAbsolute(path) && resolve(path) === path, 'Use absolute input paths.');
assert.equal(dirname(output), reviewRoot);
assert.match(basename(output), /^midnames-shared-claim-[a-z0-9-]{1,40}$/);
assert.ok(!existsSync(output), 'Keep prior claim receipts; choose a new output directory.');
assert.match(registryAddress ?? '', /^[0-9a-f]{64}$/);
assert.match(accountAddress ?? '', /^[0-9a-f]{64}$/);
assert.ok(claimName(label + '.night') && label.length >= 3, 'Choose a canonical label.');
assert.equal(process.env.PASSPORT_MIDNAMES_APPROVED_NAME, label + '.night');
const leasePath = nativeLeasePath();
assert.ok(!existsSync(leasePath), 'Reconcile the occupied native lease first.');
const disk = statfsSync(sourceRoot);
assert.ok(BigInt(disk.bavail) * BigInt(disk.bsize) >= 15n * 1024n ** 3n);
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: sourceRoot,
  encoding: 'utf8',
}).trim();
assert.equal(
  execFileSync('git', ['status', '--porcelain'], { cwd: sourceRoot, encoding: 'utf8' }).trim(),
  '',
  'Commit and verify the exact source before a native claim.',
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const writePrivateFile = (path, bytes) => {
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
const post = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  assert.ok(response.ok);
  const value = await response.json();
  assert.equal(value.error, undefined);
  return value.result;
};
const nodeUrl = process.env.MN_NODE_URL;
const indexerUrl = process.env.MN_INDEXER_URL;
const indexerWsUrl = process.env.MN_INDEXER_WS_URL;
const proverUrl = process.env.MN_PROOF_SERVER_URL;
const rpc = (method, params = []) => post(nodeUrl, { jsonrpc: '2.0', id: 1, method, params });
const initial = await dedicatedIndexerReadiness({ nodeUrl, indexerUrl });
assert.ok(initial.ready, 'Shared node and v4 indexer do not agree at finality.');
assert.equal(
  await rpc('chain_getBlockHash', [0]),
  '0x823383ec0302be8417cfcbcc62f21df08f4047bca37aaea89e3f54b550ebae1d',
);
const nodeVersion = await rpc('system_version');
const ledgerVersion = await rpc('midnight_ledgerVersion');
assert.match(nodeVersion, /^2\.1\.101/);
const proofVersion = await fetch(proverUrl + '/version', {
  signal: AbortSignal.timeout(5_000),
}).then((response) => response.text());
assert.equal(proofVersion, '9.0.0-rc.8');
const pins = await verifyPreparedRegistry(prepared);
const indexer = createMidnamesIndexer('undeployed', indexerUrl, indexerWsUrl);
const reads = createMidnamesLedgerReads(indexer, 'undeployed', 'acc-s3r1.1', 'standalone-0.35');
const profile = { networkId: 'undeployed', namespace: 'night', registryAddress };
assert.ok(await reads.isSupportedAccount(accountAddress, 'undeployed'));
assert.equal(await reads.readClaim(label + '.night', profile), undefined, 'Name is already taken.');

mkdirSync(output, { mode: 0o700 });
assert.equal(lstatSync(output).mode & 0o077, 0);
const leaseOwner = {
  runId: randomBytes(8).toString('hex'),
  pid: process.pid,
  project: 'shared-ledger9-midnames-claim',
  root: output,
};
const receipt = {
  status: 'RUNNING',
  sourceCommit,
  networkId: 'undeployed',
  registryAddress,
  accountAddress,
  name: label + '.night',
  nodeVersion,
  ledgerVersion,
  proofVersion,
  finalizedBefore: initial.finalizedHash,
  preparedManifestSha256: sha256(readFileSync(join(prepared, 'prepared.json'))),
  transactions: [],
  steps: [],
  leaseOwner,
};
const save = () => saveIsolationReceipt(join(output, 'shared-claim.json'), receipt);
const step = (name, details = {}) => {
  receipt.steps.push({ name, ...details });
  save();
  console.log(name);
};
save();

let wallet;
let walletCreationAttempted = false;
let claimed = false;
let pin;
let inputs;
let passed = false;
let failure;
try {
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./preflight-owner-secret.mjs', import.meta.url)), ownerSecretFile],
    { stdio: 'ignore', timeout: 10_000 },
  );
  step('verified-private-owner-secret');
  claimIsolationLease(leasePath, leaseOwner);
  claimed = true;
  const stat = lstatSync(leasePath);
  pin = { dev: stat.dev, ino: stat.ino, sha256: sha256(readFileSync(leasePath)) };
  receipt.leasePin = pin;
  save();
  inputs = await isolatedInputs(sourceRoot, reference, () => {});
  receipt.frozenSource = inputs.frozen.source;
  save();
  const runtimeRoot = join(output, 'registry-runtime');
  mkdirSync(runtimeRoot, { mode: 0o700 });
  symlinkSync(join(reference, 'node_modules'), join(runtimeRoot, 'node_modules'));
  const modulePath = join(runtimeRoot, 'registry.mjs');
  writePrivateFile(modulePath, readFileSync(join(prepared, 'managed/contract/index.js')));
  assert.equal(sha256(readFileSync(modulePath)), pins.compiled['contract/index.js']);
  const get = (name) =>
    import(import.meta.resolve(name, pathToFileURL(join(reference, 'package.json')).href));
  const [walletModule, registry, contracts, ledger, runtime, rxjs] = await Promise.all([
    import(pathToFileURL(join(reference, 'src/node/wallet.ts')).href),
    import(pathToFileURL(modulePath).href),
    get('@midnight-ntwrk/midnight-js-contracts'),
    get('@midnightntwrk/ledger-v9'),
    get('@midnight-ntwrk/compact-runtime'),
    get('rxjs'),
  ]);
  process.chdir(output);
  step('sync-sponsor-wallet');
  walletCreationAttempted = true;
  wallet = await walletModule.createWallet('0'.repeat(63) + '1');
  await walletModule.syncWallet(wallet, 'shared Midnames claim sponsor');
  const providers = await walletModule.createProviders(wallet);
  const submit = providers.midnightProvider.submitTx.bind(providers.midnightProvider);
  providers.midnightProvider.submitTx = async (tx) => {
    assert.equal(tx.version, 'v9');
    const bytes = tx.tx.serialize();
    const ordinal = receipt.transactions.length + 1;
    writePrivateFile(join(output, `tx-${ordinal}.private.bin`), bytes);
    const row = { ordinal, sha256: sha256(bytes), status: 'submission-unknown' };
    receipt.transactions.push(row);
    save();
    const id = await submit(tx);
    row.id = String(id);
    row.status = 'submitted';
    save();
    return id;
  };
  const current = await providers.publicDataProvider.queryContractState(registryAddress);
  assert.ok(current, 'Pinned shared registry is absent.');
  const state = ledger.ContractState.deserialize(current.serialize());
  assert.equal(state.operations().length, Object.keys(pins.circuits).length);
  for (const [name, expected] of Object.entries(pins.circuits))
    assert.equal(sha256(state.operation(name).verifierKey), expected.verifier);
  assert.deepEqual(state.maintenanceAuthority.committee, []);
  const root = registry.ledger(runtime.ContractState.deserialize(current.serialize()).data);
  assert.equal(root.TLD, 'night');
  const rootId = root.ROOT_ZONE_ID;
  const parent = root.id_to_data.lookup(rootId);
  assert.deepEqual(parent.target, Uint8Array.from(Buffer.from(accountAddress, 'hex')));
  assert.equal(parent.target_type, registry.AddressType.ContractAddr);
  assert.ok(parent.payment_config.buy_enabled && parent.payment_config.cost_long === 1n);
  assert.ok(parent.payment_config.coin_color.every((byte) => byte === 0));
  assert.equal(await reads.readClaim(label + '.night', profile), undefined);
  step('verified-shared-registry');

  const currentDust = await rxjs.firstValueFrom(wallet.wallet.state());
  if (currentDust.dust.availableCoins.length < 2) {
    const fundingSeed = randomBytes(32).toString('hex');
    writePrivateFile(join(output, 'funding-seed.private.hex'), fundingSeed);
    step('prepare-two-dust-inputs');
    receipt.availableDust = await delegateClaimDust({
      wallet,
      walletModule,
      providers,
      ledger,
      get,
      step,
      fundingSeed,
      recordSubmission: (kind, id) => {
        receipt.dustSetup ??= {};
        receipt.dustSetup[kind] = id;
        save();
      },
    });
  } else receipt.availableDust = currentDust.dust.availableCoins.length;
  save();

  // The owner process alone reads or creates the persistent naming secret.
  // The child domain does not accept further registrations in this fixture.
  const childPrice = { ...parent.payment_config, buy_enabled: false };
  const sponsorAddress = Buffer.from(walletModule.userAddressBytes(wallet)).toString('hex');
  step('prove-and-prepare-owner-claim');
  await qualifyClaimHandoff({
    output,
    ref: reference,
    assets: join(prepared, 'managed'),
    modulePath,
    registryManifestHash: pins.compiled['compiler/contract-manifest.json'],
    registryAddress,
    accountAddress,
    sponsorPaymentAddress: sponsorAddress,
    walletProvider: providers.walletProvider,
    ledger,
    rootId,
    parentDomain: parent,
    step,
    label,
    ownerSecretFile,
    childPrice,
  });
  const journal = openClaimDispatch(output);
  const original = journal.preparedReceipt();
  assert.ok(original, 'The owner claim was not durably prepared.');
  const quote = {
    networkId: 'undeployed',
    registryAddress,
    accountAddress,
    name: label + '.night',
    ownerCommitment: original.ownerCommitment,
    sponsorAddress: '33'.repeat(32),
    registryPayee: Buffer.from(parent.owner_address.bytes).toString('hex'),
    sponsorPaymentAddress: sponsorAddress,
    night: parent.payment_config.cost_long,
  };
  step('dispatch-exact-original');
  await journal.dispatch(original, {
    async authorize(bytes, acknowledgement) {
      assert.equal(acknowledgement.transaction.sha256, sha256(bytes));
      assert.equal(await reads.readClaim(label + '.night', profile), undefined);
      assert.ok(await reads.isSupportedAccount(accountAddress, 'undeployed'));
      const fresh = await providers.publicDataProvider.queryContractState(registryAddress);
      const live = registry.ledger(runtime.ContractState.deserialize(fresh.serialize()).data);
      const liveParent = live.id_to_data.lookup(live.ROOT_ZONE_ID);
      assert.equal(liveParent.payment_config.cost_long, quote.night);
      assert.equal(
        Buffer.from(liveParent.owner_address.bytes).toString('hex'),
        quote.registryPayee,
      );
      assert.ok(liveParent.payment_config.buy_enabled);
      receipt.admission = admitNativeClaim(bytes, acknowledgement, quote, 100_000_000_000_000_000n);
      save();
    },
    async submit(bytes) {
      const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes);
      await providers.midnightProvider.submitTx({ version: 'v9', tx });
    },
  });
  const deadline = Date.now() + 120_000;
  let indexed;
  let originalStatus;
  while (Date.now() < deadline) {
    originalStatus = await readClaimFinality(indexerUrl, original, fetch, 2001100);
    if (
      originalStatus === 'conflict' ||
      originalStatus === 'failed' ||
      originalStatus === 'claim-failed'
    )
      throw new Error(`Original claim transaction is ${originalStatus}.`);
    indexed = await reads.readClaim(label + '.night', profile);
    if (originalStatus === true && indexed) break;
    await delay(1_000);
  }
  assert.equal(originalStatus, true, 'The exact original claim has no indexed SUCCESS.');
  assert.deepEqual(indexed, {
    ownerCommitment: original.ownerCommitment,
    target: { kind: 'contract', address: accountAddress },
  });
  const final = await providers.publicDataProvider.queryContractState(registryAddress);
  const domain = registry.ledger(runtime.ContractState.deserialize(final.serialize()).data);
  const nameKey = new Uint8Array(32).fill(255);
  nameKey.set(new TextEncoder().encode(label));
  const record = domain.id_to_data.lookup(
    domain.name_to_id.lookup({ domain: nameKey, parent_id: domain.ROOT_ZONE_ID }),
  );
  assert.equal(Buffer.from(record.owner_public_key).toString('hex'), original.ownerCommitment);
  assert.deepEqual(record.target, Uint8Array.from(Buffer.from(accountAddress, 'hex')));
  assert.equal(record.target_type, registry.AddressType.ContractAddr);
  assert.equal(record.payment_config.buy_enabled, false);
  const finality = await dedicatedIndexerReadiness({ nodeUrl, indexerUrl });
  assert.ok(finality.ready);
  const transactionResponse = await fetch(indexerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query:
        'query ClaimBlock($offset:TransactionOffset!){transactions(offset:$offset){__typename ... on RegularTransaction {identifiers block{hash height}}}}',
      variables: { offset: { identifier: original.transaction.identifiers[0] } },
    }),
    signal: AbortSignal.timeout(5_000),
  });
  assert.ok(transactionResponse.ok);
  const transactionRows = await transactionResponse.json();
  assert.equal(transactionRows.errors, undefined);
  assert.equal(transactionRows.data?.transactions?.length, 1);
  const originalBlock = transactionRows.data.transactions[0];
  assert.equal(originalBlock.__typename, 'RegularTransaction');
  assert.deepEqual(originalBlock.identifiers, original.transaction.identifiers);
  assert.match(originalBlock.block?.hash ?? '', /^[0-9a-f]{64}$/);
  assert.ok(
    Number.isSafeInteger(originalBlock.block?.height) &&
      originalBlock.block.height <= finality.finalizedHeight,
  );
  assert.equal(
    await rpc('chain_getBlockHash', [originalBlock.block.height]),
    '0x' + originalBlock.block.hash,
    'The original claim is not in the finalized canonical chain.',
  );
  assert.equal(await readClaimFinality(indexerUrl, original, fetch, 2001100), true);
  assert.equal(await rpc('system_version'), nodeVersion);
  assert.equal(await rpc('midnight_ledgerVersion'), ledgerVersion);
  receipt.finalizedAfter = finality.finalizedHash;
  receipt.claimBlock = originalBlock.block;
  receipt.ownerCommitment = original.ownerCommitment;
  receipt.claimIdentifiers = original.transaction.identifiers;
  passed = true;
  step('verified-indexed-name-and-acc');
} catch (error) {
  failure = error;
  receipt.error = String(error);
  save();
} finally {
  let walletStopped = !walletCreationAttempted;
  try {
    if (wallet) {
      await wallet.wallet.stop();
      walletStopped = true;
    }
  } catch (error) {
    receipt.walletStopError = String(error);
    failure ??= error;
  }
  receipt.walletStopped = walletStopped;
  try {
    if (inputs) {
      await inputs.verify(() => {});
      await inputs.verify(() => {});
      await verifyPreparedRegistry(prepared);
      receipt.inputsUnchanged = true;
    }
  } catch (error) {
    receipt.verificationError = String(error);
    failure ??= error;
  }
  if (claimed) {
    const quiescent =
      !!pin &&
      walletStopped &&
      (receipt.transactions.length === 0 || (passed && receipt.inputsUnchanged === true));
    try {
      if (quiescent) {
        releaseIsolationLease(leasePath, leaseOwner, true, pin);
        receipt.leaseReleased = true;
      } else receipt.leaseRetained = true;
    } catch (error) {
      receipt.leaseRetained = true;
      receipt.leaseError = String(error);
      failure ??= error;
    }
  }
  receipt.status =
    !failure && passed && receipt.leaseReleased && receipt.inputsUnchanged ? 'PASS' : 'FAIL';
  save();
}
if (failure) throw failure;
assert.equal(receipt.status, 'PASS');
console.log(JSON.stringify({ name: label + '.night', registryAddress, accountAddress }));
