#!/usr/bin/env node
// One-time local wallet provisioner. Stop the Passport demo before opening the
// shared genesis wallet; every submitted transfer has a durable intent record.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
import { checkSharedState } from './midnight-shared-state.mjs';

const [stateDir, reference, selection] = process.argv.slice(2);
assert.ok(selection === undefined || selection === '--candidate-funding-only');
const candidateFundingOnly = selection === '--candidate-funding-only';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.ok(process.env.IN_NIX_SHELL && process.env.COMPACT_DIRECTORY);
assert.ok(stateDir && reference && isAbsolute(stateDir) && isAbsolute(reference));
assert.equal(resolve(stateDir), stateDir);
assert.equal(resolve(reference), reference);
assert.ok(existsSync(join(reference, 'src/node/wallet.ts')));
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const stat = statSync(stateDir);
assert.ok(stat.isDirectory() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid?.());
const registry = join(stateDir, candidateFundingOnly ? 'registry-candidate.json' : 'registry.json');
assert.ok(
  existsSync(`${registry}.v1`) && existsSync(`${registry}.chain-anchor.json`),
  'First run the Passport demo once to create its registry and chain pins.',
);
await checkSharedState({
  mode: 'check',
  registryPath: registry,
  profile: JSON.parse(
    execFileSync('bash', ['scripts/midnight-attach.sh'], { cwd: root, encoding: 'utf8' }),
  ),
});
sharedSponsorLease('check', registry);
const sharedEndpoints = {
  MIDNIGHT_NETWORK: 'local',
  MN_NETWORK_ID: 'undeployed',
  MN_NODE_URL: 'http://127.0.0.1:9944',
  MN_INDEXER_URL: 'http://127.0.0.1:8088/api/v4/graphql',
  MN_INDEXER_WS_URL: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
  MN_PROOF_SERVER_URL: candidateFundingOnly ? 'http://127.0.0.1:6300' : 'http://127.0.0.1:16320',
};
for (const [key, value] of Object.entries(sharedEndpoints)) {
  assert.ok(!process.env[key] || process.env[key] === value, `Conflicting shared endpoint: ${key}`);
  process.env[key] = value;
}

/** @param {string} path @param {string | undefined} value @returns {string} */
function privateFile(path, value) {
  if (!existsSync(path)) {
    assert.ok(value, `Missing private file: ${path}`);
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

/** @type {[string, string][]} */
const wallets = candidateFundingOnly
  ? [
      [
        'candidate-funding',
        privateFile(
          join(stateDir, 'candidate-funding-seed.private.hex'),
          randomBytes(32).toString('hex'),
        ),
      ],
    ]
  : [
      [
        'claim-sponsor',
        privateFile(
          join(stateDir, 'claim-sponsor-seed.private.hex'),
          randomBytes(32).toString('hex'),
        ),
      ],
      [
        'funding',
        privateFile(join(stateDir, 'funding-seed.private.hex'), randomBytes(32).toString('hex')),
      ],
    ];
for (const [, seed] of wallets) {
  assert.match(seed, /^[0-9a-f]{64}$/);
  assert.notEqual(seed, '0'.repeat(63) + '1');
}
assert.equal(new Set(wallets.map(([, seed]) => seed)).size, wallets.length);
if (candidateFundingOnly) {
  const candidateSeed = wallets[0]?.[1];
  assert.ok(candidateSeed);
  for (const name of ['funding', 'claim-sponsor']) {
    const existingSeed = privateFile(join(stateDir, `${name}-seed.private.hex`), undefined);
    assert.notEqual(candidateSeed, existingSeed, 'Candidate funding needs a distinct wallet.');
  }
}
privateFile(
  join(
    stateDir,
    candidateFundingOnly ? 'candidate-funding-token.private.txt' : 'funding-token.private.txt',
  ),
  randomBytes(32).toString('hex'),
);
privateFile(
  join(
    stateDir,
    candidateFundingOnly ? 'candidate-funding-assets.private.json' : 'funding-assets.private.json',
  ),
  JSON.stringify([{ color: '00'.repeat(32), maxPerRequest: '10', maxPerUtcDay: '1000' }]),
);

// The shared sponsor lease is also used by the reference backend. An active
// browser demo or a native qualification run refuses this provisioner.
let clean = false;
let leased = false;
let genesis;
try {
  const walletModule = await import(pathToFileURL(join(reference, 'src/node/wallet.ts')).href);
  assert.deepEqual(walletModule.CONFIG, {
    networkId: 'undeployed',
    node: 'http://127.0.0.1:9944',
    indexer: 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    proofServer: sharedEndpoints.MN_PROOF_SERVER_URL,
  });
  /** @param {string} name */
  const get = (name) =>
    import(import.meta.resolve(name, pathToFileURL(join(reference, 'package.json')).href));
  const { fundFreshClaimSponsor } = await import(
    pathToFileURL(join(root, 'examples/midnames-local/claim-dust-fixture.mjs')).href
  );
  const ledger = await get('@midnightntwrk/ledger-v9');
  sharedSponsorLease('begin', registry);
  leased = true;
  genesis = await walletModule.createWallet('0'.repeat(63) + '1');
  await walletModule.syncWallet(genesis, 'shared local genesis wallet for one-time demo funding');
  for (const [label, seed] of wallets) {
    assert.ok(label && seed);
    const receiptPath = join(stateDir, label + '-wallet-provision.json');
    /** @type {{status:string,label:string,transactions:Record<string,string>,submissions:string[],attempts?:unknown[],dustInputs?:number}} */
    let receipt = { status: 'intent', label, transactions: {}, submissions: [] };
    if (existsSync(receiptPath)) {
      const prior = JSON.parse(readFileSync(receiptPath, 'utf8'));
      if (prior.status === 'complete') continue;
      if (
        label !== 'candidate-funding' ||
        prior.status !== 'pre-submit-refused' ||
        prior.reconciliation?.outcome !== 'proving-failed-before-submit' ||
        Object.keys(prior.transactions ?? {}).length !== 0 ||
        (prior.submissions?.length ?? 0) !== 0
      )
        throw new Error(
          `${label} transfer is uncertain; reconcile ${receiptPath} before another transfer.`,
        );
      receipt = {
        ...receipt,
        attempts: [
          ...(prior.attempts ?? []),
          {
            status: prior.status,
            reconciliation: prior.reconciliation,
            transactions: prior.transactions,
          },
        ],
      };
    }
    saveIsolationReceipt(receiptPath, receipt);
    const target = await walletModule.createWallet(seed);
    try {
      await walletModule.syncWallet(target, `dedicated ${label} wallet`);
      const providers = await walletModule.createProviders(target);
      const submit = providers.midnightProvider.submitTx.bind(providers.midnightProvider);
      providers.midnightProvider.submitTx = async (
        /** @type {{version:string,tx:{transactionHash:()=>string}}} */ transaction,
      ) => {
        if (transaction.version !== 'v9') throw new Error('Candidate wallet requires Ledger 9.');
        receipt.submissions.push(transaction.tx.transactionHash());
        saveIsolationReceipt(receiptPath, receipt);
        return submit(transaction);
      };
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
    `midnames-wallets: ${wallets.map(([label]) => label).join(' and ')} funded; private files stay in ${stateDir}`,
  );
} finally {
  await genesis?.wallet.stop();
  if (leased) {
    if (clean) sharedSponsorLease('finish', registry);
    else console.error('midnames-wallets: retained the sponsor lease for reconciliation.');
  }
}
