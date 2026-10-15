#!/usr/bin/env node
// Proof-backed P-256 SDK probe: create, fund, discover and fully spend one ACC coin.
// Run beside `pnpm demo up --contract-dir ... --no-key-service` in the pinned Nix shell.
// Set PASSPORT_CONTRACT_DIR to that compiled export and WALLET_SEED to the public localnet
// genesis seed; run with the export's node_modules/.bin/tsx as in sdk-shielded-deposit-node.mjs.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPassportAccounts } from '../../packages/account/dist/index.js';
import {
  createMidnightChain,
  createMidnightGrantSource,
  createMidnightHoldingSource,
  createMidnightWalletPorts,
} from '../../packages/adapter-midnight-js/dist/index.js';
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
  sealInboxCoin,
  seedFromRoot,
} from '../../packages/keys/dist/index.js';
import { softwarePasskey } from '../../apps/passport-dapp/e2e/software-passkey.ts';

const root = resolve(import.meta.dirname, '../..');
const contractDir = process.env.PASSPORT_CONTRACT_DIR;
if (!contractDir) throw new Error('set PASSPORT_CONTRACT_DIR to the pinned compiled ACC export');
const contractRequire = createRequire(join(resolve(contractDir), 'package.json'));
const { Event } = await import(
  pathToFileURL(contractRequire.resolve('@midnightntwrk/ledger-v9')).href
);
if ((process.env.MN_NETWORK_ID ?? 'undeployed') !== 'undeployed')
  throw new Error('the sealed P-256 probe runs only on the undeployed localnet');
if (process.env.WALLET_SEED !== `${'0'.repeat(63)}1`)
  throw new Error('the shielded withdrawal probe requires the public localnet genesis wallet');
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
let valueBearingChain;
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
    const result = await (request.circuit.startsWith('withdraw_shielded')
      ? valueBearingChain
      : chain
    ).call(request);
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
let liveHoldings;
const holdings = {
  selectHeldEntries: (...args) => liveHoldings.selectHeldEntries(...args),
  selectQualifiedHeldCoins: (...args) => liveHoldings.selectQualifiedHeldCoins(...args),
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
      holdings,
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
const account = await createPassportAccounts(owner.ports).createAccount({
  userName: 'shielded-withdraw-node-probe',
  retireAuthority: true,
});
const fromContract = (path) => import(pathToFileURL(join(contractDir, path)).href);
const [{ setupWallet, deployFaucet, connectAccount }, { mintToUser, userCoinPublicKey }] = await Promise.all([
  fromContract('src/node/setup.ts'),
  fromContract('src/tests/flow.ts'),
]);
const wallet = await setupWallet();
const walletProvider = wallet.providers.walletProvider;
const midnightProvider = wallet.providers.midnightProvider;
valueBearingChain = createMidnightChain({
  network,
  binding,
  prover: remoteV1Prover(service),
  ...createMidnightWalletPorts(walletProvider, midnightProvider),
});
const faucet = await deployFaucet(wallet.walletCtx);
const minted = await mintToUser(wallet, faucet, '0'.repeat(62) + '31', 25n);
const fundingAccount = await connectAccount(wallet, account.address);
const deposit = await fundingAccount.depositShielded(
  { nonce: minted.nonce, color: minted.color, value: minted.value },
  await sealInboxCoin((await observedChain.readAccount(account.address)).encKey, minted),
);
const query = `query($offset: TransactionOffset!) { transactions(offset: $offset) { hash ... on RegularTransaction { zswapLedgerEvents { raw } } } }`;
const response = await fetch(config.indexerUri, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query, variables: { offset: { identifier: deposit.txId } } }),
});
assert.ok(response.ok, `indexer returned HTTP ${response.status}`);
const body = await response.json();
assert.ok(!body.errors, JSON.stringify(body.errors));
const transaction = body.data?.transactions?.[0];
assert.ok(transaction?.hash, 'deposited transaction is absent from the indexer');
const outputs = (transaction.zswapLedgerEvents ?? []).flatMap(({ raw }) => {
  const { content } = Event.deserialize(Buffer.from(raw.replace(/^0x/, ''), 'hex'));
  return content.tag === 'zswapOutput' ? [{
    commitment: content.commitment.toLowerCase(),
    contractAddress: content.contract?.toLowerCase(),
    index: content.mtIndex,
  }] : [];
});
assert.ok(outputs.some((output) => output.contractAddress === account.address));
liveHoldings = createMidnightHoldingSource({
  enumerateContractActions: async () => [{ txHash: transaction.hash }],
  queryShieldedOutputs: async (txHash) => {
    assert.equal(txHash, transaction.hash);
    return outputs;
  },
});
const found = await account.readShieldedHoldings();
assert.equal(found.length, 1);
assert.equal(found[0].coin.value, minted.value);
const recipient = hex(await userCoinPublicKey(wallet));
const spent = await account.withdrawShielded({
  inboxIndex: found[0].inboxIndex,
  color: hex(minted.color),
  amount: minted.value.toString(),
  recipient,
});
assert.ok(spent.txHash);
// Account creation publishes two owner-signed sealed-key entries before this spend.
assert.equal(spent.nextUseCounter, 3n);
const evidence = {
  verdict: 'PASS',
  bindingId: 'acc-s3r1.1',
  manifestSha256: pin.manifestSha256,
  contractSource: '6458ed5fe6a4843912328bbf11112b97e33abf45',
  account: account.address,
  networkId: network.networkId,
  ownerScheme: 'p256-webauthn',
  depositTx: deposit.txId,
  withdrawTx: spent.txHash,
  inboxIndex: found[0].inboxIndex,
  outputIndex: outputs.find((output) => output.contractAddress === account.address)?.index.toString(),
  transactions,
  scope: 'proof-backed exact P-256 owner shielded withdrawal',
};
writeFileSync(join(root, 'experiments/acc-0.35/results/sdk-p256-shielded-withdraw-node.json'),
  JSON.stringify(evidence, null, 2) + '\n');
console.log(`SDK P-256 shielded withdrawal: PASS (${account.address})`);
// The reference wallet keeps indexer subscriptions open after the probe completes.
setTimeout(() => process.exit(0), 100).unref();
