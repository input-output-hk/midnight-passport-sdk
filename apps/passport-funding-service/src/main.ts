import { timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createFileFundingStore,
  createServer,
  createWalletFundingBackend,
  fundingRoute,
  json,
  verifyArtefacts,
} from '@input-output-hk/mn-passport-service';
import { loadFundingConfig } from './config.ts';
import { deployedAddresses } from './deployments.ts';

const config = loadFundingConfig(process.env);
verifyArtefacts(config.artefactDir, config.manifestSha256);

const root = (relative: string): string => join(config.contractDir, relative);
const setup = (await import(pathToFileURL(root('src/node/setup.ts')).href)) as {
  setupWallet(seed: string): Promise<unknown>;
  connectAccount(
    context: unknown,
    address: string,
  ): Promise<{
    ledgerState(): Promise<{
      spec_version: bigint;
      unshielded_balances: {
        member(color: Uint8Array): boolean;
        lookup(color: Uint8Array): bigint;
      };
    }>;
    depositUnshielded(color: Uint8Array, amount: bigint): Promise<{ txId: string }>;
  }>;
};
if (typeof setup.setupWallet !== 'function' || typeof setup.connectAccount !== 'function')
  throw new Error('pinned reference client does not expose the wallet and ACC connection');
const referenceNetwork = (await import(pathToFileURL(root('src/node/wallet.ts')).href)) as {
  CONFIG: {
    networkId: string;
    node: string;
    indexer: string;
    indexerWS: string;
    proofServer: string;
  };
};
const expected = {
  networkId: config.networkId,
  node: config.nodeUri,
  indexer: config.indexerUri,
  indexerWS: config.indexerWsUri,
  proofServer: config.proofServerUri,
};
for (const [key, value] of Object.entries(expected)) {
  if (referenceNetwork.CONFIG?.[key as keyof typeof expected] !== value)
    throw new Error(`reference wallet ${key} differs from the funding service network`);
}
const wallet = await setup.setupWallet(config.walletSeed);
const backend = createWalletFundingBackend({
  deployed: (address) => deployedAddresses(config.deploymentsFile, config.networkId).has(address),
  connect: (address) => setup.connectAccount(wallet, address),
});
const token = Buffer.from(config.token, 'utf8');
const authorized = (header: string | undefined): boolean => {
  if (!header?.startsWith('Bearer ')) return false;
  const candidate = Buffer.from(header.slice(7), 'utf8');
  return candidate.length === token.length && timingSafeEqual(candidate, token);
};
const server = createServer(config, [
  async (request, response, url) => {
    if (request.method !== 'GET' || url.pathname !== '/healthz') return false;
    json(response, 200, {
      status: 'ready',
      networkId: config.networkId,
      bindingId: config.bindingId,
      manifestSha256: config.manifestSha256,
    });
    return true;
  },
  async (request, response, url) => {
    if (request.method !== 'GET' || url.pathname !== '/v1/faucet/balances') return false;
    if (!authorized(request.headers.authorization)) {
      json(response, 403, { error: 'funding caller refused' });
      return true;
    }
    const address = url.searchParams.get('accountAddress');
    if (!address || !/^[0-9a-f]{64}$/.test(address)) {
      json(response, 400, { error: 'invalid account address' });
      return true;
    }
    if (!deployedAddresses(config.deploymentsFile, config.networkId).has(address)) {
      json(response, 403, { error: 'funding account is not eligible' });
      return true;
    }
    const account = await setup.connectAccount(wallet, address);
    const ledger = await account.ledgerState();
    if (ledger.spec_version !== 3n) {
      json(response, 409, { error: 'ACC binding changed' });
      return true;
    }
    const balance = (color: string): string => {
      const bytes = Uint8Array.from(Buffer.from(color, 'hex'));
      return ledger.unshielded_balances.member(bytes)
        ? ledger.unshielded_balances.lookup(bytes).toString()
        : '0';
    };
    const color = config.assets[0]!.color;
    json(response, 200, {
      accountAddress: address,
      color,
      night: balance('00'.repeat(32)),
      fundedAsset: balance(color),
    });
    return true;
  },
  fundingRoute({
    networkId: config.networkId,
    bindingId: config.bindingId,
    manifestSha256: config.manifestSha256,
    assets: config.assets,
    authorize: async (request) => authorized(request.headers.authorization),
    eligible: backend.eligible,
    backend,
    store: createFileFundingStore(config.reservationsFile),
  }),
]);
server.listen(config.port, config.host, () => {
  const { address, port } = server.address() as AddressInfo;
  console.log(`passport-funding-service: http://${address}:${port} (network ${config.networkId})`);
});
