// The built-in wallet against the localnet: seeds 0…01 (the genesis-funded dev seed), syncs
// through the service's /config endpoints and answers the DApp Connector calls. Run it with the
// localnet and the service up:
//   nix develop -c bash -c 'cd apps/passport-dapp && node --import tsx e2e/dev-wallet.e2e.ts'
import assert from 'node:assert/strict';
import { createDevWallet, type DevWalletConfig } from '../src/wallet/dev-wallet.ts';
import { fallbackDevSeed } from '../src/wallet/seed.ts';

const service = process.env.PASSPORT_SERVICE_URL ?? 'http://localhost:8787';
const config = (await (await fetch(`${service}/config`)).json()) as DevWalletConfig;
const wallet = await createDevWallet(fallbackDevSeed(), config);
try {
  const api = await wallet.descriptor.connect('undeployed');
  const cfg = await api.getConfiguration();
  assert.equal(cfg.networkId, 'undeployed');
  assert.equal((await api.getConnectionStatus()).status, 'connected');
  assert.match((await api.getUnshieldedAddress()).unshieldedAddress, /^mn_addr_undeployed1/);
  const balances = await api.getUnshieldedBalances();
  assert.ok(
    Object.values(balances).some((v) => v > 0n),
    'the genesis wallet holds NIGHT',
  );
  await assert.rejects(wallet.descriptor.connect('testnet'));
  console.log('dev wallet: PASS');
} finally {
  await wallet.stop();
}
