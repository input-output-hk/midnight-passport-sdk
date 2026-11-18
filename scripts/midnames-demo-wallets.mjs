#!/usr/bin/env node
// One-time local wallet provisioner. Stop the Passport demo before opening the
// shared genesis wallet; every submitted transfer has a durable intent record.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { saveIsolationReceipt } from './qualification/native-isolation-files.mjs';
import { sharedSponsorLease } from './midnight-shared-sponsor-lease.mjs';

const [stateDir, reference] = process.argv.slice(2);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(process.env.IN_NIX_SHELL && process.env.COMPACT_DIRECTORY);
assert.ok(stateDir && reference && isAbsolute(stateDir) && isAbsolute(reference));
assert.equal(resolve(stateDir), stateDir);
assert.equal(resolve(reference), reference);
assert.ok(existsSync(join(reference, 'src/node/wallet.ts')));
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const stat = statSync(stateDir);
assert.ok(stat.isDirectory() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid?.());
const registry = join(stateDir, 'registry.json');
assert.ok(
  existsSync(`${registry}.v1`) && existsSync(`${registry}.chain-anchor.json`),
  'First run the Passport demo once to create its registry and chain pins.',
);

/** @param {string} path @param {string} value */
function privateFile(path, value) {
  if (!existsSync(path)) {
    const file = openSync(path, 'wx', 0o600);
    try {
      writeFileSync(file, value + '\n');
    } finally {
      closeSync(file);
    }
  }
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  assert.equal(stat.mode & 0o077, 0);
  assert.equal(stat.uid, process.getuid?.());
  return readFileSync(path, 'utf8').trim();
}

const claimSeedPath = join(stateDir, 'claim-sponsor-seed.private.hex');
const fundingSeedPath = join(stateDir, 'funding-seed.private.hex');
const claimSeed = privateFile(claimSeedPath, randomBytes(32).toString('hex'));
const fundingSeed = privateFile(fundingSeedPath, randomBytes(32).toString('hex'));
assert.match(claimSeed, /^[0-9a-f]{64}$/);
assert.match(fundingSeed, /^[0-9a-f]{64}$/);
assert.notEqual(claimSeed, fundingSeed);
assert.notEqual(claimSeed, '0'.repeat(63) + '1');
assert.notEqual(fundingSeed, '0'.repeat(63) + '1');
privateFile(join(stateDir, 'funding-token.private.txt'), randomBytes(32).toString('hex'));
privateFile(
  join(stateDir, 'funding-assets.private.json'),
  JSON.stringify([{ color: '00'.repeat(32), maxPerRequest: '10', maxPerUtcDay: '1000' }]),
);

// The shared sponsor lease is also used by the reference backend. An active
// browser demo or a native qualification run refuses this provisioner.
sharedSponsorLease('begin', registry);
let clean = false;
let genesis;
try {
  const walletModule = await import(pathToFileURL(join(reference, 'src/node/wallet.ts')).href);
  assert.deepEqual(walletModule.CONFIG, {
    networkId: 'undeployed',
    node: 'http://127.0.0.1:9944',
    indexer: 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    proofServer: 'http://127.0.0.1:16320',
  });
  /** @param {string} name */
  const get = (name) =>
    import(import.meta.resolve(name, pathToFileURL(join(reference, 'package.json')).href));
  const { fundFreshClaimSponsor } = await import(
    pathToFileURL(join(root, 'examples/midnames-local/claim-dust-fixture.mjs')).href
  );
  const ledger = await get('@midnightntwrk/ledger-v9');
  genesis = await walletModule.createWallet('0'.repeat(63) + '1');
  await walletModule.syncWallet(genesis, 'shared local genesis wallet for one-time demo funding');
  for (const [label, seed] of [
    ['claim-sponsor', claimSeed],
    ['funding', fundingSeed],
  ]) {
    assert.ok(label && seed);
    const receiptPath = join(stateDir, label + '-wallet-provision.json');
    if (existsSync(receiptPath)) {
      const prior = JSON.parse(readFileSync(receiptPath, 'utf8'));
      if (prior.status === 'complete') continue;
      throw new Error(
        `${label} transfer is uncertain; reconcile ${receiptPath} before another transfer.`,
      );
    }
    /** @type {{status: string, label: string, transactions: Record<string,string>, dustInputs?: number}} */
    const receipt = { status: 'intent', label, transactions: {} };
    saveIsolationReceipt(receiptPath, receipt);
    const target = await walletModule.createWallet(seed);
    try {
      await walletModule.syncWallet(target, `dedicated ${label} wallet`);
      const providers = await walletModule.createProviders(target);
      const dustInputs = await fundFreshClaimSponsor({
        sponsor: target,
        genesis,
        providers,
        ledger,
        get,
        step: (/** @type {string} */ phase) => console.log(`midnames-wallets: ${label}: ${phase}`),
        recordSubmission: (/** @type {string} */ kind, /** @type {string} */ id) => {
          receipt.transactions[kind] = id;
          saveIsolationReceipt(receiptPath, receipt);
        },
      });
      receipt.status = 'complete';
      receipt.dustInputs = dustInputs;
      saveIsolationReceipt(receiptPath, receipt);
    } finally {
      await target.wallet.stop();
    }
  }
  clean = true;
  console.log(
    `midnames-wallets: both dedicated wallets are funded; private files stay in ${stateDir}`,
  );
} finally {
  await genesis?.wallet.stop();
  if (clean) sharedSponsorLease('finish', registry);
  else console.error('midnames-wallets: retained the sponsor lease for reconciliation.');
}
