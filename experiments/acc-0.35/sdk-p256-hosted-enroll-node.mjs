#!/usr/bin/env node
// Live P-256 enrollment through the SDK hosted-chain port and pinned ACC.
// WALLET_SEED=000...001 PASSPORT_CONTRACT_DIR=/path/to/compiled/contract \
//   nix develop -c /path/to/contract/node_modules/.bin/tsx \
//   experiments/acc-0.35/sdk-p256-hosted-enroll-node.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHostedAccChain } from '../../packages/adapter-midnight-js/dist/index.js';
import { resolveBinding } from '../../packages/contract/dist/index.js';

const root = resolve(import.meta.dirname, '../..');
const contractDir = process.env.PASSPORT_CONTRACT_DIR;
if (!contractDir) throw new Error('set PASSPORT_CONTRACT_DIR to the pinned compiled ACC export');
if ((process.env.MN_NETWORK_ID ?? 'undeployed') !== 'undeployed')
  throw new Error('the P-256 probe runs only on the undeployed localnet');
if (process.env.WALLET_SEED !== `${'0'.repeat(63)}1`)
  throw new Error('the P-256 probe requires the public localnet genesis wallet');
const bindingId = 'acc-s3r1.1';
const pinned = resolveBinding(bindingId);
const manifest = readFileSync(join(contractDir, 'contracts/managed/account/compiler/contract-manifest.json'));
assert.equal(createHash('sha256').update(manifest).digest('hex'), pinned.manifestSha256);
const fromContract = (file) => import(pathToFileURL(join(contractDir, file)).href);
const [{ setupWallet, compiledAccountContract }, { CustodyAccount }, { generateEncKeyPair },
  { softwarePasskey }, { p256Challenges }, { authArgs }, { runScenario }] = await Promise.all([
  fromContract('src/node/setup.ts'),
  fromContract('src/wallet/account.ts'),
  fromContract('src/wallet/inbox.ts'),
  fromContract('src/tests/p256-fixtures.ts'),
  fromContract('src/wallet/signer-p256.ts'),
  fromContract('src/wallet/signer.ts'),
  fromContract('src/tests/runner.ts'),
]);

await runScenario('sdk-p256-hosted-enroll-node', async () => {
  const ctx = await setupWallet();
  const owner = softwarePasskey();
  const joining = softwarePasskey();
  const keys = generateEncKeyPair();
  try {
    const account = await CustodyAccount.deploy(ctx.providers, compiledAccountContract(), owner.device, keys);
    const chain = createHostedAccChain({
      network: { bindingId, manifestSha256: pinned.manifestSha256 },
      binding: { id: bindingId, ...pinned },
      readLedger: async (address) =>
        address === account.address ? account.ledgerState() : undefined,
      connectHandle: async (address) => {
        assert.equal(address, account.address);
        return { callTx: account.callTx };
      },
    });
    const before = await chain.readAccount(account.address, { includeDevices: true });
    assert.ok(before?.booted);
    assert.equal(before.specVersion, 3);
    const entry = joining.device.entryAt(account.addressBytes, before.deviceEpoch, 0n);
    assert.equal(before.hasEntry(entry), false);
    const context = await account.callContext();
    const counter = await account.resolveUseCounter(owner.device);
    const auth = await owner.device.sign(
      p256Challenges.addDevice(context, owner.pk, entry), counter,
    );
    const submitted = await chain.call({
      address: account.address,
      circuit: 'add_device_with_p256',
      args: [entry, ...authArgs(auth)],
    });
    const after = await chain.readAccount(account.address, { includeDevices: true });
    assert.ok(after);
    assert.equal(after.hasEntry(entry), true);
    assert.equal(after.authNonce, before.authNonce + 1n);
    assert.equal(after.entryCount, before.entryCount + 1);
    const evidence = {
      bindingId,
      manifestSha256: pinned.manifestSha256,
      contractSource: '6458ed5fe6a4843912328bbf11112b97e33abf45',
      networkId: 'undeployed',
      account: account.address,
      txId: submitted.txHash,
      circuit: 'add_device_with_p256',
      ownerArm: 'p256',
      joiningArm: 'p256',
      entry: Buffer.from(entry).toString('hex'),
      authNonceBefore: before.authNonce.toString(),
      authNonceAfter: after.authNonce.toString(),
      hostedCallTxExecuted: true,
      entryConfirmedOnChain: true,
      // The reference software passkey supplies the assertion. This does not cover the SDK's
      // sealed key delivery, active read grants, or browser WebAuthn ceremony.
      scope: 'hosted chain bridge and pinned P-256 enrollment circuit',
    };
    writeFileSync(join(root, 'experiments/acc-0.35/results/sdk-p256-hosted-enroll-node.json'),
      JSON.stringify(evidence, null, 2) + '\n');
    console.log(`SDK hosted P-256 enrollment ${submitted.txHash} confirmed`);
  } finally {
    keys.secretKey.fill(0);
  }
});
