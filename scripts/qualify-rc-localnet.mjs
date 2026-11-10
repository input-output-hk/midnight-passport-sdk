#!/usr/bin/env node
// Opt-in localnet container acceptance. Creates one disposable synthetic JubJub ACC and
// transfers exactly 10 base units of genesis NIGHT through the separate funding service; no real passkeys.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { saveIsolationReceipt } from './qualification/native-isolation-files.mjs';
import { admitSyntheticFixture } from './rc-qualification-private.mjs';
import { syncDirectory } from './release/files.mjs';
import { dirname } from 'node:path';
import { waitForFundingReady, submitQualificationFunding } from './rc-qualification-http.mjs';
import { createPassportAccounts } from '../packages/account/dist/index.js';
import { createMidnightChain } from '../packages/adapter-midnight-js/dist/index.js';
import {
  fetchCheckedV1Config,
  remoteDirectory,
  remoteV1Deployer,
  remoteV1Prover,
  remoteV1Sponsor,
} from '../packages/adapter-service/dist/index.js';
import { resolveBinding } from '../packages/contract/dist/index.js';
import { Contract, ledger, pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import {
  deriveSymmetricSecret,
  recipeDeviceKeyring,
  recipeJubjubAuthoriser,
} from '../packages/keys/dist/index.js';

if (process.env.PASSPORT_RC_LOCALNET !== '1' || process.env.MN_NETWORK_ID !== 'undeployed')
  throw new Error(
    'set PASSPORT_RC_LOCALNET=1 and MN_NETWORK_ID=undeployed for this destructive localnet-only probe',
  );
/** @param {string} key */
const required = (key) => {
  const value = process.env[key];
  if (!value) throw new Error(`set ${key}`);
  return value;
};
const token = readFileSync(required('PASSPORT_FUNDING_TOKEN_FILE'), 'utf8').trim();
if (token.length < 32) throw new Error('funding token must have at least 32 characters');
const service = required('PASSPORT_SERVICE_URL');
const funding = required('PASSPORT_FUNDING_URL');
for (const value of [service, funding]) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('qualification services must use loopback HTTP');
}
const pin = resolveBinding('acc-s3r1.1');
const output = process.env.PASSPORT_RC_EVIDENCE;
if (!output) throw new Error('set PASSPORT_RC_EVIDENCE to a local evidence path');
if (existsSync(output))
  throw new Error(
    'evidence already exists; reconcile the saved request before selecting a fresh evidence path',
  );
admitSyntheticFixture(output, process.env.PASSPORT_RC_SYNTHETIC_FIXTURE);
const config = await fetchCheckedV1Config(service, {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: pin.manifestSha256,
  artefactUrl: `${service}/v1/zk/acc-s3r1.1`,
});
const network = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: pin.manifestSha256,
  indexerUrl: config.indexerUri,
  indexerWsUrl: config.indexerWsUri,
  nodeUrl: config.nodeUri,
  artefactUrl: config.zkBaseUrl,
};
const sponsor = remoteV1Sponsor(service);
const binding = { Contract, ledger, pureCircuits };
const chain = createMidnightChain({
  network,
  binding,
  prover: remoteV1Prover(service),
  sponsor,
  sponsorKeys: config,
  submitter: sponsor,
});
const seed = new Uint8Array(randomBytes(32));
const device = new Uint8Array(randomBytes(32));
const credentialId = new Uint8Array(randomBytes(16));
// Optional mounted-run capture, never a resume command or a real credential store.
// Preserve synthetic identity BEFORE the first possible account transaction.
const syntheticFixture = process.env.PASSPORT_RC_SYNTHETIC_FIXTURE;
if (syntheticFixture) {
  const fd = openSync(syntheticFixture, 'wx', 0o600);
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        schema: 1,
        syntheticOnly: true,
        seed: Buffer.from(seed).toString('hex'),
        device: Buffer.from(device).toString('hex'),
        credential: Buffer.from(credentialId).toString('hex'),
      }) + '\n',
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDirectory(dirname(syntheticFixture));
}
/** @type {import('../packages/account/dist/ports/index.js').PrfKeySource} */
const prf = {
  withSession: (operation) => operation(),
  deviceSecret: async () => new Uint8Array(device),
  deriveSecret: async (params) => deriveSymmetricSecret(seed, params),
};
/** @type {import('../packages/account/dist/ports/index.js').AccountRecord | undefined} */
let record;
const authoriser = recipeJubjubAuthoriser(prf, pureCircuits);
const publicKey = await authoriser.devicePublicKey();
const accounts = () =>
  createPassportAccounts({
    network,
    binding,
    chain,
    deployer: remoteV1Deployer(service),
    directory: remoteDirectory(service),
    credentials: {
      create: async () => ({ credentialId }),
      identify: async () => ({
        credentialId,
        owns: (key) => key.x === publicKey.x && key.y === publicKey.y,
      }),
    },
    authoriser,
    encryptionKey: {
      publicKey: async () => {
        throw new Error(
          'qualification requires sealed random ACC keys, not the legacy deterministic port',
        );
      },
    },
    viewingKey: recipeDeviceKeyring(prf),
    records: {
      read: async () => record,
      write: async (value) => {
        if (syntheticFixture)
          saveIsolationReceipt(syntheticFixture + '.record', {
            ...value,
            credentialId: value.credentialId
              ? Buffer.from(value.credentialId).toString('hex')
              : null,
            localUseCounter: value.localUseCounter.toString(),
          });
        record = value;
      },
      exists: async () => !!record,
    },
    random: (length) => new Uint8Array(randomBytes(length)),
  });
/** @type {Record<string, unknown>} */
const evidence = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: pin.manifestSha256,
  verdict: 'IN_PROGRESS',
};
const save = () => {
  saveIsolationReceipt(output, evidence);
};
save();
try {
  evidence.creationOutcome = 'unknown-until-confirmed';
  save();
  const account = await accounts().createAccount({
    userName: 'rc5-container-qualification',
    retireAuthority: true,
  });
  console.log('ACC created and activated', account.address);
  evidence.account = account.address;
  save();
  assert.equal((await account.state()).entryCount, 1);
  assert.equal((await accounts().openAccount()).address, account.address);
  evidence.createActivateReadReopen = 'passed';
  evidence.creationOutcome = 'confirmed';
  save();
  await waitForFundingReady(funding, pin.manifestSha256);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const balances = async () => {
    const r = await fetch(`${funding}/v1/faucet/balances?accountAddress=${account.address}`, {
      headers,
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.ok(
      body &&
        typeof body === 'object' &&
        'night' in body &&
        typeof body.night === 'string' &&
        /^\d+$/.test(body.night),
    );
    return /** @type {{night: string}} */ (body);
  };
  const before = await balances();
  evidence.before = before;
  save();
  const request = {
    requestId: randomUUID(),
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    manifestSha256: pin.manifestSha256,
    accountAddress: account.address,
    color: '00'.repeat(32),
    amount: '10',
  };
  evidence.request = request;
  save();
  /** @type {Array<{stage: string, outcome: string, httpStatus?: number}>} */
  const attempts = [];
  evidence.fundingAttempts = attempts;
  /** @param {string} stage */
  const submit = (stage) =>
    submitQualificationFunding({
      base: funding,
      headers,
      request,
      onAttempt: (event) => {
        attempts.push({ stage, ...event });
        save();
      },
    });
  // A failed qualification is not evidence that no transfer was submitted.
  evidence.fundingOutcome = 'uncertain';
  save();
  const funded = await submit('initial');
  evidence.funded = funded;
  evidence.fundingOutcome = 'service-confirmed';
  save();
  const after = await balances();
  assert.equal(BigInt(after.night), BigInt(before.night) + 10n);
  evidence.after = after;
  evidence.fundingOutcome = 'balance-confirmed';
  save();
  const replay = await submit('replay');
  evidence.replay = replay;
  save();
  assert.deepEqual(replay, funded);
  assert.deepEqual(await balances(), after);
  Object.assign(evidence, { before, funded, after, replay, verdict: 'PASS' });
  save();
  console.log('RC container qualification: PASS', account.address);
} catch (error) {
  evidence.verdict = 'FAIL';
  evidence.failure = {
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message.slice(0, 500) : 'unknown qualification failure',
  };
  save();
  throw error;
} finally {
  seed.fill(0);
  device.fill(0);
}
