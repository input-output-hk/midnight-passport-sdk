// Diagnostic-only byte boundary around the public-genesis localnet wallet. No network override
// or user seed is accepted. Run with the pinned reference checkout's tsx loader.
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const contract = process.env.PASSPORT_CONTRACT_DIR;
if (!contract) throw new Error('PASSPORT_CONTRACT_DIR required');
for (const key of ['MIDNIGHT_NETWORK', 'MN_NETWORK_ID', 'MN_NODE_URL', 'MN_INDEXER_URL', 'MN_INDEXER_WS_URL', 'MN_PROOF_SERVER_URL']) delete process.env[key];
process.env.MIDNIGHT_NETWORK = 'local';
process.env.MN_NETWORK_ID = 'undeployed';
process.env.MN_NODE_URL = 'http://localhost:19944';
process.env.MN_INDEXER_URL = 'http://localhost:18088/api/v4/graphql';
process.env.MN_INDEXER_WS_URL = 'ws://localhost:18088/api/v4/graphql/ws';
process.env.MN_PROOF_SERVER_URL = 'http://127.0.0.1:16300';
const require = createRequire(join(contract, 'package.json'));
const { Transaction } = await import(pathToFileURL(require.resolve('@midnightntwrk/ledger-v9')));
const { createWallet, syncWallet, createProviders } = await import(pathToFileURL(join(contract, 'src/node/wallet.ts')));
const wallet = await createWallet('0'.repeat(63) + '1'); // Public standalone genesis seed.
await syncWallet(wallet, 'lace-localnet-diagnostic');
const providers = await createProviders(wallet);
const reply = value => process.stdout.write('PASSPORT_RPC ' + JSON.stringify(value) + '\n');
reply({ ready: true });
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  try {
    if (request.method !== 'balance') throw new Error('unsupported diagnostic operation');
    const tx = Transaction.deserialize('signature', 'proof', 'pre-binding', Buffer.from(request.tx, 'hex'));
    const result = await providers.walletProvider.balanceTx({ version: 'v9', tx });
    reply({ id: request.id, tx: Buffer.from(result.tx.serialize()).toString('hex') });
  } catch (error) {
    reply({ id: request.id, error: error instanceof Error ? error.message : 'wallet operation failed' });
  }
}
await wallet.wallet.stop();
