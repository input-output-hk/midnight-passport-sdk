#!/usr/bin/env node
// Live current-account-API probe: issue a read grant, then enroll a second P-256 device.
// Run beside `pnpm demo up --contract-dir ... --no-key-service` in the pinned Nix shell.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { jubjub } from '@noble/curves/misc.js';
import { x25519 } from '@noble/curves/ed25519.js';
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
  openGrantView,
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
// This probe keeps its grant opening in memory for the lifetime of one run. Production hosts
// must provide the durable journal described by GrantPublicationJournal.
const staged = new Map();
const pending = new Set();
const grantJournal = {
  async stage(opening) {
    const key = `${opening.account}:${opening.bookkeeping.grantId}`;
    if (staged.has(key)) throw new Error('grant opening was staged twice');
    staged.set(key, opening);
    pending.add(key);
  },
  load: async (account, grantId) => staged.get(`${account}:${grantId}`),
  pending: async (account) =>
    [...pending].filter((key) => key.startsWith(`${account}:`)).map((key) => key.slice(65)),
  async markPublished(account, grantId) {
    pending.delete(`${account}:${grantId}`);
  },
};
const grants = createMidnightGrantSource({
  network,
  binding,
  openings: {
    async readReadPublicKey(account, grantId) {
      return staged.get(`${account}:${grantId}`)?.bookkeeping.readPublicKey;
    },
  },
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
      grants,
      grantCommitments: grants,
      grantDetails: grants,
      grantRoster: grants,
      grantJournal,
      grantOrigin: 'localhost',
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
const readSecret = new Uint8Array(32).fill(7);
const readPublicKey = hex(x25519.getPublicKey(readSecret));
const issued = await account.issueGrant({
  grantee: { scheme: 'jubjub-schnorr', publicKey: hex(jubjub.Point.BASE.toBytes()) },
  operations: ['withdraw-unshielded'],
  read: true,
  rpId: 'localhost',
  readPublicKey,
  color: '34'.repeat(32),
  recipient: { kind: 'any' },
  maxCoinValue: '100',
  perCallCap: '10',
  cap: '100',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
});
assert.equal(issued.status, 'active');
assert.ok(issued.rotation?.txHash);
assert.ok(issued.sealedReadGrant);
const activeBefore = await grants.readActiveReadGrantTargets(account.address);
assert.deepEqual(activeBefore.targets, [{ grantId: issued.grantId, readPublicKey }]);
assert.equal(pending.size, 0);
const beforeEnrollment = await observedChain.readAccount(account.address, { includeInbox: true, includeDevices: true });
assert.ok(beforeEnrollment);
const initialGrantView = await openGrantView(readSecret, {
  grantId: issued.grantId,
  account: account.address,
  seal: issued.sealedReadGrant.seal,
  expectedEncKey: beforeEnrollment.encKey,
});
assert.ok(initialGrantView, 'read grantee cannot open the issued seal against the live ACC key');
initialGrantView.fill(0);
const oldEncKey = beforeEnrollment.encKey.slice();
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
assert.ok(enrolled.rotationTxHash);
assert.deepEqual(enrolled.sealedReadGrants?.map((seal) => seal.grantId), [issued.grantId]);
assert.notDeepEqual(after.encKey, oldEncKey);
const rotatedGrantView = await openGrantView(readSecret, {
  grantId: issued.grantId,
  account: account.address,
  seal: enrolled.sealedReadGrants[0].seal,
  expectedEncKey: after.encKey,
});
assert.ok(rotatedGrantView, 'read grantee cannot open the rotated seal against the live ACC key');
rotatedGrantView.fill(0);
assert.equal(await openGrantView(readSecret, {
  grantId: issued.grantId,
  account: account.address,
  seal: issued.sealedReadGrant.seal,
  expectedEncKey: after.encKey,
}), null, 'the old seal unexpectedly opens against the rotated ACC key');
const activeAfter = await grants.readActiveReadGrantTargets(account.address);
assert.deepEqual(activeAfter.targets, [{ grantId: issued.grantId, readPublicKey }]);
assert.equal(activeAfter.authNonce, after.authNonce);
const reopened = await createPassportAccounts(joiner.ports).openAccountAt(account.address);
assert.equal(reopened.address, account.address);
assert.equal((await reopened.state()).entryCount, 2);
const beforeRevoke = await observedChain.readAccount(account.address, { includeInbox: true, includeDevices: true });
const revoked = await account.revokeGrant(issued.grantId);
const afterRevoke = await observedChain.readAccount(account.address, { includeInbox: true, includeDevices: true });
assert.ok(beforeRevoke && afterRevoke);
assert.notDeepEqual(afterRevoke.encKey, beforeRevoke.encKey);
assert.deepEqual((await grants.readActiveReadGrantTargets(account.address)).targets, []);
assert.equal((await grants.readGrantCommitment(account.address, issued.grantId)).active, false);
assert.equal(await openGrantView(readSecret, {
  grantId: issued.grantId, account: account.address,
  seal: enrolled.sealedReadGrants[0].seal, expectedEncKey: afterRevoke.encKey,
}), null, 'revoked grantee seal still opens the current key');
assert.equal((await createPassportAccounts(owner.ports).openAccount()).address, account.address);
assert.equal((await createPassportAccounts(joiner.ports).openAccountAt(account.address)).address, account.address);
const evidence = {
  verdict: 'PASS',
  bindingId: 'acc-s3r1.1',
  manifestSha256: pin.manifestSha256,
  contractSource: '6458ed5fe6a4843912328bbf11112b97e33abf45',
  account: account.address,
  networkId: network.networkId,
  ownerScheme: 'p256-webauthn',
  joinedScheme: 'p256-webauthn',
  grantId: issued.grantId,
  readPublicKey,
  readGrantIssueTxHash: issued.txHash,
  enrollmentRotationTxHash: enrolled.rotationTxHash,
  readGrantPreservedDuringEnrollment: true,
  readGrantRevoked: true,
  revokeTxHash: revoked.txHash,
  revokedGranteeSealRejected: true,
  bothDevicesOpenedAfterRevocation: true,
  viewingKeyChangedDuringEnrollment: true,
  granteeOpenedInitialSeal: true,
  granteeOpenedRotatedSeal: true,
  initialSealRejectedAfterRotation: true,
  enrollmentCommitment: enrolled.commitmentHex,
  authNonceBeforeEnrollment: beforeEnrollment.authNonce.toString(),
  authNonceAfterEnrollment: after.authNonce.toString(),
  transactions,
  joinerOpenedByAddress: true,
  scope: 'sealed P-256 read-grant issue, enrollment preserving the grant, rotation on revocation, grantee seal refusal and surviving-device recovery',
};
writeFileSync(join(root, 'experiments/acc-0.35/results/sdk-p256-read-grant-revoke-node.json'),
  JSON.stringify(evidence, null, 2) + '\n');
readSecret.fill(0);
console.log(`SDK P-256 read-grant revocation: PASS (${account.address})`);
