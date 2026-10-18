#!/usr/bin/env node
// Proof-backed scoped grant lifecycle on a fresh localnet ACC. Requires the public genesis
// seed, pinned contract export and running demo stack; spends only its own 10-unit test deposit.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPassportAccounts, spendUnshieldedWithGrant } from '../../packages/account/dist/index.js';
import { createMidnightChain, createMidnightGrantSource, createMidnightWalletPorts } from '../../packages/adapter-midnight-js/dist/index.js';
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
  recipeJubjubAuthoriser,
  seedFromRoot,
} from '../../packages/keys/dist/index.js';
import { prepareLocalnetNight } from '../../apps/passport-funding-service/src/night-preparation.ts';
import { softwarePasskey } from '../../apps/passport-dapp/e2e/software-passkey.ts';

const root = resolve(import.meta.dirname, '../..');
const contractDir = process.env.PASSPORT_CONTRACT_DIR;
if (!contractDir) throw new Error('set PASSPORT_CONTRACT_DIR to the pinned compiled ACC export');
if ((process.env.MN_NETWORK_ID ?? 'undeployed') !== 'undeployed')
  throw new Error('this withdrawal probe runs only on the undeployed localnet');
if (process.env.WALLET_SEED !== `${'0'.repeat(63)}1`)
  throw new Error('this grant probe requires the public localnet genesis wallet');
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
const sponsoredChain = createMidnightChain({
  network, binding, prover: remoteV1Prover(service), sponsor,
  sponsorKeys: config, submitter: sponsor,
});
let valueBearingChain;
const transactions = [];
const chain = {
  readAccount: (...args) => sponsoredChain.readAccount(...args),
  async call(request) {
    const selected = request.circuit === 'withdraw_unshielded_with_grant_jubjub'
      ? valueBearingChain : sponsoredChain;
    if (!selected) throw new Error('value-bearing wallet is not ready');
    const result = await selected.call(request);
    transactions.push({ circuit: request.circuit, txHash: result.txHash });
    console.log(`  ${request.circuit}: ${result.txHash}`);
    return result;
  },
};
const passkey = softwarePasskey('localhost', 'http://localhost:5173');
const identity = await passkey.create();
const prf = {
  withSession: (operation) => operation(),
  deviceSecret: async () => passkey.prf(prfSalt(PRF_LABEL_AUTHORISER)),
  async deriveSecret(params) {
    const rootOutput = passkey.prf(prfSalt(PRF_LABEL_ROOT));
    const seed = seedFromRoot(rootOutput);
    try { return deriveSymmetricSecret(seed, params); }
    finally { rootOutput.fill(0); seed.fill(0); }
  },
};
const staged = new Map();
const journal = {
  async stage(grant) {
    if (staged.has(grant.bookkeeping.grantId)) throw new Error('duplicate staged grant');
    staged.set(grant.bookkeeping.grantId, grant);
  },
  async load(_account, grantId) { return staged.get(grantId); },
  async markPublished(_account, grantId) {
    if (!staged.has(grantId)) throw new Error('missing staged grant');
  },
  async pending() { return []; },
};
const grants = createMidnightGrantSource({
  network, binding, openings: { readReadPublicKey: async () => undefined },
});
let record;
const authoriser = {
  scheme: 'p256-webauthn',
  devicePublicKey: async () => identity.publicKey,
  devicePublicKeyHex: async () => `${identity.publicKey.y & 1n ? '03' : '02'}${identity.publicKey.x.toString(16).padStart(64, '0')}`,
  deviceBinding: async () => ({ policy: identity.policy, credentialId: identity.credentialId }),
  withKeySession: (operation) => operation(),
  async authorise(request) {
    assert.deepEqual(request.credentialId, identity.credentialId);
    const signed = await passkey.sign(identity, request.challenge);
    return {
      scheme: 'p256-webauthn', pk: identity.publicKey,
      useCounter: request.useCounter, authenticatorData: signed.authenticator_data,
      sig: signed.sig,
    };
  },
};
const account = await createPassportAccounts({
  network, binding, chain,
  deployer: remoteV1Deployer(service), directory: remoteDirectory(service),
  credentials: {
    create: async () => ({ credentialId: identity.credentialId }),
    identify: () => passkey.identify(),
  },
  authoriser,
  encryptionKey: recipeEncryptionKey(prf), viewingKey: recipeDeviceKeyring(prf),
  grants,
  grantCommitments: grants,
  grantDetails: grants,
  grantRoster: grants,
  grantJournal: journal,
  grantOrigin: 'localhost',
  records: {
    read: async () => record,
    write: async (value) => { record = value; },
    exists: async () => record !== undefined,
  },
  random: (length) => new Uint8Array(randomBytes(length)),
}).createAccount({ userName: 'scoped-grant-node-probe', retireAuthority: true });
console.log(`  test ACC: ${account.address}`);
const fromContract = (path) => import(pathToFileURL(join(contractDir, path)).href);
const [{ setupWallet, connectAccount }, { userAddressBytes }] = await Promise.all([
  fromContract('src/node/setup.ts'), fromContract('src/node/wallet.ts'),
]);
const wallet = await setupWallet();
valueBearingChain = createMidnightChain({
  network, binding, prover: remoteV1Prover(service),
  ...createMidnightWalletPorts(wallet.providers.walletProvider, wallet.providers.midnightProvider),
});
const recipientBytes = userAddressBytes(wallet.walletCtx);
const recipient = Buffer.from(recipientBytes).toString('hex');
const night = new Uint8Array(32);
const fundingAccount = await connectAccount(wallet, account.address);
const preparationTx = await prepareLocalnetNight(
  wallet.walletCtx.wallet, recipientBytes,
  (payload) => wallet.walletCtx.unshieldedKeystore.signDataAsync(payload),
  night, 10n,
);
const deposit = await fundingAccount.depositUnshielded(night, 10n);
const balance = async () => {
  const state = await fundingAccount.ledgerState();
  return state.unshielded_balances.member(night) ? state.unshielded_balances.lookup(night) : 0n;
};
assert.equal(await balance(), 10n, 'fresh ACC deposit must be confirmed before spending');
const granteePasskey = softwarePasskey('localhost', 'http://localhost:5173');
await granteePasskey.create();
const granteePrf = {
  withSession: (operation) => operation(),
  deviceSecret: async () => granteePasskey.prf(prfSalt(PRF_LABEL_AUTHORISER)),
  deriveSecret: async () => { throw new Error('not used'); },
};
const grantee = recipeJubjubAuthoriser(granteePrf, pureCircuits);
const publicKey = await grantee.devicePublicKeyHex();
const grant = await account.issueGrant({
  grantee: { scheme: 'jubjub-schnorr', publicKey },
  operations: ['withdraw-unshielded'],
  color: '00'.repeat(32),
  recipient: { kind: 'user-address', value: recipient },
  maxCoinValue: '10', perCallCap: '4', cap: '10', expiresAt: null,
});
assert.equal(grant.status, 'active');
assert.ok((await grants.readActiveGrantIds(account.address)).includes(grant.grantId));
const opening = staged.get(grant.grantId);
assert.ok(opening, 'owner journal must retain the issued opening');
const intent = {
  account: account.address,
  grantId: grant.grantId,
  granteePublicKey: publicKey,
  origin: 'localhost',
  slot: grant.slot,
  scopeSalt: opening.bookkeeping.scopeSalt,
  color: '00'.repeat(32), amount: '4', recipient,
  maxCoinValue: '10', spentPrev: '0',
};
const spent = await spendUnshieldedWithGrant(intent, {
  pure: pureCircuits, source: grants, chain, grantee,
  review: async (details) => {
    assert.equal(details.account, account.address);
    assert.equal(details.amount, '4');
    assert.equal(details.recipient, recipient);
    return true;
  },
});
assert.ok(spent.txHash);
assert.equal(spent.spentTotal, 4n);
assert.equal(await balance(), 6n, 'confirmed withdrawal must debit exactly four NIGHT units');
const revoked = await account.revokeGrant(grant.grantId);
assert.equal(revoked.status, 'revoked');
assert.equal((await grants.readGrant(account.address, grant.grantId))?.active, false);
await assert.rejects(
  spendUnshieldedWithGrant({ ...intent, amount: '1', spentPrev: '4' }, {
    pure: pureCircuits, source: grants, chain, grantee, review: async () => true,
  }),
  { code: 'GrantRevoked' },
);
assert.equal(await balance(), 6n, 'post-revoke attempted use must leave ACC balance unchanged');
const evidence = {
  verdict: 'PASS', bindingId: 'acc-s3r1.1', manifestSha256: pin.manifestSha256,
  contractSource: '6458ed5fe6a4843912328bbf11112b97e33abf45',
  account: account.address, networkId: network.networkId, ownerScheme: 'p256-webauthn',
  preparationTx, depositTx: deposit.txId, issueTx: grant.txHash,
  grantId: grant.grantId, grantSlot: grant.slot, grantSpendTx: spent.txHash,
  revokeTx: revoked.txHash, postRevokeUseRefused: true,
  color: '00'.repeat(32), depositAmount: '10', withdrawAmount: '4', balanceAfter: '6',
  recipient, transactions,
  scope: 'proof-backed P-256 owner issues fixed-recipient JubJub grant; independent grantee spends four NIGHT units; owner revokes and further use is refused',
};
writeFileSync(join(root, 'experiments/acc-0.35/results/sdk-p256-grant-holder-node.json'),
  JSON.stringify(evidence, null, 2) + '\n');
console.log(`SDK P-256 scoped grant lifecycle: PASS (${account.address})`);
setTimeout(() => process.exit(0), 100).unref();
