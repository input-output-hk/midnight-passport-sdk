#!/usr/bin/env node
// Node-backed SDK deposit probe against the pinned 6458ed5 ACC export.
// Run with that export's tsx and localnet; its public genesis wallet funds the test.
// First: nix develop -c pnpm demo up --contract-dir /path/to/contract --no-key-service
// Then: WALLET_SEED=<64-digit public localnet genesis seed> PASSPORT_CONTRACT_DIR=/path/to/contract
//       nix develop -c /path/to/contract/node_modules/.bin/tsx experiments/acc-0.35/sdk-shielded-deposit-node.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { depositShielded } from '../../packages/account/dist/index.js';
import { createHostedAccChain } from '../../packages/adapter-midnight-js/dist/index.js';
import { resolveBinding } from '../../packages/contract/dist/index.js';
import { sealInboxCoin } from '../../packages/keys/dist/index.js';

const root = resolve(import.meta.dirname, '../..');
const contractDir = process.env.PASSPORT_CONTRACT_DIR;
if (!contractDir) throw new Error('set PASSPORT_CONTRACT_DIR to the pinned compiled ACC export');
if ((process.env.MN_NETWORK_ID ?? 'undeployed') !== 'undeployed')
  throw new Error('the shielded deposit probe runs only on the undeployed localnet');
if (process.env.WALLET_SEED !== `${'0'.repeat(63)}1`)
  throw new Error('the shielded deposit probe requires the public localnet genesis wallet');
const bindingId = 'acc-s3r1.1';
const pinned = resolveBinding(bindingId);
const manifest = readFileSync(
  join(contractDir, 'contracts/managed/account/compiler/contract-manifest.json'),
);
assert.equal(
  createHash('sha256').update(manifest).digest('hex'),
  pinned.manifestSha256,
  'the compiled ACC must match the SDK binding pin',
);
/** @param {string} path */
const fromContract = (path) => import(pathToFileURL(join(contractDir, path)).href);
const [{ standardSetup, mintToUser }, { openInboxEntry }, { runScenario }] = await Promise.all([
  fromContract('src/tests/flow.ts'),
  fromContract('src/wallet/inbox.ts'),
  fromContract('src/tests/runner.ts'),
]);

await runScenario('sdk-shielded-deposit-node', async () => {
  const setup = await standardSetup();
  try {
    const minted = await mintToUser(setup.ctx, setup.faucet, '0'.repeat(62) + '13', 25n);
    const chain = createHostedAccChain({
      network: { bindingId, manifestSha256: pinned.manifestSha256 },
      binding: { id: bindingId, ...pinned },
      readLedger: async (address) =>
        address === setup.account.address ? setup.account.ledgerState() : undefined,
      // The pinned reference account and Lace both expose the generated ACC callTx handle.
      connectHandle: async (address) => {
        assert.equal(address, setup.account.address);
        return { callTx: setup.account.callTx };
      },
    });
    const result = await depositShielded(
      {
        account: setup.account.address,
        requestId: crypto.randomUUID(),
        color: minted.color,
        nonce: minted.nonce,
        amount: minted.value,
      },
      {
        chain,
        sealCoin: sealInboxCoin,
        sender: {
          // This single-use probe supplies no durable request-ID journal; a service must do so.
          depositShielded: async ({ account, coin, entry }) => {
            const submitted = await chain.call({
              address: account,
              circuit: 'deposit_shielded',
              args: [coin, entry],
            });
            return { txId: submitted.txHash };
          },
        },
        sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
        pollMs: 3_000,
        confirmationMs: 180_000,
      },
    );
    const ledger = await setup.account.ledgerState();
    const entry = ledger.inbox.lookup(BigInt(result.inboxIndex));
    const opened = openInboxEntry(setup.encKeys.secretKey, entry);
    assert.ok(opened, 'the upstream ACC reader must open the SDK-sealed entry');
    assert.deepEqual(opened.nonce, minted.nonce);
    assert.deepEqual(opened.color, minted.color);
    assert.equal(opened.value, minted.value);
    assert.equal(result.viewingKeyChanged, false);

    const evidence = {
      bindingId,
      manifestSha256: pinned.manifestSha256,
      contractSource: '6458ed5fe6a4843912328bbf11112b97e33abf45',
      networkId: 'undeployed',
      account: setup.account.address,
      txId: result.txId,
      inboxIndex: result.inboxIndex,
      color: Buffer.from(minted.color).toString('hex'),
      amount: minted.value.toString(),
      entryOpenedByUpstreamReader: true,
      hostedCallTxExecuted: true,
    };
    writeFileSync(
      join(root, 'experiments/acc-0.35/results/sdk-shielded-deposit-node.json'),
      JSON.stringify(evidence, null, 2) + '\n',
    );
    console.log(`SDK shielded deposit ${result.txId} confirmed at inbox index ${result.inboxIndex}`);
  } finally {
    setup.encKeys.secretKey.fill(0);
  }
});
