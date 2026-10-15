#!/usr/bin/env node
// Live current-account-API probe: create a sealed P-256 ACC, add a second device, open with it.
// Run beside `pnpm demo up --contract-dir ... --no-key-service` in the pinned Nix shell.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createPassportAccounts } from '../../packages/account/dist/index.js';
import { createMidnightChain, createMidnightGrantSource } from '../../packages/adapter-midnight-js/dist/index.js';
import {
  fetchCheckedV1Config,
  remoteDirectory,
  remoteV1Deployer,
  remoteV1Prover,
  remoteV1Sponsor,
} from '../../packages/adapter-service/dist/index.js';
import { resolveBinding } from '../../packages/contract/dist/index.js';
import { Contract, ledger, pureCircuits } from '../../packages/contract/generated/acc-s3r1.1/index.js';
import {
  deriveSymmetricSecret,
  PRF_LABEL_AUTHORISER,
  PRF_LABEL_ROOT,
  prfSalt,
  recipeDeviceKeyring,
  recipeEncryptionKey,
  seedFromRoot,
} from '../../packages/keys/dist/index.js';
import { softwarePasskey } from '../../apps/passport-dapp/e2e/software-passkey.ts';

const root = resolve(import.meta.dirname, '../..');
const contractDir = process.env.PASSPORT_CONTRACT_DIR;
if (!contractDir) throw new Error('set PASSPORT_CONTRACT_DIR to the pinned compiled ACC export');
if ((process.env.MN_NETWORK_ID ?? 'undeployed') !== 'undeployed')
  throw new Error('the sealed P-256 probe runs only on the undeployed localnet');
const pin = resolveBinding('acc-s3r1.1');
const manifest = readFileSync(join(contractDir, 'contracts/managed/account/compiler/contract-manifest.json'));
assert.equal(createHash('sha256').update(manifest).digest('hex'), pin.manifestSha256);
const service = process.env.PASSPORT_SERVICE_URL ?? 'http://localhost:8787';
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
const binding = { Contract, ledger, pureCircuits };
const sponsor = remoteV1Sponsor(service);
const transactions = [];
const chain = createMidnightChain({
  network,
  binding,
  prover: remoteV1Prover(service),
  sponsor,
  sponsorKeys: config,
  submitter: sponsor,
});
const observedChain = {
  readAccount: (...args) => chain.readAccount(...args),
  async call(request) {
    const result = await chain.call(request);
    transactions.push({ circuit: request.circuit, txHash: result.txHash });
    console.log(`  ${request.circuit}: ${result.txHash}`);
    return result;
  },
};
const grants = createMidnightGrantSource({
  network,
  binding,
  openings: { readReadPublicKey: async () => undefined },
});
const noHeldCoins = {
  async selectHeldEntries(_account, _entries, opened) {
    if (opened.some((entry) => entry?.kind === 'coin'))
      throw new Error('the empty-account probe encountered a coin; no holding source was configured');
    return [];
  },
};
const hex = (bytes) => Buffer.from(bytes).toString('hex');

const devicePorts = async (passkey) => {
  const identity = await passkey.create();
  const prf = {
    withSession: (operation) => operation(),
    deviceSecret: async () => passkey.prf(prfSalt(PRF_LABEL_AUTHORISER)),
    async deriveSecret(params) {
      const rootOutput = passkey.prf(prfSalt(PRF_LABEL_ROOT));
      const seed = seedFromRoot(rootOutput);
      try {
        return deriveSymmetricSecret(seed, params);
      } finally {
        rootOutput.fill(0);
        seed.fill(0);
      }
    },
  };
  let record;
  const authoriser = {
    scheme: 'p256-webauthn',
    devicePublicKey: async () => identity.publicKey,
    devicePublicKeyHex: async () =>
      `${identity.publicKey.y & 1n ? '03' : '02'}${identity.publicKey.x.toString(16).padStart(64, '0')}`,
    deviceBinding: async () => ({
      policy: identity.policy,
      credentialId: identity.credentialId,
    }),
    withKeySession: (operation) => operation(),
    async authorise(request) {
      assert.ok(request.challenge instanceof Uint8Array);
      assert.deepEqual(request.credentialId, identity.credentialId);
      const signed = await passkey.sign(identity, request.challenge);
      return {
        scheme: 'p256-webauthn',
        pk: identity.publicKey,
        useCounter: request.useCounter,
        authenticatorData: signed.authenticator_data,
        sig: signed.sig,
      };
    },
  };
  return {
    identity,
    keyring: recipeDeviceKeyring(prf),
    ports: {
      network,
      binding,
      chain: observedChain,
      deployer: remoteV1Deployer(service),
      directory: remoteDirectory(service),
      credentials: {
        create: async () => ({ credentialId: identity.credentialId }),
        identify: () => passkey.identify(),
      },
      authoriser,
      encryptionKey: recipeEncryptionKey(prf),
      viewingKey: recipeDeviceKeyring(prf),
      holdings: noHeldCoins,
      readGrants: grants,
      records: {
        read: async () => record,
        write: async (value) => { record = value; },
        exists: async () => record !== undefined,
      },
      random: (length) => new Uint8Array(randomBytes(length)),
    },
  };
};

const owner = await devicePorts(softwarePasskey('localhost', 'http://localhost:5173'));
const joiner = await devicePorts(softwarePasskey('localhost', 'http://localhost:5173'));
const account = await createPassportAccounts(owner.ports).createAccount({
  userName: 'sealed-node-probe',
  retireAuthority: true,
});
const before = await observedChain.readAccount(account.address, { includeInbox: true, includeDevices: true });
assert.ok(before?.booted);
assert.equal(before.specVersion, 3);
assert.equal(before.entryCount, 1);
assert.deepEqual(before.inboxEntries.map((entry) => entry[0]), [0xd1, 0xd5]);
const reader = {
  scheme: 'p256-webauthn',
  readerPublicKey: hex(await joiner.keyring.readerPublicKey(network.networkId)),
  devicePublicKey: await joiner.ports.authoriser.devicePublicKeyHex(),
  policy: joiner.identity.policy,
};
const enrolled = await account.addDevice(reader);
const after = await observedChain.readAccount(account.address, { includeInbox: true, includeDevices: true });
assert.ok(after);
assert.equal(after.entryCount, 2);
assert.equal(after.hasEntry(Buffer.from(enrolled.commitmentHex, 'hex')), true);
assert.deepEqual(after.inboxEntries.slice(-2).map((entry) => entry[0]), [0xd1, 0xd5]);
const reopened = await createPassportAccounts(joiner.ports).openAccountAt(account.address);
assert.equal(reopened.address, account.address);
assert.equal((await reopened.state()).entryCount, 2);
const evidence = {
  verdict: 'PASS',
  bindingId: 'acc-s3r1.1',
  manifestSha256: pin.manifestSha256,
  contractSource: '6458ed5fe6a4843912328bbf11112b97e33abf45',
  account: account.address,
  networkId: network.networkId,
  ownerScheme: 'p256-webauthn',
  joinedScheme: 'p256-webauthn',
  enrollmentCommitment: enrolled.commitmentHex,
  authNonceBeforeEnrollment: before.authNonce.toString(),
  authNonceAfterEnrollment: after.authNonce.toString(),
  transactions,
  joinerOpenedByAddress: true,
  scope: 'current account API sealed P-256 enrollment with an empty live read-grant roster',
};
writeFileSync(join(root, 'experiments/acc-0.35/results/sdk-p256-sealed-device-node.json'),
  JSON.stringify(evidence, null, 2) + '\n');
console.log(`SDK sealed P-256 device enrollment: PASS (${account.address})`);
